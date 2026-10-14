import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { packCurrentPublication } from "./verify-publication-upgrade.mjs";
import {
  verifyPackedClientTransition,
  verifyPackedClientTransitionControls,
} from "./packed-client-transition.mjs";

const producer = await realpath(fileURLToPath(new URL("../", import.meta.url)));
assert.match(process.version, /^v24\./, "Use the declared Node 24 toolchain");
const manager = join(producer, "node_modules/pnpm/bin/pnpm.cjs");
const option = (name) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? producer : resolve(process.argv[index + 1]);
};
const root = await realpath(
  await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), "packed-client-transition-")),
);
assert.ok(!root.startsWith(producer + sep), "Consumer must be outside the producer workspace");
const baselinePack = join(root, "baseline-pack");
const candidatePack = join(root, "candidate-pack");
await mkdir(baselinePack);
await mkdir(candidatePack);
const baseline = await packCurrentPublication(option("--baseline-source"), baselinePack, manager);
const candidate = await packCurrentPublication(
  option("--candidate-source"),
  candidatePack,
  manager,
);
const consumer = join(root, "consumer");
await mkdir(join(consumer, "src/pages"), { recursive: true });
await mkdir(join(consumer, "vendor"));
await writeFile(join(consumer, "pnpm-workspace.yaml"), "packages:\n  - .\n");
await cp(
  join(producer, "vendor/effortlessmetrics-astro-offline-0.1.5.tgz"),
  join(consumer, "vendor/offline.tgz"),
);
await writeFile(
  join(consumer, "astro.config.mjs"),
  `import { defineConfig } from 'astro/config';
import staticOffline from 'astromache/static-offline';
export default defineConfig({site:'https://example.test',vite:{build:{assetsInlineLimit:0}},build:{inlineStylesheets:'never'},integrations:[staticOffline({
cachePrefix:'packed-transition-',globPatterns:['**/*.{js,css,woff2,svg}'],maxBytes:2000000,maxResources:40,
worker:{navigationStrategy:'network-first',stripQuery:false,navigationFallback:'/offline/'}})]});\n`,
);
const run = (args) =>
  execFileSync(process.execPath, [manager, ...args], {
    cwd: consumer,
    stdio: "inherit",
    timeout: 120000,
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" },
  });
const sha256 = (body) => createHash("sha256").update(body).digest("hex");
async function build(pack, label) {
  await cp(pack.tarball, join(consumer, "vendor", pack.archive));
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify(
      {
        name: "isolated-transition",
        private: true,
        type: "module",
        dependencies: {
          astromache: `file:vendor/${pack.archive}`,
          astro: "7.3.5",
          "@effortlessmetrics/astro-offline": "file:vendor/offline.tgz",
        },
        pnpm: { onlyBuiltDependencies: [] },
      },
      null,
      2,
    ),
  );
  run(["install", "--ignore-scripts", "--no-frozen-lockfile"]);
  const lock = await readFile(join(consumer, "pnpm-lock.yaml"));
  await rm(join(consumer, "node_modules"), { recursive: true });
  run(["install", "--ignore-scripts", "--frozen-lockfile"]);
  assert.deepEqual(await readFile(join(consumer, "pnpm-lock.yaml")), lock);
  const installed = await realpath(join(consumer, "node_modules/astromache"));
  assert.ok(
    installed.startsWith(consumer + sep),
    "Packed library must be isolated inside consumer",
  );
  for (const file of [
    "src/static-offline.mjs",
    "src/Publication.astro",
    "src/Article.astro",
    "src/CopyLink.astro",
    "src/Document.astro",
    "src/metadata.ts",
    "src/publication.css",
    "src/fonts.css",
    "fonts/IBMPlexSans-Regular.woff2",
    "fonts/IBMPlexMono-Regular.woff2",
  ]) {
    assert.deepEqual(
      await readFile(join(installed, file)),
      await readFile(join(pack.unpacked, file)),
      `Consumer must compile exact packed resource: ${file}`,
    );
  }
  const page = `---
import Publication from 'astromache/publication';
import Article from 'astromache/article';
import CopyLink from 'astromache/copy-link';
import 'astromache/publication.css';
import 'astromache/fonts.css';
---
<Publication title="Transition ${label}" description="Packed upgrade" canonical={new URL('https://example.test/')} language="en">
<section id="consumer-body"><Article title="Transition ${label}" published={{datetime:'2026-10-14',label:'Today'}}><p>Version ${label}</p><CopyLink slot="actions"/></Article><a href="/article/">Article</a></section>
</Publication>
<script>import { marker } from '../marker.js'; document.documentElement.dataset.consumer = marker;</script>
<style>#consumer-body { --transition: ${label === "A" ? "1" : "2"}; }</style>\n`;
  await writeFile(join(consumer, "src/marker.js"), `export const marker = '${label}';\n`);
  for (const route of ["", "article", "offline"]) {
    await mkdir(join(consumer, "src/pages", route), { recursive: true });
    await writeFile(
      join(consumer, "src/pages", route, "index.astro"),
      page.replace("../marker.js", route ? "../../marker.js" : "../marker.js"),
    );
  }
  execFileSync(process.execPath, [join(consumer, "node_modules/astro/bin/astro.mjs"), "build"], {
    cwd: consumer,
    stdio: "inherit",
    timeout: 120000,
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" },
  });
  const output = join(root, label);
  await cp(join(consumer, "dist"), output, { recursive: true });
  const receipt = JSON.parse(await readFile(join(output, "offline-receipt.json"), "utf8"));
  const expected = [];
  for (const url of receipt.urls) {
    const body = await readFile(join(output, url.slice(1), url.endsWith("/") ? "index.html" : ""));
    expected.push({ url, bytes: body.length, sha256: sha256(body) });
  }
  return { output, receipt, expected, lockSha256: sha256(lock) };
}
const a = await build(baseline, "A");
const b = await build(candidate, "B");
const fixture = { a, b, baseline, candidate, root };
await writeFile(join(root, "fixture.json"), JSON.stringify(fixture, null, 2) + "\n");
await verifyPackedClientTransition(fixture);

if (process.argv.includes("--negative-controls"))
  await verifyPackedClientTransitionControls(fixture);

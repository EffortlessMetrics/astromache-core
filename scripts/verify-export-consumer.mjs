import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const producer = await realpath(fileURLToPath(new URL("../", import.meta.url)));
const manager = join(producer, "node_modules/pnpm/bin/pnpm.cjs");
const root = await realpath(
  await mkdtemp(join(process.env.ASTROMACHE_QUALIFICATION_ROOT ?? tmpdir(), "astromache-exports-")),
);
const inside = (directory, path) => {
  const local = relative(directory, path);
  return local && local !== ".." && !local.startsWith(`..${sep}`) && !isAbsolute(local);
};
assert.ok(!inside(producer, root) && root !== producer, "Consumer must be outside producer");
const run = (args, cwd) =>
  execFileSync(process.execPath, [manager, ...args], {
    cwd,
    stdio: "inherit",
    timeout: 300000,
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" },
  });
const sourceManifest = JSON.parse(
  await readFile(join(producer, "packages/astromache/package.json"), "utf8"),
);
// An explicit archive allows the same real consumer to reject damaged deliveries.
let archive;
if (process.argv[2]) {
  assert.equal(process.argv.length, 3, "Supply at most one archive path");
  archive = await realpath(resolve(process.argv[2]));
} else {
  run(["pack", "--pack-destination", root], join(producer, "packages/astromache"));
  archive = join(root, `astromache-${sourceManifest.version}.tgz`);
}
const consumer = join(root, "consumer");
await mkdir(join(consumer, "vendor"), { recursive: true });
await cp(archive, join(consumer, "vendor/astromache.tgz"));
await cp(join(producer, "scripts/fixtures/export-consumer"), join(consumer, "src/pages"), {
  recursive: true,
});
await writeFile(
  join(consumer, "package.json"),
  JSON.stringify({
    name: "astromache-export-consumer",
    private: true,
    type: "module",
    dependencies: { astro: "7.3.5", astromache: "file:vendor/astromache.tgz" },
  }),
);
await writeFile(join(consumer, "pnpm-workspace.yaml"), "packages:\n  - .\n");
await writeFile(join(consumer, ".npmrc"), "engine-strict=true\nauto-install-peers=false\n");
const store = process.env.ASTROMACHE_QUALIFICATION_STORE ?? join(root, "store");
run(["install", "--ignore-scripts", "--store-dir", store], consumer);
const lock = await readFile(join(consumer, "pnpm-lock.yaml"));
await rm(join(consumer, "node_modules"), { recursive: true });
run(["install", "--frozen-lockfile", "--ignore-scripts", "--store-dir", store], consumer);
assert.deepEqual(await readFile(join(consumer, "pnpm-lock.yaml")), lock);

const installed = await realpath(join(consumer, "node_modules/astromache"));
assert.ok(inside(consumer, installed), "Must use an archive installed inside the consumer");
const manifest = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
// Keep expectations independent of the candidate: removing a documented subpath
// must fail even when its source file remains in the tarball.
const subpaths = [
  "document",
  "metadata",
  "navigation",
  "fonts.css",
  "portfolio",
  "publication",
  "header",
  "footer",
  "article",
  "post-list",
  "taxonomy-section",
  "reading-progress",
  "focus-mode",
  "copy-link",
  "reading-time",
  "publication.css",
  "search.css",
  "tag-list",
  "static-offline",
];
assert.deepEqual(
  Object.keys(manifest.exports).sort(),
  subpaths.map((name) => `./${name}`).sort(),
  "Installed package must retain the reviewed documented exports",
);
const resolutions = JSON.parse(
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
      import assert from 'node:assert/strict';
      assert.throws(() => import.meta.resolve('@effortlessmetrics/astro-offline/integration'),
        {code:'ERR_MODULE_NOT_FOUND'});
      console.log(JSON.stringify(${JSON.stringify(subpaths)}.map(name =>
        import.meta.resolve('astromache/' + name))));
    `,
    ],
    { cwd: consumer, encoding: "utf8" },
  ),
);
for (const resolution of resolutions)
  assert.ok(inside(installed, await realpath(new URL(resolution))));
const requireAstro = createRequire(
  await realpath(join(consumer, "node_modules/astro/package.json")),
);
const vite = JSON.parse(await readFile(requireAstro.resolve("vite/package.json"), "utf8"));
assert.equal(vite.name, "vite", "Use stock Astro's Vite, without the producer override");
run(["exec", "astro", "build"], consumer);
const html = await readFile(join(consumer, "dist/index.html"), "utf8");
assert.match(html, /<title>Clean consumer<\/title>/);
assert.match(html, /1 min read/);
assert.match(html, /id="ssr-navigation">false<\/output>/);
assert.match(
  await readFile(join(consumer, "dist/portfolio/index.html"), "utf8"),
  /<title>Portfolio<\/title>/,
);
const stylesheets = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)];
assert.ok(stylesheets.length, "Consumer must emit linked stylesheets");
const css = (
  await Promise.all(stylesheets.map(([, href]) => readFile(join(consumer, "dist", href), "utf8")))
).join("\n");
assert.match(css, /--tas-surface:\s*var\(--content-bg\)/, "search.css must supply search tokens");
assert.match(css, /\[data-tas-dialog\]/, "search.css must supply scoped search presentation");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const receipt = {
  node: process.version,
  archive,
  packageSha256: sha256(await readFile(archive)),
  lockSha256: sha256(lock),
  consumer,
  installed,
  exports: subpaths,
  optionalOfflinePeerInstalled: false,
  vite: vite.version,
  htmlSha256: sha256(html),
  cssSha256: sha256(css),
};
await writeFile(join(root, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
console.log("Documented export consumer receipt", JSON.stringify(receipt));

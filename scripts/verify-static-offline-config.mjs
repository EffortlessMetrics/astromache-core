import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, writeFile, access } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const producer = await realpath(fileURLToPath(new URL("../", import.meta.url)));
const root = await realpath(
  await mkdtemp(
    join(
      process.env.ASTROMACHE_QUALIFICATION_ROOT ?? process.env.RUNNER_TEMP ?? tmpdir(),
      "static-offline-config-",
    ),
  ),
);
assert.ok(
  root !== producer && !root.startsWith(producer + sep),
  "Consumer must live outside producer",
);
const manager = join(producer, "node_modules/pnpm/bin/pnpm.cjs");
const manifest = JSON.parse(
  await readFile(join(producer, "packages/astromache/package.json"), "utf8"),
);
const archive = `astromache-${manifest.version}.tgz`;
execFileSync(process.execPath, [manager, "pack", "--pack-destination", root], {
  cwd: join(producer, "packages/astromache"),
  stdio: "inherit",
});
const consumer = join(root, "consumer");
await mkdir(join(consumer, "vendor"), { recursive: true });
await cp(join(root, archive), join(consumer, "vendor", archive));
await cp(
  join(producer, "vendor/effortlessmetrics-astro-offline-0.1.4.tgz"),
  join(consumer, "vendor/effortlessmetrics-astro-offline-0.1.4.tgz"),
);
await writeFile(
  join(consumer, "package.json"),
  JSON.stringify(
    {
      name: "static-offline-config-consumer",
      private: true,
      type: "module",
      dependencies: {
        astro: "7.3.5",
        astromache: `file:vendor/${archive}`,
        "@effortlessmetrics/astro-offline": "file:vendor/effortlessmetrics-astro-offline-0.1.4.tgz",
      },
    },
    null,
    2,
  ),
);
await writeFile(join(consumer, "pnpm-workspace.yaml"), "packages:\n  - .\n");
const run = (args) =>
  execFileSync(process.execPath, [manager, ...args], {
    cwd: consumer,
    stdio: "inherit",
    timeout: 120000,
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" },
  });
run([
  "install",
  "--ignore-scripts",
  "--store-dir",
  process.env.ASTROMACHE_QUALIFICATION_STORE ?? join(root, "store"),
]);
run([
  "install",
  "--frozen-lockfile",
  "--ignore-scripts",
  "--store-dir",
  process.env.ASTROMACHE_QUALIFICATION_STORE ?? join(root, "store"),
]);
const installed = await realpath(join(consumer, "node_modules/astromache"));
const location = relative(consumer, installed);
assert.ok(
  location && location !== ".." && !location.startsWith(`..${sep}`) && !isAbsolute(location),
  "Must load installed archive inside consumer",
);
await mkdir(join(consumer, "src/pages"), { recursive: true });
for (const page of ["index", "article", "offline", "contact", "404"])
  await writeFile(
    join(consumer, `src/pages/${page}.astro`),
    `---\nimport Document from 'astromache/document';\n---\n<Document title="${page}" description="Configuration consumer" language="en" canonical={new URL('https://configuration.example/${page}/')}><h1>${page}</h1></Document>\n`,
  );
await mkdir(join(consumer, "public"), { recursive: true });
await writeFile(join(consumer, "public/asset.json"), JSON.stringify({ fixture: true }));
const policy = {
  cachePrefix: "config-core-proof-",
  workerFile: "reading-worker.js",
  globPatterns: ["**/*.{html,js,css,json}"],
  maxBytes: 100000,
  maxResources: 20,
  excludedPages: ["/contact/"],
  worker: {
    navigationStrategy: "network-first",
    stripQuery: false,
    navigationFallback: "/offline/index.html",
  },
};
const exists = async (path) =>
  access(path).then(
    () => true,
    () => false,
  );
const probes = [];
async function probe(name, check) {
  try {
    await check();
    probes.push({ name, pass: true });
  } catch (error) {
    probes.push({ name, pass: false, error: error.message });
  }
}
async function build(name, config = {}, options = policy) {
  const file = join(consumer, `${name}.config.mjs`);
  await writeFile(
    file,
    `import {defineConfig} from 'astro/config';\nimport staticOffline from 'astromache/static-offline';\nexport default defineConfig({...${JSON.stringify({ site: "https://configuration.example", outDir: `./dist-${name}`, ...config })},integrations:[staticOffline(${JSON.stringify(options)})]});\n`,
  );
  const result = spawnSync(
    process.execPath,
    [join(consumer, "node_modules/astro/bin/astro.mjs"), "build", "--config", `${name}.config.mjs`],
    {
      cwd: consumer,
      encoding: "utf8",
      timeout: 60000,
      env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" },
    },
  );
  await writeFile(join(root, `${name}.log`), result.stdout + result.stderr);
  return result;
}
await probe("non-root base fails before output", async () => {
  const result = await build("base", { base: "/docs/" });
  assert.notEqual(
    result.status,
    0,
    "Non-root base must fail during configuration instead of emitting unprefixed URLs",
  );
  assert.match(result.stdout + result.stderr, /astromache\/static-offline.*base.*\//i);
  assert.equal(await exists(join(consumer, "dist-base/reading-worker.js")), false);
  assert.equal(await exists(join(consumer, "dist-base/index.html")), false);
});
await probe("file output fails before output", async () => {
  const result = await build("file", { build: { format: "file" } });
  assert.notEqual(
    result.status,
    0,
    "File output must fail during configuration instead of silently omitting HTML",
  );
  assert.match(
    result.stdout + result.stderr,
    /astromache\/static-offline.*build\.format.*directory/i,
  );
  assert.equal(await exists(join(consumer, "dist-file/reading-worker.js")), false);
  assert.equal(await exists(join(consumer, "dist-file/index.html")), false);
});
for (const [index, receiptFile] of [
  "sw.js",
  "index.html",
  "custom[1].json",
  "../custom.json",
  "NUL.json",
].entries()) {
  await probe(`unsupported receipt filename ${receiptFile} fails before output`, async () => {
    const name = `invalid-receipt-${index}`;
    const result = await build(name, {}, { ...policy, receiptFile });
    assert.notEqual(result.status, 0, "Unsafe receipt names must fail during configuration");
    assert.match(result.stdout + result.stderr, /astromache\/static-offline.*receiptFile.*\.json/i);
    assert.equal(await exists(join(consumer, `dist-${name}/reading-worker.js`)), false);
    assert.equal(await exists(join(consumer, `dist-${name}/index.html`)), false);
  });
}
await probe("default root directory policy remains supported", async () => {
  const result = await build("default");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const dir = join(consumer, "dist-default");
  const receipt = JSON.parse(await readFile(join(dir, "offline-receipt.json"), "utf8"));
  assert.deepEqual(receipt.urls, ["/", "/404/", "/article/", "/asset.json", "/offline/"]);
  assert.deepEqual(
    await readFile(join(dir, "404/index.html")),
    await readFile(join(dir, "404.html")),
  );
  const worker = await readFile(join(dir, "reading-worker.js"), "utf8");
  assert.ok(worker.includes('"navigationStrategy":"network-first"'));
  assert.ok(worker.includes('"stripQuery":false'));
  assert.ok(worker.includes('"navigationFallback":"/offline/"'));
});
await probe("custom receipt filename is honored", async () => {
  const options = { ...policy, receiptFile: "custom-receipt.json" };
  const result = await build("custom", {}, options);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const dir = join(consumer, "dist-custom");
  const receipt = JSON.parse(await readFile(join(dir, "custom-receipt.json"), "utf8"));
  assert.deepEqual(receipt.urls, ["/", "/404/", "/article/", "/asset.json", "/offline/"]);
  assert.equal(await exists(join(dir, "offline-receipt.json")), false);
  await writeFile(
    join(consumer, "rebuild-custom.mjs"),
    `import staticOffline from 'astromache/static-offline';\nawait staticOffline(${JSON.stringify(options)}).hooks['astro:build:done']({dir:new URL('./dist-custom/',import.meta.url)});\n`,
  );
  execFileSync(process.execPath, ["rebuild-custom.mjs"], {
    cwd: consumer,
    stdio: "inherit",
    timeout: 60000,
  });
  assert.equal(
    JSON.parse(await readFile(join(dir, "custom-receipt.json"), "utf8")).revision,
    receipt.revision,
  );
});
const receipt = {
  packageVersion: manifest.version,
  packageSha256: createHash("sha256")
    .update(await readFile(join(root, archive)))
    .digest("hex"),
  producerSha: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: producer,
    encoding: "utf8",
  }).trim(),
  consumer,
  installed,
  probes,
};
await writeFile(join(root, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
console.log("Packed static offline configuration receipt", JSON.stringify(receipt));
assert.ok(
  probes.every((probe) => probe.pass),
  JSON.stringify(probes),
);

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cp,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
  access,
} from "node:fs/promises";
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
// Optional preserved stock dependency graph for offline qualification; CI resolves afresh.
const lockfileSeed = process.env.ASTROMACHE_CONFIG_LOCKFILE;
if (lockfileSeed) await cp(lockfileSeed, join(consumer, "pnpm-lock.yaml"));
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
await writeFile(join(consumer, "public/keep.css"), "body { color: inherit; }");
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
  "a".repeat(256) + ".json",
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
await probe("public JSON asset collision fails before output", async () => {
  const original = await readFile(join(consumer, "public/asset.json"));
  const result = await build("public-collision", {}, { ...policy, receiptFile: "asset.json" });
  const destination = join(consumer, "dist-public-collision/asset.json");
  await writeFile(
    join(root, "public-collision-observation.json"),
    JSON.stringify(
      {
        status: result.status,
        original: original.toString(),
        emitted: (await exists(destination)) ? await readFile(destination, "utf8") : null,
      },
      null,
      2,
    ),
  );
  assert.notEqual(result.status, 0, "A receipt must not overwrite a public JSON asset");
  assert.match(
    result.stdout + result.stderr,
    /astromache\/static-offline.*receiptFile.*collision/i,
  );
  assert.equal(await exists(join(consumer, "dist-public-collision/index.html")), false);
  assert.equal(await exists(join(consumer, "dist-public-collision/reading-worker.js")), false);
  assert.deepEqual(await readFile(join(consumer, "public/asset.json")), original);
});
async function snapshot(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  const result = {};
  for (const entry of entries) {
    const path = join(entry.parentPath, entry.name);
    result[relative(directory, path).replaceAll(String.fromCharCode(92), "/")] = entry.isDirectory()
      ? "directory"
      : createHash("sha256")
          .update(await readFile(path))
          .digest("hex");
  }
  return result;
}
async function hook(name, options) {
  const file = `${name}.mjs`;
  await writeFile(
    join(consumer, file),
    `import staticOffline from 'astromache/static-offline';\nawait staticOffline(${JSON.stringify(options)}).hooks['astro:build:done']({dir:new URL('./${name}/',import.meta.url)});\n`,
  );
  const result = spawnSync(process.execPath, [file], {
    cwd: consumer,
    encoding: "utf8",
    timeout: 60000,
  });
  await writeFile(join(root, `${name}.log`), result.stdout + result.stderr);
  return result;
}
for (const [name, assetName, contents] of [
  ["hook-collision", "asset.json", JSON.stringify({ fixture: "keep this asset" })],
  ["hook-case-collision", "ASSET.json", JSON.stringify({ fixture: "keep this alias" })],
  [
    "hook-receipt-shaped-asset",
    "asset.json",
    JSON.stringify(
      {
        revision: "a".repeat(20),
        resources: 1,
        files: 1,
        bytes: 1,
        urls: ["/"],
        largestHtmlBytes: 1,
        workbox: "7.4.1",
      },
      null,
      2,
    ),
  ],
]) {
  await probe(`${name} rejects without partial output mutation`, async () => {
    const directory = join(consumer, name);
    await mkdir(directory);
    await writeFile(join(directory, "index.html"), "<h1>Keep the home page</h1>");
    await writeFile(join(directory, "404.html"), "<h1>Keep the root 404</h1>");
    await writeFile(join(directory, "reading-worker.js"), "/* keep the previous worker */");
    await writeFile(join(directory, "keep.css"), "body { color: inherit; }");
    await writeFile(join(directory, assetName), contents);
    const before = await snapshot(directory);
    const result = await hook(name, { ...policy, receiptFile: "asset.json" });
    const after = await snapshot(directory);
    await writeFile(
      join(root, `${name}-snapshot.json`),
      JSON.stringify({ status: result.status, before, after }, null, 2),
    );
    assert.notEqual(result.status, 0, "An existing asset is not an owned retained receipt");
    assert.match(
      result.stdout + result.stderr,
      /astromache\/static-offline.*receiptFile.*collision/i,
    );
    assert.deepEqual(
      after,
      before,
      "Collision rejection must preserve all output bytes and entries",
    );
  });
}
await probe("default root directory policy remains supported", async () => {
  const result = await build("default");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const dir = join(consumer, "dist-default");
  const receipt = JSON.parse(await readFile(join(dir, "offline-receipt.json"), "utf8"));
  assert.deepEqual(receipt.urls, [
    "/",
    "/404/",
    "/article/",
    "/asset.json",
    "/keep.css",
    "/offline/",
  ]);
  assert.deepEqual(
    await readFile(join(dir, "404/index.html")),
    await readFile(join(dir, "404.html")),
  );
  const worker = await readFile(join(dir, "reading-worker.js"), "utf8");
  assert.ok(worker.includes('"navigationStrategy":"network-first"'));
  assert.ok(worker.includes('"stripQuery":false'));
  assert.ok(worker.includes('"navigationFallback":"/offline/"'));
});
await probe("custom public directory case alias is rejected before output", async () => {
  const directory = join(consumer, "custom-public");
  await mkdir(directory);
  const original = await readFile(join(consumer, "dist-default/offline-receipt.json"));
  await writeFile(join(directory, "ASSET.json"), original);
  const result = await build(
    "custom-public-collision",
    { publicDir: "./custom-public" },
    { ...policy, receiptFile: "asset.json" },
  );
  assert.notEqual(result.status, 0);
  assert.match(
    result.stdout + result.stderr,
    /astromache\/static-offline.*receiptFile.*collision/i,
  );
  assert.equal(await exists(join(consumer, "dist-custom-public-collision/index.html")), false);
  assert.deepEqual(await readFile(join(directory, "ASSET.json")), original);
});
await probe("custom receipt filename is honored", async () => {
  const options = { ...policy, receiptFile: "custom-receipt.json" };
  const result = await build("custom", {}, options);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const dir = join(consumer, "dist-custom");
  const receipt = JSON.parse(await readFile(join(dir, "custom-receipt.json"), "utf8"));
  assert.deepEqual(receipt.urls, [
    "/",
    "/404/",
    "/article/",
    "/asset.json",
    "/keep.css",
    "/offline/",
  ]);
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
  await writeFile(
    join(dir, "article/index.html"),
    (await readFile(join(dir, "article/index.html"), "utf8")) + "\n<p>Retained output changed</p>",
  );
  execFileSync(process.execPath, ["rebuild-custom.mjs"], {
    cwd: consumer,
    stdio: "inherit",
    timeout: 60000,
  });
  const changed = JSON.parse(await readFile(join(dir, "custom-receipt.json"), "utf8"));
  assert.notEqual(changed.revision, receipt.revision);
  assert.deepEqual(changed.urls, receipt.urls);
  const updatedPolicy = {
    ...options,
    cachePrefix: "changed-config-core-proof-",
    worker: { ...options.worker, stripQuery: true },
  };
  await writeFile(
    join(consumer, "rebuild-custom.mjs"),
    `import staticOffline from 'astromache/static-offline';\nawait staticOffline(${JSON.stringify(updatedPolicy)}).hooks['astro:build:done']({dir:new URL('./dist-custom/',import.meta.url)});\n`,
  );
  execFileSync(process.execPath, ["rebuild-custom.mjs"], {
    cwd: consumer,
    stdio: "inherit",
    timeout: 60000,
  });
  const updated = JSON.parse(await readFile(join(dir, "custom-receipt.json"), "utf8"));
  assert.notEqual(updated.revision, changed.revision);
  assert.deepEqual(updated.urls, receipt.urls);
});
for (const [name, linked, receiptFile] of [
  ["receipt-hardlink", "custom-receipt.json", "custom-receipt.json"],
  ["worker-hardlink", "reading-worker.js", "custom-receipt.json"],
  ["new-receipt-worker-hardlink", "reading-worker.js", "new-receipt.json"],
]) {
  await probe(`${name} rejects without partial output mutation`, async () => {
    const directory = join(consumer, name);
    await cp(join(consumer, "dist-custom"), directory, { recursive: true });
    await link(join(directory, linked), join(directory, `linked-${linked}`));
    const before = await snapshot(directory);
    const result = await hook(name, { ...policy, receiptFile });
    const after = await snapshot(directory);
    await writeFile(
      join(root, `${name}-snapshot.json`),
      JSON.stringify({ status: result.status, before, after }, null, 2),
    );
    assert.notEqual(result.status, 0);
    assert.match(
      result.stdout + result.stderr,
      /astromache\/static-offline.*receiptFile.*collision/i,
    );
    assert.deepEqual(after, before);
  });
}
await probe("retained receipt worker filename change requires clean output", async () => {
  const name = "retained-worker-rename";
  const directory = join(consumer, name);
  await cp(join(consumer, "dist-custom"), directory, { recursive: true });
  const before = await snapshot(directory);
  const result = await hook(name, {
    ...policy,
    receiptFile: "custom-receipt.json",
    workerFile: "new-worker.js",
  });
  const after = await snapshot(directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /receiptFile.*collision/i);
  assert.deepEqual(after, before);
});
for (const [name, prepare, overrides] of [
  ["retained-receipt-rename", async () => {}, { receiptFile: "next-receipt.json" }],
  [
    "retained-pair-rename",
    async () => {},
    { receiptFile: "next-receipt.json", workerFile: "next-worker.js" },
  ],
  [
    "retained-orphan-worker",
    async (dir) => rm(join(dir, "offline-receipt.json")),
    { receiptFile: "next-receipt.json", workerFile: "next-worker.js" },
  ],
  [
    "retained-corrupt-receipt",
    async (dir) => writeFile(join(dir, "offline-receipt.json"), "{invalid"),
    { receiptFile: "next-receipt.json", workerFile: "next-worker.js" },
  ],
  [
    "retained-extra-pair",
    async (dir) => {
      await cp(join(dir, "reading-worker.js"), join(dir, "other-worker.js"));
      await cp(join(dir, "offline-receipt.json"), join(dir, "other-receipt.json"));
    },
    {},
  ],
  [
    "retained-corrupt-other-worker",
    async (dir) => {
      await writeFile(
        join(dir, "other-worker.js"),
        (await readFile(join(dir, "reading-worker.js"), "utf8")).replace(
          /const REVISION="[0-9a-f]{20}"/,
          'const REVISION="corrupt"',
        ),
      );
    },
    {},
  ],
  [
    "retained-duplicate-receipt",
    async (dir) => cp(join(dir, "offline-receipt.json"), join(dir, "other-receipt.json")),
    {},
  ],
]) {
  await probe(`${name} rejects without partial output mutation`, async () => {
    const directory = join(consumer, name);
    await cp(join(consumer, "dist-default"), directory, { recursive: true });
    await writeFile(join(directory, "extra.json"), '{"fixture":"seventh asset"}');
    const initial = await hook(name, policy);
    assert.equal(initial.status, 0, initial.stdout + initial.stderr);
    const previous = JSON.parse(await readFile(join(directory, "offline-receipt.json"), "utf8"));
    assert.equal(previous.resources, 7);
    await prepare(directory);
    await rm(join(directory, "404"), { recursive: true });
    const before = await snapshot(directory);
    const result = await hook(name, { ...policy, ...overrides });
    const after = await snapshot(directory);
    await writeFile(
      join(root, `${name}-snapshot.json`),
      JSON.stringify({ status: result.status, previous, before, after }, null, 2),
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /receiptFile.*collision.*clean output/i);
    assert.deepEqual(after, before);
  });
}
await probe(
  "unrelated receipt-shaped JSON and worker-like JavaScript remain corpus assets",
  async () => {
    const name = "unrelated-retained-assets";
    const directory = join(consumer, name);
    await cp(join(consumer, "dist-default"), directory, { recursive: true });
    const receipt = JSON.parse(await readFile(join(directory, "offline-receipt.json"), "utf8"));
    const unrelated = JSON.stringify({ ...receipt, revision: "unrelated consumer data" });
    const javascript =
      "/*! @effortlessmetrics/astro-offline owner code - MIT alternative\n*/\nconsole.log('consumer asset');";
    await writeFile(join(directory, "unrelated.json"), unrelated);
    await writeFile(join(directory, "unrelated.js"), javascript);
    const result = await hook(name, policy);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const updated = JSON.parse(await readFile(join(directory, "offline-receipt.json"), "utf8"));
    assert.equal(updated.resources, 8);
    assert.ok(updated.urls.includes("/unrelated.json"));
    assert.ok(updated.urls.includes("/unrelated.js"));
    assert.equal(await readFile(join(directory, "unrelated.json"), "utf8"), unrelated);
    assert.equal(await readFile(join(directory, "unrelated.js"), "utf8"), javascript);
  },
);
await probe("changing both filenames succeeds after old generated files are removed", async () => {
  const name = "clean-retained-pair-rename";
  const directory = join(consumer, name);
  await cp(join(consumer, "dist-default"), directory, { recursive: true });
  await rm(join(directory, "reading-worker.js"));
  await rm(join(directory, "offline-receipt.json"));
  const result = await hook(name, {
    ...policy,
    receiptFile: "next-receipt.json",
    workerFile: "next-worker.js",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const updated = JSON.parse(await readFile(join(directory, "next-receipt.json"), "utf8"));
  assert.equal(updated.resources, 6);
  assert.deepEqual(updated.urls, [
    "/",
    "/404/",
    "/article/",
    "/asset.json",
    "/keep.css",
    "/offline/",
  ]);
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
  lockfileSeedSha256: lockfileSeed
    ? createHash("sha256")
        .update(await readFile(lockfileSeed))
        .digest("hex")
    : null,
  probes,
};
await writeFile(join(root, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
console.log("Packed static offline configuration receipt", JSON.stringify(receipt));
assert.ok(
  probes.every((probe) => probe.pass),
  JSON.stringify(probes),
);

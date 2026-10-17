import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";

// Exercise the delivered public export, reusing the warm optional peer without
// installing dependencies or running a full Astro/browser qualification.
const producer = fileURLToPath(new URL("../", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "offline paths café-"));
after(() => rm(root, { recursive: true, force: true }));
const modules = join(root, "node_modules");
await mkdir(modules);
execFileSync(
  process.execPath,
  [join(producer, "node_modules/pnpm/bin/pnpm.cjs"), "pack", "--pack-destination", root],
  {
    cwd: join(producer, "packages/astromache"),
    stdio: "pipe",
  },
);
const archive = (await readdir(root)).find((file) => file.endsWith(".tgz"));
execFileSync("tar", ["-xzf", join(root, archive), "-C", modules]);
await symlink(join(modules, "package"), join(modules, "astromache"), "junction");
await mkdir(join(modules, "@effortlessmetrics"));
await symlink(
  join(producer, "node_modules/@effortlessmetrics/astro-offline"),
  join(modules, "@effortlessmetrics/astro-offline"),
  "junction",
);
const resolved = execFileSync(
  process.execPath,
  ["--input-type=module", "-e", "console.log(import.meta.resolve('astromache/static-offline'))"],
  { cwd: root, encoding: "utf8" },
).trim();
const { default: staticOffline } = await import(resolved);
const options = { cachePrefix: "path-proof-", globPatterns: ["**/*.css"], maxBytes: 100000 };
async function output(name, files) {
  const directory = join(root, name);
  for (const [file, contents] of Object.entries({ "keep.css": "body{}", ...files })) {
    await mkdir(dirname(join(directory, file)), { recursive: true });
    await writeFile(join(directory, file), contents);
  }
  return directory;
}
const build = (directory) =>
  staticOffline(options).hooks["astro:build:done"]({ dir: pathToFileURL(directory + sep) });

test("packed preset maps native nested paths and preserves 404 page generation", async () => {
  const directory = await output("nested café", {
    "index.html": "root",
    "space café/nested/index.html": "nested",
    "404.html": "missing",
  });
  await build(directory);
  const receipt = JSON.parse(await readFile(join(directory, "offline-receipt.json"), "utf8"));
  assert.deepEqual(receipt.urls, ["/", "/404/", "/keep.css", "/space café/nested/"]);
  assert.equal(await readFile(join(directory, "404/index.html"), "utf8"), "missing");
});

test(
  "POSIX literal backslash directory fails before copying 404 or writing generated files",
  { skip: sep !== "/" },
  async () => {
    const directory = await output("literal directory", {
      "a\\b/index.html": "literal",
      "a/b/index.html": "different page",
      "404.html": "missing",
    });
    await assert.rejects(build(directory), /directory names containing a literal backslash/);
    for (const file of ["sw.js", "offline-receipt.json", "404/index.html"]) {
      await assert.rejects(readFile(join(directory, file)), { code: "ENOENT" });
    }
    assert.equal(await readFile(join(directory, "a\\b/index.html"), "utf8"), "literal");
  },
);

test(
  "POSIX literal backslash before index.html is not a directory page",
  { skip: sep !== "/" },
  async () => {
    const directory = await output("literal asset", {
      "index.html": "root",
      "asset\\index.html": "ordinary asset",
    });
    await build(directory);
    const receipt = JSON.parse(await readFile(join(directory, "offline-receipt.json"), "utf8"));
    assert.deepEqual(receipt.urls, ["/", "/keep.css"]);
  },
);

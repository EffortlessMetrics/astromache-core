import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const producer = await realpath(fileURLToPath(new URL("../", import.meta.url)));
assert.match(process.version, /^v24\./, "Use Node 24.19 or newer within major 24");
assert(Number(process.versions.node.split(".")[1]) >= 19, "Use Node 24.19 or newer");
assert.equal(
  process.argv.length,
  4,
  "Usage: node scripts/create-starter.mjs <publication|search-offline> <new-directory>",
);
const projects = {
  publication: "starters/publication",
  "search-offline": "recipes/search-offline",
};
const source = projects[process.argv[2]];
assert(source, "Choose publication or search-offline");
const requested = resolve(process.argv[3]);
// mkdir below requires an existing parent; resolve that parent's symlinks first.
const destination = join(await realpath(dirname(requested)), basename(requested));
const location = relative(producer, destination);
assert(
  location.startsWith(`..${sep}`) || isAbsolute(location),
  "Destination must be outside the producer checkout",
);
const manifest = JSON.parse(await readFile(join(producer, source, "package.json"), "utf8"));
const activeVendor = new Set(
  Object.values(manifest.dependencies)
    .filter((value) => value.startsWith("file:vendor/"))
    .map((value) => value.slice(5)),
);
const tracked = execFileSync("git", ["ls-files", "-z", "--", source], {
  cwd: producer,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
assert(tracked.length > 0, "Run from a Git clone of the reviewed producer");
// Refuse an existing consumer. Only tracked product files and active archives travel.
await mkdir(destination);
const created = await lstat(destination);
try {
  const hashes = {};
  for (const file of tracked) {
    const local = file.slice(source.length + 1);
    if (local.startsWith("vendor/") && !activeVendor.has(local)) continue;
    const original = join(producer, file);
    assert.equal(
      await realpath(original),
      original,
      `Source file must not resolve through a link: ${file}`,
    );
    const target = join(destination, local);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(original, target);
    if (activeVendor.has(local))
      hashes[local] = createHash("sha256")
        .update(await readFile(target))
        .digest("hex");
  }
  assert.equal(
    Object.keys(hashes).length,
    activeVendor.size,
    "Every active archive must be saved in source",
  );
  await writeFile(
    join(destination, "STARTER-DELIVERY.json"),
    JSON.stringify(
      {
        project: process.argv[2],
        archives: hashes,
        publication: "unpublished candidates; keep vendor archives and frozen lockfile",
        install: "pnpm install --frozen-lockfile",
        qualify: "pnpm qualify",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        destination,
        archives: hashes,
        next: "pnpm install --frozen-lockfile, pnpm qualify, pnpm dev",
      },
      null,
      2,
    ),
  );
} catch (error) {
  const current = await lstat(destination);
  assert(
    !current.isSymbolicLink() && current.dev === created.dev && current.ino === created.ino,
    "Export destination ownership changed; preserve it for review",
  );
  assert.equal(
    await realpath(destination),
    destination,
    "Refuse cleanup outside the exact newly created destination",
  );
  await rm(destination, { recursive: true, force: true });
  throw error;
}

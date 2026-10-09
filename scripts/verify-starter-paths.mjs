import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const producer = await realpath(fileURLToPath(new URL("../", import.meta.url)));
const temporary = await realpath(tmpdir());
const fixture = await realpath(await mkdtemp(join(temporary, "starter-paths-")));
const scope = relative(temporary, fixture);
assert(
  scope &&
    !isAbsolute(scope) &&
    scope !== ".." &&
    !scope.startsWith(`..${sep}`) &&
    basename(fixture).startsWith("starter-paths-"),
);
const outsideAlias = join(fixture, "into-producer");
const insideAlias = join(producer, "node_modules", basename(fixture));
const leaf = `rejected-${basename(fixture)}`;
const run = (destination) =>
  spawnSync(
    process.execPath,
    [join(producer, "scripts/create-starter.mjs"), "publication", destination],
    { cwd: producer, encoding: "utf8" },
  );
await symlink(producer, outsideAlias, "junction");
try {
  const rejected = run(join(outsideAlias, leaf));
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /Destination must be outside the producer checkout/);
  await assert.rejects(access(join(producer, leaf)), { code: "ENOENT" });
  await mkdir(join(fixture, "outside"));
  await symlink(join(fixture, "outside"), insideAlias, "junction");
  try {
    const accepted = run(join(insideAlias, "consumer"));
    assert.equal(accepted.status, 0, accepted.stderr);
    const destination = join(fixture, "outside", "consumer");
    assert.equal(await realpath(join(insideAlias, "consumer")), await realpath(destination));
    assert.equal(
      JSON.parse(await readFile(join(destination, "package.json"), "utf8")).private,
      true,
    );
    const refused = run(join(insideAlias, "consumer"));
    assert.notEqual(refused.status, 0, "Existing consumer must not be replaced");
    assert.match(refused.stderr, /EEXIST/);
    console.log(
      "Canonical export paths passed: alias into producer refused without writes; alias out accepted; existing consumer refused.",
    );
  } finally {
    await unlink(insideAlias);
  }
  const assets = join(producer, "starters/publication/public");
  const savedAssets = join(producer, "node_modules", `${basename(fixture)}-saved-assets`);
  const outsideAssets = join(fixture, "outside-assets");
  const rejectedDelivery = join(fixture, "linked-source-consumer");
  await cp(assets, outsideAssets, { recursive: true });
  await writeFile(join(outsideAssets, "favicon.svg"), "outside-source sentinel\n");
  await rename(assets, savedAssets);
  try {
    await symlink(outsideAssets, assets, "junction");
    try {
      const rejected = run(rejectedDelivery);
      assert.notEqual(rejected.status, 0, "Linked source assets must not travel into a delivery");
      assert.match(rejected.stderr, /Source file must not resolve through a link/);
      await assert.rejects(access(rejectedDelivery), { code: "ENOENT" });
      assert.equal(
        await readFile(join(outsideAssets, "favicon.svg"), "utf8"),
        "outside-source sentinel\n",
      );
      console.log("Linked source refused; partial delivery removed; outside source preserved.");
    } finally {
      await unlink(assets);
    }
  } finally {
    await rename(savedAssets, assets);
  }
} finally {
  await unlink(outsideAlias);
  assert.equal(await realpath(fixture), fixture);
  await rm(fixture, { recursive: true, force: true });
}

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
const save = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + "\n");
const inside = (parent, child) => {
  const path = relative(parent, child);
  return path && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
};

// Snapshot the exported application before installation. Every application file,
// including routes, content, config, styles, search and specialist archives, is
// compared again after qualification; only the dependency delivery may change.
async function snapshot(directory, excluded = new Set()) {
  const files = {};
  async function visit(path = "") {
    for (const entry of await readdir(join(directory, path), { withFileTypes: true })) {
      const file = path ? `${path}/${entry.name}` : entry.name;
      if (excluded.has(file)) continue;
      assert.ok(!entry.isSymbolicLink(), `Export must contain ordinary files: ${file}`);
      if (entry.isDirectory()) await visit(file);
      else files[file] = sha256(await readFile(join(directory, file)));
    }
  }
  await visit();
  return files;
}

export async function packCurrentPublication(producer, root, manager) {
  const directory = join(root, "current-package");
  await mkdir(directory);
  const manifest = await json(join(producer, "packages/astromache/package.json"));
  execFileSync(process.execPath, [manager, "pack", "--pack-destination", directory], {
    cwd: join(producer, "packages/astromache"),
    stdio: "inherit",
  });
  const archives = (await readdir(directory)).filter((file) => file.endsWith(".tgz"));
  assert.equal(archives.length, 1);
  const archive = archives[0];
  assert.equal(archive, `astromache-${manifest.version}.tgz`);
  const tarball = join(directory, archive);
  const unpacked = join(directory, "unpacked");
  await mkdir(unpacked);
  execFileSync("tar", ["-xzf", tarball, "-C", unpacked]);
  const packed = await json(join(unpacked, "package/package.json"));
  assert.deepEqual(packed, manifest, "Pack must deliver the current public manifest");
  return {
    archive,
    tarball,
    unpacked: join(unpacked, "package"),
    manifest,
    sha256: sha256(await readFile(tarball)),
    sourceHead: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: producer,
      encoding: "utf8",
    }).trim(),
  };
}

async function pinDelivery(directory, candidate) {
  const manifest = await json(join(directory, "package.json"));
  const oldPin = manifest.dependencies.astromache;
  const pin = `file:vendor/${candidate.archive}`;
  await cp(candidate.tarball, join(directory, "vendor", candidate.archive));
  manifest.dependencies.astromache = pin;
  await save(join(directory, "package.json"), manifest);
  const delivery = await json(join(directory, "STARTER-DELIVERY.json"));
  delete delivery.archives[oldPin.slice(5)];
  delivery.archives[pin.slice(5)] = candidate.sha256;
  await save(join(directory, "STARTER-DELIVERY.json"), delivery);
  if (delivery.project === "search-offline") {
    const artifacts = await json(join(directory, "candidate-artifacts.json"));
    artifacts.astromache = {
      version: candidate.manifest.version,
      sha256: candidate.sha256,
      packageSourceHead: candidate.sourceHead,
    };
    await save(join(directory, "candidate-artifacts.json"), artifacts);
  }
}

export async function verifyPublicationDelivery(directory, candidate) {
  const manifest = await json(join(directory, "package.json"));
  assert.equal(manifest.dependencies.astromache, `file:vendor/${candidate.archive}`);
  assert.equal(
    manifest.pnpm,
    undefined,
    "Full consumer must not inherit producer patches/overrides",
  );
  const delivery = await json(join(directory, "STARTER-DELIVERY.json"));
  const expected = Object.values(manifest.dependencies)
    .filter((pin) => pin.startsWith("file:vendor/"))
    .map((pin) => pin.slice(5));
  assert.deepEqual(
    Object.keys(delivery.archives).sort(),
    expected.sort(),
    "Delivery must match active archives",
  );
  for (const file of expected) {
    assert.equal(
      sha256(await readFile(join(directory, file))),
      delivery.archives[file],
      `Delivery digest mismatch: ${file}`,
    );
  }
  assert.equal(
    delivery.archives[`vendor/${candidate.archive}`],
    candidate.sha256,
    "Delivery must identify freshly packed bytes",
  );
  if (delivery.project === "search-offline") {
    const artifacts = await json(join(directory, "candidate-artifacts.json"));
    assert.deepEqual(
      artifacts.astromache,
      {
        version: candidate.manifest.version,
        sha256: candidate.sha256,
        packageSourceHead: candidate.sourceHead,
      },
      "Candidate metadata must match current delivery",
    );
  }
}

export async function upgradePublication(directory, candidate, run, { recipe }) {
  const before = await snapshot(directory);
  const originalLock = await readFile(join(directory, "pnpm-lock.yaml"), "utf8");
  const manifest = await json(join(directory, "package.json"));
  const delivery = await json(join(directory, "STARTER-DELIVERY.json"));
  const artifacts = recipe ? await json(join(directory, "candidate-artifacts.json")) : undefined;
  run(["install", "--frozen-lockfile", "--ignore-scripts"]);
  const baseline = join(dirname(directory), "historical-recipe-output");
  if (recipe) {
    run(["build"]);
    await cp(join(directory, "dist"), baseline, { recursive: true });
  }
  await pinDelivery(directory, candidate);
  // Resolve the new pin, then delete the entire installation and prove that the
  // saved lockfile alone can recreate the exact candidate without scripts.
  run(["install", "--lockfile-only", "--ignore-scripts"]);
  const lock = await readFile(join(directory, "pnpm-lock.yaml"));
  assert.notEqual(sha256(lock), before["pnpm-lock.yaml"], "Upgrade must update lockfile");
  const unrelatedLock = (text) =>
    text
      .replace(/^ {6}astromache:\n(?: {8}.*\n)+/gm, "")
      .replace(/^ {2}astromache@.*:\n(?: {4}.*\n|\n)*/gm, "")
      .replace(/\n+/g, "\n");
  assert.equal(
    unrelatedLock(lock.toString()),
    unrelatedLock(originalLock),
    "Only astromache importer/package/snapshot lock entries may change",
  );

  assert.ok(
    !lock.toString().includes(manifest.dependencies.astromache),
    "Historical pin must leave active lockfile",
  );
  assert.ok(lock.toString().includes(`file:vendor/${candidate.archive}`));
  assert.ok(
    lock.toString().includes(
      `sha512-${createHash("sha512")
        .update(await readFile(candidate.tarball))
        .digest("base64")}`,
    ),
    "Lock integrity must identify packed archive",
  );
  await rm(join(directory, "node_modules"), { recursive: true, force: true });
  await rm(join(directory, ".astro"), { recursive: true, force: true });
  run(["install", "--frozen-lockfile", "--ignore-scripts"]);
  assert.deepEqual(
    await readFile(join(directory, "pnpm-lock.yaml")),
    lock,
    "Frozen reinstall cannot rewrite lockfile",
  );
  await verifyPublicationDelivery(directory, candidate);
  const installed = await realpath(join(directory, "node_modules/astromache"));
  assert.ok(
    inside(await realpath(directory), installed),
    "Package must be installed inside independent consumer",
  );
  for (const [file, digest] of Object.entries(await snapshot(candidate.unpacked))) {
    assert.equal(
      sha256(await readFile(join(installed, file))),
      digest,
      `Installed archive identity: ${file}`,
    );
  }
  const exports = Object.keys(candidate.manifest.exports).map(
    (subpath) => `astromache/${subpath.slice(2)}`,
  );
  const resolvedExports = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `console.log(JSON.stringify(${JSON.stringify(exports)}.map((name) => import.meta.resolve(name))))`,
      ],
      { cwd: directory, encoding: "utf8" },
    ),
  );
  for (const [index, subpath] of exports.entries()) {
    const resolved = await realpath(new URL(resolvedExports[index]));
    assert.ok(
      inside(installed, resolved),
      `Public export must resolve inside installed package: ${subpath}`,
    );
  }
  const expectedManifest = structuredClone(manifest);
  expectedManifest.dependencies.astromache = `file:vendor/${candidate.archive}`;
  assert.deepEqual(
    await json(join(directory, "package.json")),
    expectedManifest,
    "Only dependency pin may change in manifest",
  );
  const expectedDelivery = structuredClone(delivery);
  delete expectedDelivery.archives[manifest.dependencies.astromache.slice(5)];
  expectedDelivery.archives[`vendor/${candidate.archive}`] = candidate.sha256;
  assert.deepEqual(await json(join(directory, "STARTER-DELIVERY.json")), expectedDelivery);
  if (recipe) {
    const current = await json(join(directory, "candidate-artifacts.json"));
    assert.deepEqual(
      current,
      {
        ...artifacts,
        astromache: {
          version: candidate.manifest.version,
          sha256: candidate.sha256,
          packageSourceHead: candidate.sourceHead,
        },
      },
      "Only current package delivery metadata may change",
    );
    assert.deepEqual(
      current.staticSearch,
      artifacts.staticSearch,
      "Frozen static-search identity must not change",
    );
    assert.deepEqual(
      current.astroOffline,
      artifacts.astroOffline,
      "Offline delivery must not change",
    );
  }
  const allowed = new Set([
    "package.json",
    "pnpm-lock.yaml",
    "STARTER-DELIVERY.json",
    ...(recipe ? ["candidate-artifacts.json"] : []),
  ]);
  const verifyUnchanged = async () => {
    const excluded = new Set([
      "node_modules",
      "dist",
      ".astro",
      "LIFECYCLE-QUALIFICATION.json",
      "CANONICAL-QUALIFICATION.json",
      "CURRENT-PACKED-QUALIFICATION.json",
    ]);
    const after = await snapshot(directory, excluded);
    for (const file of [...allowed, `vendor/${candidate.archive}`]) delete after[file];
    const expected = { ...before };
    for (const file of allowed) delete expected[file];
    assert.deepEqual(
      after,
      expected,
      "Consumer routes/content/config/styles and specialist bytes/file set must remain identical",
    );
  };
  await verifyUnchanged();
  return {
    baseline,
    installed,
    verifyUnchanged,
    receipt: {
      version: candidate.manifest.version,
      packageSha256: candidate.sha256,
      sourceHead: candidate.sourceHead,
      installed,
      frozenLockSha256: sha256(lock),
      unrelatedLockEntriesUnchanged: true,
      unchangedFiles: Object.keys(before).filter((file) => !allowed.has(file)).length,
    },
  };
}

export async function verifyPublicationUpgradeNegatives(directory, candidate, run) {
  for (const file of ["STARTER-DELIVERY.json", "candidate-artifacts.json"]) {
    const path = join(directory, file);
    const original = await readFile(path);
    const value = JSON.parse(original);
    if (file === "STARTER-DELIVERY.json")
      value.archives[`vendor/${candidate.archive}`] = "0".repeat(64);
    else value.astromache.sha256 = "0".repeat(64);
    try {
      await save(path, value);
      await assert.rejects(
        verifyPublicationDelivery(directory, candidate),
        /Delivery digest mismatch|Candidate metadata must match current delivery/,
      );
    } finally {
      await writeFile(path, original);
    }
  }
  const broken = join(dirname(directory), "broken-public-export");
  await cp(directory, broken, {
    recursive: true,
    filter: (source) =>
      !["node_modules", "dist", ".astro"].includes(relative(directory, source).split(sep)[0]),
  });
  const unpacked = join(dirname(directory), "broken-package");
  await cp(candidate.unpacked, join(unpacked, "package"), { recursive: true });
  const manifest = await json(join(unpacked, "package/package.json"));
  manifest.exports["./article"] = "./src/missing-article.astro";
  await save(join(unpacked, "package/package.json"), manifest);
  const tarball = join(unpacked, "astromache-broken-export.tgz");
  execFileSync("tar", ["-czf", tarball, "-C", unpacked, "package"]);
  const bad = {
    ...candidate,
    archive: "astromache-broken-export.tgz",
    tarball,
    sha256: sha256(await readFile(tarball)),
  };
  await pinDelivery(broken, bad);
  await verifyPublicationDelivery(broken, bad);
  run(["install", "--ignore-scripts"], broken);
  const result = spawnSync(
    process.execPath,
    [join(broken, "node_modules/astro/bin/astro.mjs"), "build"],
    { cwd: broken, encoding: "utf8", timeout: 300000, env: process.env },
  );
  assert.equal(result.error, undefined, "Negative build must execute normally");
  assert.notEqual(result.status, 0, "Broken public article export must fail full consumer build");
  assert.match(
    result.stdout + result.stderr,
    /astromache\/article|missing-article\.astro/,
    "Failure must identify the broken public export",
  );
  await writeFile(join(broken, "negative-build.log"), result.stdout + result.stderr);
  console.log(
    "Current full-consumer negatives passed: wrong delivery hash, wrong candidate metadata, and broken public article export rejected.",
  );
  return {
    wrongDelivery: true,
    wrongCandidateMetadata: true,
    brokenPublicExport: { rejected: true, status: result.status },
  };
}

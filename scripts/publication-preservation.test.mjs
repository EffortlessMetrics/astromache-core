import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  capturePublicationPreservation,
  packCurrentPublication,
  verifyPublicationDelivery,
} from "./verify-publication-upgrade.mjs";
import { customizePublicationConsumer } from "./publication-consumer-fixture.mjs";

const producer = fileURLToPath(new URL("../", import.meta.url));
for (const project of ["publication", "search-offline"]) {
  test(project + " upgraded consumer preservation and destructive controls", async () => {
    const root = await mkdtemp(join(tmpdir(), "publication-preservation-"));
    const directory = join(root, "consumer");
    execFileSync(process.execPath, [
      join(producer, "scripts/create-starter.mjs"),
      project,
      directory,
    ]);
    await customizePublicationConsumer(directory);
    const candidate = { archive: "astromache-preservation-control.tgz" };
    const verify = await capturePublicationPreservation(directory, candidate, {
      recipe: project === "search-offline",
    });
    const manifestPath = join(directory, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.dependencies.astromache = "file:vendor/" + candidate.archive;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    // These are guard controls, not installation evidence. Delivery validation
    // remains the real upgrade's separate responsibility.
    await writeFile(join(directory, "vendor", candidate.archive), "candidate delivery control");
    await verify();
    const files = [
      "src/content/notes/a-quiet-system.md",
      "src/styles/publication.css",
      "public/consumer-owned.bin",
      "CONSUMER-CONTENT-NOTICE.txt",
      "licenses/template/LICENSE",
      "licenses/template/LICENSE-MIT",
      "licenses/template/LICENSE-APACHE",
      "licenses/template/README.md",
    ];
    for (const file of files) {
      const path = join(directory, file);
      const original = await readFile(path);
      try {
        await writeFile(path, "overwritten during upgrade");
        await assert.rejects(verify(), /must remain identical/, file + " overwrite");
        await unlink(path);
        await assert.rejects(verify(), /must remain identical/, file + " removal");
      } finally {
        await writeFile(path, original);
      }
      await verify();
    }
    for (const field of ["license", "description", "private"]) {
      const original = await readFile(manifestPath);
      try {
        await writeFile(manifestPath, JSON.stringify({ ...manifest, [field]: "changed" }));
        await assert.rejects(verify(), /Only dependency pin/, field);
      } finally {
        await writeFile(manifestPath, original);
      }
    }
    const added = join(directory, "LICENSE");
    try {
      await writeFile(added, "Accidental blanket application license");
      await assert.rejects(verify(), /must remain identical/);
    } finally {
      await unlink(added);
    }
    await verify();
    console.log(
      project + ": allowed delivery accepted; 20 destructive mutations rejected; " + directory,
    );
  });
}

test("current publication packing attributes clean and modified checkouts", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ps-"));
  const source = join(root, "source");
  const packageDirectory = join(source, "packages/astromache");
  await mkdir(packageDirectory, { recursive: true });
  const manifest = { name: "astromache", version: "0.0.0", files: ["*.js"] };
  await writeFile(join(packageDirectory, "package.json"), JSON.stringify(manifest) + "\n");
  const original = 'export const fixture = "baseline";\n';
  const modulePath = join(packageDirectory, "index.js");
  await writeFile(modulePath, original);
  const git = (...args) => execFileSync("git", args, { cwd: source, encoding: "utf8" }).trim();
  git("init", "--initial-branch=main");
  git("add", ".");
  git(
    "-c",
    "user.name=Publication fixture",
    "-c",
    "user.email=publication@example.invalid",
    "commit",
    "-m",
    "Baseline package fixture",
  );
  const head = git("rev-parse", "HEAD");

  // Hosted preservation controls run before dependency installation. This small
  // packer supplies real tar bytes through the production helper's manager seam;
  // it does not qualify pnpm's archive inclusion rules or install a consumer.
  const manager = join(root, "pack-fixture.mjs");
  await writeFile(
    manager,
    `import { execFileSync } from "node:child_process";
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
const directory = process.argv[process.argv.indexOf("--pack-destination") + 1];
const staging = join(directory, "fixture");
await mkdir(staging);
await cp(process.cwd(), join(staging, "package"), { recursive: true });
execFileSync("tar", ["-czf", join(directory, "astromache-0.0.0.tgz"), "-C", staging, "package"]);
`,
  );
  const pack = async (name) => {
    const run = join(root, name);
    await mkdir(run);
    return packCurrentPublication(source, run, manager);
  };
  const clean = await pack("clean");
  await t.test("clean checkout", () => {
    assert.equal(clean.sourceHead, head);
    assert.deepEqual(clean.sourceState, { dirty: false, gitStatusPorcelainV1: "" });
  });

  await t.test("complete Git status larger than 1 MiB", async () => {
    const directory = join(source, "u");
    await mkdir(directory);
    // Bound ASCII paths below 240 characters for Windows, and create just
    // enough empty, unpackaged files to exceed the default exec buffer.
    const nameLength = Math.min(180, 240 - directory.length - 1);
    assert.ok(nameLength >= 16, "Temporary directory must leave room for fixture filenames");
    const count = Math.ceil((1024 * 1024 + 4096) / (nameLength + 6));
    const names = Array.from(
      { length: count },
      (_, index) => `${String(index).padStart(5, "0")}-${"x".repeat(nameLength - 10)}.txt`,
    );
    try {
      for (let start = 0; start < count; start += 64) {
        await Promise.all(
          names.slice(start, start + 64).map((name) => writeFile(join(directory, name), "")),
        );
      }
      const expectedStatus = names.map((name) => `?? u/${name}\0`).join("");
      assert.ok(Buffer.byteLength(expectedStatus) > 1024 * 1024);
      const candidate = await pack("large-status");
      assert.equal(candidate.sourceHead, head);
      assert.deepEqual(candidate.sourceState, {
        dirty: true,
        gitStatusPorcelainV1: expectedStatus,
      });
      assert.equal(
        candidate.sha256,
        createHash("sha256")
          .update(await readFile(candidate.tarball))
          .digest("hex"),
        "Large status must not replace archive identity",
      );
      assert.equal(await readFile(join(candidate.unpacked, "index.js"), "utf8"), original);
      console.log(
        `Complete Git status: ${count} files, ${Buffer.byteLength(expectedStatus)} bytes; maximum fixture path ${join(directory, names[0]).length} characters`,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  for (const state of ["staged", "unstaged", "staged and unstaged", "untracked"]) {
    await t.test(state + " checkout", async () => {
      await writeFile(modulePath, original);
      git("add", "packages/astromache/index.js");
      const modified = `export const fixture = ${JSON.stringify(state)};\n`;
      let expectedStatus;
      if (state === "untracked") {
        await writeFile(join(packageDirectory, "extra module.js"), modified);
        expectedStatus = "?? packages/astromache/extra module.js\0";
      } else {
        await writeFile(modulePath, modified);
        if (state !== "unstaged") git("add", "packages/astromache/index.js");
        if (state === "staged and unstaged") {
          await writeFile(modulePath, modified + "// working tree differs from index\n");
        }
        expectedStatus =
          { staged: "M ", unstaged: " M", "staged and unstaged": "MM" }[state] +
          " packages/astromache/index.js\0";
      }
      const candidate = await pack(state);
      assert.equal(candidate.sourceHead, head, "Modified packing must retain the same HEAD");
      assert.deepEqual(candidate.sourceState, {
        dirty: true,
        gitStatusPorcelainV1: expectedStatus,
      });
      assert.notEqual(candidate.sha256, clean.sha256, "Same HEAD can deliver different bytes");
      assert.equal(
        candidate.sha256,
        createHash("sha256")
          .update(await readFile(candidate.tarball))
          .digest("hex"),
        "Archive digest remains authoritative",
      );
      const file = state === "untracked" ? "extra module.js" : "index.js";
      assert.deepEqual(
        await readFile(join(candidate.unpacked, file)),
        await readFile(join(packageDirectory, file)),
        "Delivered source must come from the working tree",
      );
    });
  }

  await t.test("delivery metadata requires the matching source state", async () => {
    const directory = join(root, "consumer");
    await mkdir(join(directory, "vendor"), { recursive: true });
    await cp(clean.tarball, join(directory, "vendor", clean.archive));
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ dependencies: { astromache: `file:vendor/${clean.archive}` } }),
    );
    await writeFile(
      join(directory, "STARTER-DELIVERY.json"),
      JSON.stringify({
        project: "search-offline",
        archives: { [`vendor/${clean.archive}`]: clean.sha256 },
      }),
    );
    const path = join(directory, "candidate-artifacts.json");
    const artifact = {
      version: clean.manifest.version,
      sha256: clean.sha256,
      packageSourceHead: clean.sourceHead,
      packageSourceState: clean.sourceState,
    };
    await writeFile(path, JSON.stringify({ astromache: artifact }));
    await verifyPublicationDelivery(directory, clean);
    for (const packageSourceState of [undefined, { ...clean.sourceState, dirty: true }]) {
      await writeFile(path, JSON.stringify({ astromache: { ...artifact, packageSourceState } }));
      await assert.rejects(
        verifyPublicationDelivery(directory, clean),
        /Candidate metadata must match current delivery/,
      );
    }
  });
});

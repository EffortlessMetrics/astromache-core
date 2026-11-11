import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { stringify } from "yaml";
import { verifyPublicationLockPreservation } from "./publication-lock-preservation.mjs";

for (const project of ["starters/publication", "recipes/search-offline"]) {
  const original = (
    await readFile(new URL(`../${project}/pnpm-lock.yaml`, import.meta.url), "utf8")
  ).replace(/\r\n/g, "\n");
  const upgraded = original.replaceAll("astromache-0.2.0.tgz", "astromache-0.2.13.tgz");
  assert.notEqual(upgraded, original, "Control must change the actual historical pin");
  const endings = { LF: (text) => text, CRLF: (text) => text.replace(/\n/g, "\r\n") };
  for (const [before, encodeBefore] of Object.entries(endings)) {
    for (const [after, encodeAfter] of Object.entries(endings)) {
      test(`${project}: ${before} to ${after} permits only astromache changes`, () => {
        verifyPublicationLockPreservation(encodeBefore(original), encodeAfter(upgraded));
        for (const [name, mutated] of [
          ["importer", upgraded.replace("specifier: 7.3.5", "specifier: 7.3.6")],
          ["package integrity", upgraded.replace("sha512-", "sha512-tampered")],
          ["snapshot", upgraded.replace("snapshots:", "snapshots:\n\n  unrelated@1.0.0: {}")],
        ]) {
          assert.notEqual(mutated, upgraded, `${name} control must mutate the lockfile`);
          assert.throws(
            () => verifyPublicationLockPreservation(encodeBefore(original), encodeAfter(mutated)),
            /Only the root astromache delivery/,
            name,
          );
        }
      });
    }
  }
}

for (const ending of ["\n", "\r\n"]) {
  test(`unrelated workspace astromache imports remain protected (${JSON.stringify(ending)})`, () => {
    const original = [
      "lockfileVersion: '9.0'",
      "importers:",
      "",
      "  .:",
      "    dependencies:",
      "      astromache:",
      "        specifier: file:vendor/astromache-old.tgz",
      "        version: file:vendor/astromache-old.tgz",
      "    devDependencies:",
      "      astromache:",
      "        specifier: 0.1.0",
      "        version: 0.1.0",
      "",
      "  'apps/space caf\u00e9':",
      "    dependencies:",
      "      astromache:",
      "        specifier: 0.1.0",
      "        version: 0.1.0",
      "",
      "packages:",
      "  astromache@file:vendor/astromache-old.tgz: {}",
      "  astromache@0.1.0: {}",
      "snapshots:",
      "  astromache@file:vendor/astromache-old.tgz: {}",
      "  astromache@0.1.0: {}",
      "",
    ].join(ending);
    const upgraded = original.replaceAll("astromache-old.tgz", "astromache-new.tgz");
    verifyPublicationLockPreservation(original, upgraded);
    for (const field of ["specifier", "version"]) {
      const value = `${field}: 0.1.0`;
      for (const index of [upgraded.indexOf(value), upgraded.lastIndexOf(value)]) {
        assert.ok(index >= 0, "Mutation target must exist");
        const mutated =
          upgraded.slice(0, index) + upgraded.slice(index).replace(value, `${field}: 0.2.0`);
        assert.throws(
          () => verifyPublicationLockPreservation(original, mutated),
          /Only the root astromache delivery/,
        );
      }
    }
  });
}

const oldRoot = "astromache@file:vendor/old.tgz";
const newRoot = "astromache@file:vendor/new.tgz";
const manifest = { dependencies: { stable: "1.0.0", parser: "2.0.0" } };
const graph = () => {
  const before = {
    lockfileVersion: "9.0",
    settings: { autoInstallPeers: true },
    importers: {
      ".": {
        dependencies: {
          astromache: { specifier: "file:vendor/old.tgz", version: "file:vendor/old.tgz" },
        },
        devDependencies: { stable: { specifier: "1.0.0", version: "1.0.0" } },
      },
      "apps/unrelated": {
        dependencies: { astromache: { specifier: "0.1.0", version: "0.1.0" } },
      },
    },
    packages: {
      [oldRoot]: { resolution: { integrity: "old-archive" } },
      "stable@1.0.0": { resolution: { integrity: "stable-archive" } },
      "astromache@0.1.0": { resolution: { integrity: "unrelated-archive" } },
    },
    snapshots: {
      [oldRoot]: { dependencies: { stable: "1.0.0" } },
      "stable@1.0.0": {},
      "astromache@0.1.0": {},
    },
  };
  const after = structuredClone(before);
  after.importers["."].dependencies.astromache = {
    specifier: "file:vendor/new.tgz",
    version: "file:vendor/new.tgz",
  };
  delete after.packages[oldRoot];
  delete after.snapshots[oldRoot];
  Object.assign(after.packages, {
    [newRoot]: { resolution: { integrity: "new-archive" } },
    "parser@2.0.0": { resolution: { integrity: "parser-archive" } },
    "@scope/shared@3.0.0": { resolution: { integrity: "shared-archive" } },
    "cycle@1.0.0": { resolution: { integrity: "cycle-archive" } },
    "optional@1.0.0": { resolution: { integrity: "optional-archive" } },
  });
  Object.assign(after.snapshots, {
    [newRoot]: { dependencies: { stable: "1.0.0", parser: "2.0.0(peer@1.0.0)" } },
    "parser@2.0.0(peer@1.0.0)": {
      dependencies: { alias: "@scope/shared@3.0.0", cycle: "1.0.0" },
      optionalDependencies: { optional: "1.0.0" },
    },
    "@scope/shared@3.0.0": {},
    "cycle@1.0.0": { dependencies: { parser: "2.0.0(peer@1.0.0)" } },
    "optional@1.0.0": {},
  });
  return { before, after };
};
const verifyGraph = (before, after) =>
  verifyPublicationLockPreservation(stringify(before), stringify(after), manifest);

test("candidate graph additions support aliases, peer identities, cycles and optional edges", () => {
  const { before, after } = graph();
  verifyGraph(before, after);
  delete after.snapshots["optional@1.0.0"];
  delete after.packages["optional@1.0.0"];
  verifyGraph(before, after);
});

for (const [name, mutate] of [
  [
    "shared integrity",
    (lock) => {
      lock.packages["stable@1.0.0"].resolution.integrity = "changed";
    },
  ],
  [
    "shared snapshot",
    (lock) => {
      lock.snapshots["stable@1.0.0"].dependencies = { parser: "2.0.0(peer@1.0.0)" };
    },
  ],
  [
    "existing deletion",
    (lock) => {
      delete lock.packages["stable@1.0.0"];
    },
  ],
  [
    "unrelated astromache snapshot",
    (lock) => {
      lock.snapshots["astromache@0.1.0"].dependencies = { stable: "1.0.0" };
    },
  ],
  [
    "unrelated astromache package",
    (lock) => {
      delete lock.packages["astromache@0.1.0"];
    },
  ],
  [
    "orphan snapshot and package",
    (lock) => {
      lock.packages["orphan@1.0.0"] = {};
      lock.snapshots["orphan@1.0.0"] = {};
    },
  ],
  [
    "orphan package",
    (lock) => {
      lock.packages["orphan@1.0.0"] = {};
    },
  ],
  [
    "unreachable peer context",
    (lock) => {
      lock.snapshots["parser@2.0.0(peer@2.0.0)"] = {};
    },
  ],
  [
    "missing required snapshot",
    (lock) => {
      delete lock.snapshots["@scope/shared@3.0.0"];
    },
  ],
  [
    "optional orphan metadata",
    (lock) => {
      delete lock.snapshots["optional@1.0.0"];
    },
  ],
  [
    "root dev dependency",
    (lock) => {
      lock.importers["."].devDependencies.stable.version = "2.0.0";
    },
  ],
  [
    "other importer",
    (lock) => {
      lock.importers["apps/unrelated"].dependencies.astromache.version = "0.2.0";
    },
  ],
  [
    "settings",
    (lock) => {
      lock.settings.autoInstallPeers = false;
    },
  ],
  [
    "overrides",
    (lock) => {
      lock.overrides = { stable: "2.0.0" };
    },
  ],
  [
    "patches",
    (lock) => {
      lock.patchedDependencies = { stable: { hash: "tampered" } };
    },
  ],
  [
    "lockfile version",
    (lock) => {
      lock.lockfileVersion = "8.0";
    },
  ],
  [
    "undeclared root dependency",
    (lock) => {
      lock.snapshots[newRoot].dependencies.orphan = "1.0.0";
      lock.packages["orphan@1.0.0"] = {};
      lock.snapshots["orphan@1.0.0"] = {};
    },
  ],
]) {
  test(`reject candidate graph mutation: ${name}`, () => {
    const { before, after } = graph();
    mutate(after);
    assert.throws(() => verifyGraph(before, after), /Only the root astromache delivery/);
  });
}

test("shared old root snapshots and package metadata remain immutable", () => {
  for (const sharing of ["importer", "peer context"]) {
    const { before, after } = graph();
    if (sharing === "importer") {
      before.importers["apps/shared"] = {
        dependencies: {
          astromache: structuredClone(before.importers["."].dependencies.astromache),
        },
      };
      after.importers["apps/shared"] = structuredClone(before.importers["apps/shared"]);
      after.snapshots[oldRoot] = structuredClone(before.snapshots[oldRoot]);
    } else {
      before.snapshots[oldRoot + "(peer@1.0.0)"] = {};
      after.snapshots[oldRoot + "(peer@1.0.0)"] = {};
    }
    after.packages[oldRoot] = structuredClone(before.packages[oldRoot]);
    verifyGraph(before, after);
    delete after.packages[oldRoot];
    assert.throws(() => verifyGraph(before, after), /Only the root astromache delivery/);
  }
});

test("an already-existing candidate identity is not an exemption for unrelated changes", () => {
  const { before, after } = graph();
  before.importers["apps/candidate"] = {
    dependencies: { astromache: structuredClone(after.importers["."].dependencies.astromache) },
  };
  after.importers["apps/candidate"] = structuredClone(before.importers["apps/candidate"]);
  before.packages[newRoot] = structuredClone(after.packages[newRoot]);
  before.snapshots[newRoot] = { dependencies: { stable: "1.0.0" } };
  assert.throws(() => verifyGraph(before, after), /Only the root astromache delivery/);
});

test("missing optional peer variants cannot reuse unrelated existing metadata", () => {
  const { before, after } = graph();
  for (const lock of [before, after]) {
    lock.packages["optional@2.0.0"] = {};
    lock.snapshots["optional@2.0.0(peer@1.0.0)"] = {};
  }
  after.snapshots["parser@2.0.0(peer@1.0.0)"].optionalDependencies.optional = "2.0.0(peer@2.0.0)";
  assert.throws(() => verifyGraph(before, after), /Only the root astromache delivery/);
});

test("candidate peers match unchanged consumer roots and cannot add arbitrary versions", () => {
  const { before, after } = graph();
  const peerManifest = { ...manifest, peerDependencies: { astro: "^7.3.5" } };
  for (const lock of [before, after]) {
    lock.importers["."].dependencies.astro = { specifier: "7.3.5", version: "7.3.5" };
    lock.packages["astro@7.3.5"] = {};
    lock.snapshots["astro@7.3.5"] = {};
  }
  const verify = () =>
    verifyPublicationLockPreservation(stringify(before), stringify(after), peerManifest);
  assert.throws(verify, /Only the root astromache delivery/);
  after.snapshots[newRoot].dependencies.astro = "7.3.5";
  verify();
  after.snapshots[newRoot].dependencies.astro = "99.0.0";
  after.packages["astro@99.0.0"] = {};
  after.snapshots["astro@99.0.0"] = {};
  assert.throws(verify, /Only the root astromache delivery/);
});

test("same archive filename can replace only its unshared root records", () => {
  const { before, after } = graph();
  after.importers["."].dependencies.astromache = structuredClone(
    before.importers["."].dependencies.astromache,
  );
  after.packages[oldRoot] = after.packages[newRoot];
  after.snapshots[oldRoot] = after.snapshots[newRoot];
  delete after.packages[newRoot];
  delete after.snapshots[newRoot];
  verifyGraph(before, after);
});

test("required root dependencies cannot become optional", () => {
  const { before, after } = graph();
  after.snapshots[newRoot].optionalDependencies = {
    parser: after.snapshots[newRoot].dependencies.parser,
  };
  delete after.snapshots[newRoot].dependencies.parser;
  assert.throws(() => verifyGraph(before, after), /Only the root astromache delivery/);
});

test("present optional manifest dependencies retain their declared pins", () => {
  const { before, after } = graph();
  const optionalManifest = {
    dependencies: { stable: "1.0.0" },
    optionalDependencies: { parser: "2.0.0" },
  };
  verifyPublicationLockPreservation(stringify(before), stringify(after), optionalManifest);
  optionalManifest.optionalDependencies.parser = "99.0.0";
  assert.throws(
    () => verifyPublicationLockPreservation(stringify(before), stringify(after), optionalManifest),
    /Only the root astromache delivery/,
  );
});

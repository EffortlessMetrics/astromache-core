import assert from "node:assert/strict";
import { parse } from "yaml";

const message = "Only the root astromache delivery and its newly reachable lock entries may change";
const packageKey = (snapshot) => snapshot.split("(")[0];
const resolveSnapshot = (lock, name, version, optional = false) => {
  const keys = [`${name}@${version}`, version].filter((key) =>
    Object.hasOwn(lock.snapshots ?? {}, key),
  );
  const unique = [...new Set(keys)];
  assert.ok(unique.length === 1 || (optional && unique.length === 0), message);
  if (!unique.length) {
    for (const identity of [`${name}@${version}`, version])
      assert.ok(!Object.hasOwn(lock.packages ?? {}, packageKey(identity)), message);
  }
  return unique[0];
};
const edges = (snapshot) => [
  ...Object.entries(snapshot.dependencies ?? {}).map(([name, version]) => [name, version, false]),
  ...Object.entries(snapshot.optionalDependencies ?? {}).map(([name, version]) => [
    name,
    version,
    true,
  ]),
];

// Preserve every existing unrelated record, including shared dependencies.
// Only genuinely new records in the packed candidate's dependency closure are
// admitted; root archive integrity is checked separately against the tarball.
export function verifyPublicationLockPreservation(original, current, manifest) {
  const before = parse(original);
  const after = parse(current);
  assert.equal(before.lockfileVersion, "9.0", message);
  assert.equal(after.lockfileVersion, before.lockfileVersion, message);
  const root = (lock) => lock.importers?.["."]?.dependencies?.astromache;
  assert.ok(root(before) && root(after), message);
  const oldRoot = resolveSnapshot(before, "astromache", root(before).version);
  const newRoot = resolveSnapshot(after, "astromache", root(after).version);
  const oldPackage = packageKey(oldRoot);
  const rest = (lock) => {
    const result = structuredClone(lock);
    delete result.importers["."].dependencies.astromache;
    delete result.packages;
    delete result.snapshots;
    return result;
  };
  assert.deepEqual(rest(after), rest(before), message);

  const reachable = new Set();
  const visit = (key) => {
    if (!key || reachable.has(key)) return;
    reachable.add(key);
    for (const [name, version, optional] of edges(after.snapshots[key]))
      visit(resolveSnapshot(after, name, version, optional));
  };
  visit(newRoot);
  const reachablePackages = new Set([...reachable].map(packageKey));
  for (const key of reachablePackages) assert.ok(Object.hasOwn(after.packages ?? {}, key), message);
  if (manifest) {
    const declared = {
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
    };
    const snapshot = after.snapshots[newRoot];
    for (const [name] of edges(snapshot)) assert.ok(Object.hasOwn(declared, name), message);
    for (const [name, version] of Object.entries({
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
    })) {
      const optional = Object.hasOwn(manifest.optionalDependencies ?? {}, name);
      const resolved =
        snapshot.dependencies?.[name] ??
        (optional ? snapshot.optionalDependencies?.[name] : undefined);
      if (resolved === undefined) {
        assert.ok(optional, message);
        continue;
      }
      const key = resolveSnapshot(after, name, resolved);
      assert.equal(packageKey(key), `${name}@${version}`, message);
    }
    for (const name of Object.keys(manifest.peerDependencies ?? {})) {
      const version = snapshot.dependencies?.[name] ?? snapshot.optionalDependencies?.[name];
      if (version === undefined) {
        assert.equal(manifest.peerDependenciesMeta?.[name]?.optional, true, message);
        continue;
      }
      const importer = after.importers["."];
      const declaration =
        importer.dependencies?.[name] ??
        importer.optionalDependencies?.[name] ??
        importer.devDependencies?.[name];
      assert.ok(declaration, message);
      assert.equal(
        resolveSnapshot(after, name, version),
        resolveSnapshot(after, name, declaration.version),
        message,
      );
    }
  }

  // The old root can also be an unchanged workspace/dev dependency, or share
  // package metadata with another peer-context snapshot. Do not exempt those.
  const otherImporters = structuredClone(before.importers);
  delete otherImporters["."].dependencies.astromache;
  const sharedSnapshot =
    Object.values(otherImporters).some((importer) =>
      ["dependencies", "devDependencies", "optionalDependencies"].some((field) =>
        Object.entries(importer[field] ?? {}).some(
          ([name, value]) =>
            (name === "astromache" && `astromache@${value.version}` === oldRoot) ||
            value.version === oldRoot,
        ),
      ),
    ) ||
    Object.entries(before.snapshots).some(
      ([key, snapshot]) =>
        key !== oldRoot &&
        edges(snapshot).some(
          ([name, version]) => `${name}@${version}` === oldRoot || version === oldRoot,
        ),
    );
  const sharedPackage =
    sharedSnapshot ||
    Object.keys(before.snapshots).some((key) => key !== oldRoot && packageKey(key) === oldPackage);
  for (const [section, exempt, allowed] of [
    ["snapshots", sharedSnapshot ? undefined : oldRoot, reachable],
    ["packages", sharedPackage ? undefined : oldPackage, reachablePackages],
  ]) {
    for (const [key, value] of Object.entries(before[section] ?? {})) {
      if (key === exempt) continue;
      assert.deepEqual(after[section]?.[key], value, message);
    }
    for (const key of Object.keys(after[section] ?? {}))
      if (!Object.hasOwn(before[section] ?? {}, key)) assert.ok(allowed.has(key), message);
  }
}

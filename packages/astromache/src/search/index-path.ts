function assertNamespace(namespace: string): void {
  if (
    !/^\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(namespace) ||
    namespace.length > 81 ||
    /^\/(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(namespace)
  ) {
    throw new Error("Search index namespace must be a portable root-relative path segment");
  }
}

export function canonicalSearchIndexPath(namespace: string): string {
  assertNamespace(namespace);
  return namespace + ".json";
}

export function versionedSearchIndexPath(namespace: string, version: string): string {
  assertNamespace(namespace);
  if (!/^[a-f0-9]{64}$/.test(version)) {
    throw new Error("Invalid search index version");
  }
  return namespace + "/" + version + "/search-index.json";
}

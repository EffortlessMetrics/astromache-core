import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { emitVersionedSearchIndex, serializeSearchIndex } from "./index-delivery.js";
import { canonicalSearchIndexPath, versionedSearchIndexPath } from "./index-path.js";

test("binds exact JSON bytes without changing consumer ordering", () => {
  const documents = [{ id: "b" }, { id: "a", title: "é" }];
  const { json, version } = serializeSearchIndex(documents);
  expect(json).toBe(JSON.stringify(documents));
  expect(version).toBe(createHash("sha256").update(json).digest("hex"));
  expect(canonicalSearchIndexPath("/personal-search-index")).toBe("/personal-search-index.json");
  expect(versionedSearchIndexPath("/personal-search-index", version)).toBe(
    "/personal-search-index/" + version + "/search-index.json",
  );
});

test("rejects unsafe namespace and version identities", () => {
  for (const namespace of ["../x", "//x", "/a/b", "/..", "/a%2fb", "/con", "/NUL", "x"]) {
    expect(() => canonicalSearchIndexPath(namespace)).toThrow();
  }
  for (const version of ["../x", "A".repeat(64), "a".repeat(63), ""]) {
    expect(() => versionedSearchIndexPath("/search-index", version)).toThrow();
  }
});

test("emits the original bytes, admits identical reruns and refuses collisions", async () => {
  const output = await mkdtemp(join(tmpdir(), "astromache-index-"));
  try {
    const bytes = Buffer.from('[ { "title": "First" } ]\n');
    await writeFile(join(output, "search-index.json"), bytes);
    const receipt = await emitVersionedSearchIndex(output, "/search-index");
    expect(receipt.version).toBe(createHash("sha256").update(bytes).digest("hex"));
    const destination = join(output, receipt.path.slice(1));
    expect(await readFile(destination)).toEqual(bytes);
    expect(await emitVersionedSearchIndex(output, "/search-index")).toEqual(receipt);
    await writeFile(destination, "different");
    await expect(emitVersionedSearchIndex(output, "/search-index")).rejects.toThrow("collision");
    expect(await readFile(destination, "utf8")).toBe("different");
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("does not write through a conflicting output namespace", async () => {
  const output = await mkdtemp(join(tmpdir(), "astromache-index-"));
  try {
    await writeFile(join(output, "search-index.json"), "[]");
    await writeFile(join(output, "search-index"), "occupied");
    await expect(emitVersionedSearchIndex(output, "/search-index")).rejects.toThrow();
    expect(await readFile(join(output, "search-index"), "utf8")).toBe("occupied");
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

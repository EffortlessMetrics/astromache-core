import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalSearchIndexPath, versionedSearchIndexPath } from "./index-path.js";

function digest(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Order, document schema and content admission belong to the consumer. */
export function serializeSearchIndex(documents: readonly unknown[]) {
  if (!Array.isArray(documents)) {
    throw new TypeError("Search index documents must be an array");
  }
  const json = JSON.stringify(documents);
  return { json, version: digest(json) };
}

function exists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "EEXIST";
}

async function ensureDirectory(directory: string): Promise<void> {
  try {
    await mkdir(directory);
  } catch (error) {
    if (!exists(error)) throw error;
  }
  const entry = await lstat(directory);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error("Search index output directory is not a regular directory: " + directory);
  }
}

async function readRegularFile(path: string): Promise<Buffer> {
  const entry = await lstat(path);
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new Error("Search index is not a regular file: " + path);
  }
  return readFile(path);
}

/** Call before offline manifest generation. Never overwrite a versioned delivery. */
export async function emitVersionedSearchIndex(outputDirectory: string, namespace: string) {
  const canonicalPath = canonicalSearchIndexPath(namespace);
  const output = await realpath(outputDirectory);
  const bytes = await readRegularFile(join(output, canonicalPath.slice(1)));
  const version = digest(bytes);
  const path = versionedSearchIndexPath(namespace, version);
  const directory = join(output, namespace.slice(1));
  await ensureDirectory(directory);
  const versionDirectory = join(directory, version);
  await ensureDirectory(versionDirectory);
  const destination = join(versionDirectory, "search-index.json");
  try {
    await writeFile(destination, bytes, { flag: "wx" });
  } catch (error) {
    if (!exists(error)) throw error;
    if (!bytes.equals(await readRegularFile(destination))) {
      throw new Error("Versioned search index collision: " + path);
    }
  }
  return { version, path, canonicalPath, bytes: bytes.length };
}

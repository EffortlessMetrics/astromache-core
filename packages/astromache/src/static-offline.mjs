import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { readdir, copyFile, lstat, stat, mkdir, readFile } from "node:fs/promises";
import { generateOfflineWorker } from "@effortlessmetrics/astro-offline/integration";

async function directoryNames(directory) {
  try {
    return await readdir(directory);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function collision(receiptFile) {
  return new Error(
    `astromache/static-offline receiptFile collision at "${receiptFile}"; existing output must be an unlinked receipt paired with its generated worker.`,
  );
}

function isGeneratedWorker(worker) {
  return (
    worker.startsWith("/*! @effortlessmetrics/astro-offline owner code - MIT alternative\n") &&
    worker.includes("\nOfflineRuntime.installWorker(")
  );
}

function isGeneratedReceipt(receipt, worker) {
  if (!isGeneratedWorker(worker)) return false;
  const diagnostics = worker.match(
    /^const REVISION=("[0-9a-f]{20}");const PREFIX=("(?:[^"\\\r\n]|\\.)*");const CACHE=PREFIX\+REVISION;const URLS=(\[[^\r\n]*\]);const DIGESTS=(\{[^\r\n]*\});$/m,
  );
  if (!diagnostics) return false;
  let parsed;
  try {
    parsed = diagnostics.slice(1).map((value) => JSON.parse(value));
  } catch {
    return false;
  }
  const [revision, prefix, urls, digests] = parsed;
  return (
    receipt !== null &&
    typeof receipt === "object" &&
    receipt.revision === revision &&
    /^[a-zA-Z0-9][a-zA-Z0-9_-]*-$/.test(prefix) &&
    Array.isArray(urls) &&
    urls.every((url) => typeof url === "string") &&
    new Set(urls).size === urls.length &&
    JSON.stringify(receipt.urls) === JSON.stringify(urls) &&
    JSON.stringify(Object.keys(digests)) === JSON.stringify(urls) &&
    Object.values(digests).every((digest) => /^[0-9a-f]{64}$/.test(digest)) &&
    receipt.resources === urls.length &&
    receipt.files === urls.length &&
    Number.isSafeInteger(receipt.bytes) &&
    receipt.bytes >= 0 &&
    Number.isSafeInteger(receipt.largestHtmlBytes) &&
    receipt.largestHtmlBytes >= 0 &&
    receipt.largestHtmlBytes <= receipt.bytes &&
    receipt.workbox === "7.4.1"
  );
}

function retainedArtifact(name) {
  return new Error(
    `astromache/static-offline receiptFile collision with retained generated output "${name}"; changing workerFile or receiptFile requires a clean output directory.`,
  );
}

async function retainedContents(root, name) {
  const path = join(root, name);
  try {
    const entry = await lstat(path);
    if (!entry.isFile() && !entry.isSymbolicLink()) return;
    if (entry.isSymbolicLink() && !(await stat(path)).isFile()) return;
    return await readFile(path, "utf8");
  } catch (error) {
    if (["ENOENT", "EISDIR", "EACCES", "EPERM", "ELOOP"].includes(error.code)) return;
    throw error;
  }
}

async function assertRetainedPair(root, names, receiptFile, workerFile, hasReceipt) {
  let previousWorker;
  for (const name of names.filter((name) => /\.js$/i.test(name))) {
    const worker = await retainedContents(root, name);
    if (worker === undefined) {
      if (name === workerFile) throw collision(receiptFile);
      continue;
    }
    if (!isGeneratedWorker(worker)) continue;
    if (name !== workerFile || !hasReceipt) throw retainedArtifact(name);
    previousWorker = worker;
  }
  if (!previousWorker) return;
  for (const name of names.filter((name) => /\.json$/i.test(name) && name !== receiptFile)) {
    const contents = await retainedContents(root, name);
    if (contents === undefined) continue;
    let receipt;
    try {
      receipt = JSON.parse(contents);
    } catch {
      continue;
    }
    if (isGeneratedReceipt(receipt, previousWorker)) throw retainedArtifact(name);
  }
}

async function assertReceiptDestination(root, receiptFile, workerFile) {
  const names = await directoryNames(root);
  const matches = names.filter((name) => name.toLowerCase() === receiptFile.toLowerCase());
  const workers = names.filter((name) => name.toLowerCase() === workerFile.toLowerCase());
  if (workers.length > 0) {
    if (workers.length !== 1 || workers[0] !== workerFile) throw collision(receiptFile);
    try {
      const workerStat = await lstat(join(root, workerFile));
      if (!workerStat.isFile() || workerStat.nlink !== 1) throw collision(receiptFile);
    } catch {
      throw collision(receiptFile);
    }
  }
  await assertRetainedPair(root, names, receiptFile, workerFile, matches.length > 0);
  if (matches.length === 0) return;
  if (matches.length !== 1 || matches[0] !== receiptFile) throw collision(receiptFile);
  if (workers.length !== 1 || workers[0] !== workerFile) throw collision(receiptFile);
  try {
    const receiptPath = join(root, receiptFile);
    const workerPath = join(root, workerFile);
    const receiptStat = await lstat(receiptPath);
    if (
      !receiptStat.isFile() ||
      receiptStat.nlink !== 1 ||
      !isGeneratedReceipt(
        JSON.parse(await readFile(receiptPath, "utf8")),
        await readFile(workerPath, "utf8"),
      )
    )
      throw collision(receiptFile);
  } catch {
    throw collision(receiptFile);
  }
}

/** Canonical static directory pages; site-owned redirects must be excluded. */
export default function staticOffline({ excludedPages = [], ...options }) {
  const receiptFile = options.receiptFile ?? "offline-receipt.json";
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(receiptFile) ||
    receiptFile.length > 255 ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(receiptFile)
  ) {
    throw new Error(
      "astromache/static-offline receiptFile must be a portable root .json filename of at most 255 ASCII bytes using letters, digits, dots, underscores or hyphens, starting with a letter or digit; paths, glob characters and reserved device names are unsupported.",
    );
  }
  return {
    name: "astromache-static-offline",
    hooks: {
      "astro:config:done": async ({ config }) => {
        if (config.base !== "/") {
          throw new Error(
            'astromache/static-offline requires base: "/"; subpath deployments are not supported by the canonical directory preset.',
          );
        }
        if (config.build.format !== "directory") {
          throw new Error(
            'astromache/static-offline requires build.format: "directory"; file output cannot supply canonical directory cache URLs.',
          );
        }
        if (config.publicDir) {
          const asset = (await directoryNames(fileURLToPath(config.publicDir))).find(
            (name) => name.toLowerCase() === receiptFile.toLowerCase(),
          );
          if (asset) {
            throw new Error(
              `astromache/static-offline receiptFile collision with public asset "${asset}".`,
            );
          }
        }
      },
      "astro:build:done": async ({ dir }) => {
        const root = fileURLToPath(dir);
        await assertReceiptDestination(root, receiptFile, options.workerFile ?? "sw.js");
        try {
          await mkdir(join(root, "404"), { recursive: true });
          await copyFile(join(root, "404.html"), join(root, "404/index.html"));
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        const pages = (await readdir(root, { recursive: true }))
          .filter((path) => path === "index.html" || /[\\/]index\.html$/.test(path))
          .map(
            (path) =>
              "/" + path.replaceAll(String.fromCharCode(92), "/").replace(/index\.html$/, ""),
          )
          .filter((path) => !excludedPages.includes(path))
          .sort();
        await generateOfflineWorker(root, {
          ...options,
          pages,
          globIgnores: [...(options.globIgnores ?? []), "**/*.html"],
          worker: {
            ...options.worker,
            navigationFallback: options.worker?.navigationFallback?.replace(/index\.html$/, ""),
          },
          receiptFile,
        });
      },
    },
  };
}

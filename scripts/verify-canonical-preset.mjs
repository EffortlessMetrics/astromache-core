import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import staticOffline from "../packages/astromache/src/static-offline.mjs";

const root = await mkdtemp(join(tmpdir(), "canonical-core-preset-"));
for (const page of ["article", "contact", "offline"]) await mkdir(join(root, page));
await writeFile(join(root, "index.html"), "<h1>Home</h1>");
await writeFile(join(root, "404.html"), "<h1>Missing</h1>");
for (const page of ["article", "contact", "offline"])
  await writeFile(join(root, page, "index.html"), `<h1>${page}</h1>`);
await writeFile(join(root, "article/image.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
const integration = staticOffline({
  excludedPages: ["/contact/"],
  cachePrefix: "core-preset-proof-",
  globPatterns: ["**/*.{html,svg,json}"],
  maxBytes: 100000,
  maxResources: 20,
  worker: {
    stripQuery: false,
    excludedPrefixes: ["/api/"],
    navigationStrategy: "network-first",
    navigationFallback: "/offline/index.html",
  },
});
await integration.hooks["astro:build:done"]({ dir: pathToFileURL(root + "/") });
const receipt = JSON.parse(await readFile(join(root, "offline-receipt.json"), "utf8"));
assert.deepEqual(receipt.urls.sort(), [
  "/",
  "/404/",
  "/article/",
  "/article/image.svg",
  "/offline/",
]);
assert.deepEqual(
  await readFile(join(root, "404/index.html")),
  await readFile(join(root, "404.html")),
);
const worker = await readFile(join(root, "sw.js"), "utf8");
assert.ok(worker.includes('"stripQuery":false'));
assert.ok(worker.includes('"navigationStrategy":"network-first"'));
assert.ok(worker.includes('"navigationFallback":"/offline/"'));
// Rebuilding must exclude its own prior receipt and generated worker.
await integration.hooks["astro:build:done"]({ dir: pathToFileURL(root + "/") });
assert.equal(
  JSON.parse(await readFile(join(root, "offline-receipt.json"), "utf8")).revision,
  receipt.revision,
);
console.log(
  "Canonical core preset passed: directory URLs, redirect exclusion, exact root404, policy preservation and deterministic receipt-safe rebuild.",
);

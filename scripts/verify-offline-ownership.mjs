import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
assert.equal(
  existsSync(new URL("../packages/offline/", import.meta.url)),
  false,
  "Offline implementation must belong to its independent repository",
);
const root = fileURLToPath(
  new URL("../", import.meta.resolve("@effortlessmetrics/astro-offline/integration")),
);
const p = JSON.parse(readFileSync(root + "package.json", "utf8"));
assert.equal(p.version, "0.1.4");
assert.equal(p.repository.url, "https://github.com/EffortlessMetrics/astro-offline.git");
console.log("Independent offline source ownership and exact consumer package identity passed");

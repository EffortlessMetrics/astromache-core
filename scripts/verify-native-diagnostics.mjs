import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

const fixture = "packages/astromache/src/qualification-invalid.astro";
await writeFile(
  fixture,
  '---\nimport Document from "./Document.astro";\n---\n<Document title={42} description="Invalid native contract probe" canonical={new URL("https://example.test/")} language="en" />\n',
  { flag: "wx" },
);
try {
  const result = spawnSync(
    process.execPath,
    [
      resolve("node_modules/typescript-native/bin/tsc"),
      "--noEmit",
      "-p",
      "tsconfig.native.json",
      "--runExternalCode",
    ],
    { encoding: "utf8" },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 2, "Native compiler must reject invalid Astro props");
  const diagnostics = result.stdout + result.stderr;
  assert.match(diagnostics, /qualification-invalid\.astro.*TS2322/);
  assert.match(diagnostics, /number.*string/);
  assert.equal(
    diagnostics.match(/error TS/g)?.length,
    1,
    "Only the deliberately invalid prop should fail",
  );
  console.log("Native TS7.1 rejects an invalid document contract prop (TS2322).");
} finally {
  await rm(fixture);
}

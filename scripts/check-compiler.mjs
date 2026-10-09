import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const native = process.argv[2] === "native";
assert.ok(
  native || process.argv[2] === "compatibility",
  "Specify native or compatibility compiler authority",
);
const compiler = resolve("node_modules", native ? "typescript-native" : "typescript", "bin/tsc");
const version = execFileSync(process.execPath, [compiler, "--version"], {
  encoding: "utf8",
}).trim();
assert.match(version, native ? /^Version 7\.1\.0-dev\.20261003\.1$/ : /^Version 6\.0\.3$/);
console.log(`${native ? "Native mapper shadow" : "Compatibility"} compiler: ${version}`);
execFileSync(
  process.execPath,
  [
    compiler,
    "--noEmit",
    "-p",
    native ? "tsconfig.native.json" : "tsconfig.json",
    ...(native ? ["--runExternalCode"] : []),
  ],
  { stdio: "inherit" },
);

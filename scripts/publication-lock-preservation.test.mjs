import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
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
            /Only astromache importer\/package\/snapshot lock entries may change/,
            name,
          );
        }
      });
    }
  }
}

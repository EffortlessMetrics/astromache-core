import assert from "node:assert/strict";

// pnpm can rewrite a consumer's CRLF lockfile as LF. Compare dependency
// content after normalizing that transport detail on both sides.
export function verifyPublicationLockPreservation(original, current) {
  const unrelatedLock = (text) =>
    text
      .replace(/\r\n/g, "\n")
      .replace(/^ {6}astromache:\n(?: {8}.*\n)+/gm, "")
      .replace(/^ {2}astromache@.*:\n(?: {4}.*\n|\n)*/gm, "")
      .replace(/\n+/g, "\n");
  assert.equal(
    unrelatedLock(current),
    unrelatedLock(original),
    "Only astromache importer/package/snapshot lock entries may change",
  );
}

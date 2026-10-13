import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { snapshotOfflineCache, assertOfflineCacheUnchanged } from "./offline-cache-snapshot.mjs";

const message = "Interrupted upgrade preserves every historical cache entry and byte";

async function withCache(entries, run) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "caches");
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: {
      async open(name) {
        assert.equal(name, "historical-cache");
        return {
          async keys() {
            return [...entries.keys()].map((url) => new Request(url));
          },
          async match(request) {
            return new Response(entries.get(request.url));
          },
        };
      },
    },
  });
  try {
    await run();
  } finally {
    if (original) Object.defineProperty(globalThis, "caches", original);
    else delete globalThis.caches;
  }
}

test("unchanged response bytes pass regardless of cache iteration order", async () => {
  const entries = new Map([
    ["https://fixture.test/z", new Uint8Array([0, 255, 17])],
    ["https://fixture.test/a", "article"],
  ]);
  await withCache(entries, async () => {
    const before = await snapshotOfflineCache("historical-cache");
    entries.delete("https://fixture.test/z");
    entries.set("https://fixture.test/z", new Uint8Array([0, 255, 17]));
    const after = await snapshotOfflineCache("historical-cache");
    assertOfflineCacheUnchanged(after, before, message);
    assert.equal(before[1].bytes, 3);
    assert.match(before[1].sha256, /^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(before).includes("[0,255,17]"));
  });
});

test("same-length byte corruption, missing and added URLs each fail", async () => {
  const entries = new Map([["https://fixture.test/font.woff2", new Uint8Array([0, 255, 17])]]);
  await withCache(entries, async () => {
    const before = await snapshotOfflineCache("historical-cache");
    entries.set("https://fixture.test/font.woff2", new Uint8Array([0, 255, 18]));
    const changed = await snapshotOfflineCache("historical-cache");
    assert.equal(changed[0].bytes, before[0].bytes);
    assert.throws(
      () => assertOfflineCacheUnchanged(changed, before, message),
      (error) =>
        error.code === "ERR_ASSERTION" &&
        error.actual === 1 &&
        error.message.startsWith(message) &&
        error.message.includes("font.woff2") &&
        error.message.includes(before[0].sha256) &&
        error.message.includes(changed[0].sha256),
    );
    entries.delete("https://fixture.test/font.woff2");
    assert.throws(
      () => assertOfflineCacheUnchanged([], before, message),
      /1 missing, 0 added, 0 changed/,
    );
    entries.set("https://fixture.test/extra", "extra");
    const added = await snapshotOfflineCache("historical-cache");
    assert.throws(
      () => assertOfflineCacheUnchanged(added, [], message),
      /0 missing, 1 added, 0 changed/,
    );
  });
});

test("many long-URL mismatches retain counts with bounded diagnostics", () => {
  const before = Array.from({ length: 1000 }, (_, index) => ({
    url: `https://fixture.test/${index}/` + "route".repeat(2000),
    bytes: 4 * 1024 * 1024,
    sha256: "a".repeat(64),
  }));
  const after = before.map((entry) => ({ ...entry, sha256: "b".repeat(64) }));
  assert.throws(
    () => assertOfflineCacheUnchanged(after, before, message),
    (error) =>
      error.code === "ERR_ASSERTION" &&
      error.actual === 1000 &&
      error.message.includes("1000 changed entries") &&
      error.message.includes("992 further mismatches omitted") &&
      Buffer.byteLength(error.stack) < 8192,
  );
});

test("4 MiB corruption fails actionably under a 64 MiB V8 heap", (t) => {
  const moduleURL = new URL("./offline-cache-snapshot.mjs", import.meta.url).href;
  const script = `
    import assert from "node:assert/strict";
    import { snapshotOfflineCache, assertOfflineCacheUnchanged } from ${JSON.stringify(moduleURL)};
    let body = new Uint8Array(4 * 1024 * 1024).fill(17);
    globalThis.caches = { async open() { return {
      async keys() { return [new Request("https://fixture.test/large-font.woff2")]; },
      async match() { return new Response(body); }
    }; } };
    const before = await snapshotOfflineCache("historical-cache");
    assertOfflineCacheUnchanged(await snapshotOfflineCache("historical-cache"), before, ${JSON.stringify(message)});
    body = new TextEncoder().encode(new TextDecoder().decode(body) + "corruption");
    const after = await snapshotOfflineCache("historical-cache");
    let failure;
    try { assertOfflineCacheUnchanged(after, before, ${JSON.stringify(message)}); }
    catch (error) { failure = error; }
    assert.equal(failure?.code, "ERR_ASSERTION");
    assert.equal(failure.actual, 1);
    assert.ok(failure.message.startsWith(${JSON.stringify(message)}));
    assert.ok(failure.message.includes(before[0].sha256));
    assert.ok(failure.message.includes(after[0].sha256));
    assert.ok(Buffer.byteLength(failure.stack) < 4096);
    console.log(JSON.stringify({corruptionRejected:true, bodyBytes:before[0].bytes, diagnosticBytes:Buffer.byteLength(failure.stack), peakRssKiB:process.resourceUsage().maxRSS}));
  `;
  const result = spawnSync(
    process.execPath,
    ["--max-old-space-size=64", "--input-type=module", "-e", script],
    { encoding: "utf8", timeout: 30000, maxBuffer: 16 * 1024 },
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).corruptionRejected, true);
  t.diagnostic(result.stdout.trim());
});

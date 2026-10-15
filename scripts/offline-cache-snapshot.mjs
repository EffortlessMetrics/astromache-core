import assert from "node:assert/strict";

// This callback runs in the browser. Read one response at a time and return
// only its identity, so binary corpus bytes never cross the browser protocol.
export async function snapshotOfflineCache(cacheName) {
  const cache = await caches.open(cacheName);
  const entries = [];
  for (const request of await cache.keys()) {
    const body = await (await cache.match(request)).arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", body);
    entries.push({
      url: request.url,
      bytes: body.byteLength,
      sha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
        "",
      ),
    });
  }
  return entries.sort((a, b) => a.url.localeCompare(b.url));
}

export function assertOfflineCacheUnchanged(actual, expected, message) {
  const before = new Map(expected.map((entry) => [entry.url, entry]));
  const after = new Map(actual.map((entry) => [entry.url, entry]));
  const counts = { missing: 0, added: 0, changed: 0 };
  const details = [];
  const record = (kind, url, detail = "") => {
    counts[kind]++;
    if (details.length < 8) {
      const encoded = JSON.stringify(url);
      const label = encoded.length > 160 ? encoded.slice(0, 160) + "…" : encoded;
      details.push(`${kind} ${label}${detail}`);
    }
  };
  for (const [url, old] of before) {
    const current = after.get(url);
    if (!current) record("missing", url);
    else if (old.bytes !== current.bytes || old.sha256 !== current.sha256)
      record(
        "changed",
        url,
        `: bytes ${old.bytes} -> ${current.bytes}; SHA-256 ${old.sha256} -> ${current.sha256}`,
      );
  }
  for (const url of after.keys()) if (!before.has(url)) record("added", url);
  const total = counts.missing + counts.added + counts.changed;
  const summary = [
    `${counts.missing} missing, ${counts.added} added, ${counts.changed} changed entries`,
    ...details,
    ...(total > details.length ? [`${total - details.length} further mismatches omitted`] : []),
  ];
  // Assert on the count, not the corpus: Node's deep byte-array diff can exhaust
  // memory while formatting an otherwise correctly detected corrupt font.
  assert.equal(total, 0, message + "\n" + summary.join("\n"));
}

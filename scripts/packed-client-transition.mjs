import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { chromium } from "@playwright/test";
import { snapshotOfflineCache, assertOfflineCacheUnchanged } from "./offline-cache-snapshot.mjs";

export async function verifyPackedClientTransition(
  { a, b, baseline, candidate, root },
  { saveProof = true } = {},
) {
  assert.notEqual(a.receipt.revision, b.receipt.revision);
  const stale = a.receipt.urls.filter((url) => !b.receipt.urls.includes(url));
  const common = b.receipt.urls.filter((url) => a.receipt.urls.includes(url) && !url.endsWith("/"));
  assert.ok(
    stale.some((url) => url.endsWith(".js")),
    "Upgrade must obsolete an actual bundled client script",
  );
  assert.ok(
    stale.some((url) => url.endsWith(".css")),
    "Upgrade must obsolete an actual bundled stylesheet",
  );
  assert.ok(
    common.some((url) => url.endsWith(".woff2")),
    "Upgrade must preserve a still-needed shared font",
  );
  let serving = a.output;
  let serverOnline = true;
  const server = createServer(async (request, response) => {
    if (!serverOnline) {
      request.destroy();
      return;
    }
    try {
      const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const file = resolve(serving, "." + path, path.endsWith("/") ? "index.html" : "");
      assert.ok(file.startsWith(serving + sep));
      const body = await readFile(file);
      response
        .writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Type":
            {
              ".html": "text/html",
              ".js": "text/javascript",
              ".css": "text/css",
              ".woff2": "font/woff2",
            }[extname(file)] ?? "application/octet-stream",
        })
        .end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const errors = [];
  context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
  async function poll(page, callback, label) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (await page.evaluate(callback)) return;
      await new Promise((done) => setTimeout(done, 50));
    }
    throw new Error(`Timed out: ${label}`);
  }
  async function checkResources(page, expected) {
    const actual = await page.evaluate(async (entries) => {
      const result = [];
      for (const { url } of entries) {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error(`Resource HTTP ${response.status}: ${url}`);
        const bytes = await response.arrayBuffer();
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        result.push({
          url,
          bytes: bytes.byteLength,
          sha256: Array.from(new Uint8Array(digest), (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join(""),
        });
      }
      return result;
    }, expected);
    assertOfflineCacheUnchanged(
      actual,
      expected,
      "Every route and client resource must have exact built bytes",
    );
  }
  try {
    let page = await context.newPage();
    await page.goto(origin);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await poll(page, () => Boolean(navigator.serviceWorker.controller), "A controls consumer");
    const oldWorker = context.serviceWorkers()[0];
    assert.equal(await oldWorker.evaluate(() => REVISION), a.receipt.revision);
    await page.evaluate(async () => {
      const cache = await caches.open("unrelated-client");
      await cache.put("/sentinel", new Response("retain"));
    });
    const snapshot = await page.evaluate(
      snapshotOfflineCache,
      `packed-transition-${a.receipt.revision}`,
    );
    serving = b.output;
    // The local origin really removed these files. Browser HTTP cache cannot hide a loss.
    for (const url of stale) assert.equal((await fetch(origin + url)).status, 404);
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await poll(
      page,
      async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting),
      "B waits for A client",
    );
    const newWorker = context.serviceWorkers().findLast((worker) => worker !== oldWorker);
    assert.equal(await newWorker.evaluate(() => REVISION), b.receipt.revision);
    serverOnline = false;
    await context.setOffline(true);
    assertOfflineCacheUnchanged(
      await page.evaluate(snapshotOfflineCache, `packed-transition-${a.receipt.revision}`),
      snapshot,
      "Waiting install must preserve all A cache entries",
    );
    await checkResources(page, a.expected);
    await page.goto(origin + "/article/");
    await poll(
      page,
      () => document.documentElement.dataset.consumer === "A",
      "Old client script executes offline while B waits",
    );
    await page.getByRole("heading", { name: "Transition A", exact: true }).waitFor();
    assert.equal(
      await page
        .locator("#consumer-body")
        .evaluate((element) => getComputedStyle(element).getPropertyValue("--transition").trim()),
      "1",
      "Historical bundled CSS applies while waiting",
    );
    assert.equal(await oldWorker.evaluate(() => self.registration.active.state), "activated");
    await page.close();
    await newWorker.evaluate(async () => {
      const end = Date.now() + 30000;
      while (self.serviceWorker?.state !== "activated" || self.registration.waiting) {
        if (Date.now() > end) throw new Error("Natural B activation timed out");
        await new Promise((done) => setTimeout(done, 50));
      }
    });
    const currentCorpus = await newWorker.evaluate(
      snapshotOfflineCache,
      `packed-transition-${b.receipt.revision}`,
    );
    assertOfflineCacheUnchanged(
      currentCorpus.map((entry) => ({ ...entry, url: new URL(entry.url).pathname })),
      b.expected,
      "Every current cache entry must remain available after activation",
    );
    page = await context.newPage();
    await page.goto(origin + "/article/");
    await poll(
      page,
      () => document.documentElement.dataset.consumer === "B",
      "New client script executes offline after natural activation",
    );
    await checkResources(page, b.expected);
    assert.equal(
      await page
        .locator("#consumer-body")
        .evaluate((element) => getComputedStyle(element).getPropertyValue("--transition").trim()),
      "2",
      "Current bundled CSS applies after activation",
    );
    const keys = await page.evaluate(() => caches.keys());
    assert.ok(
      !keys.includes(`packed-transition-${a.receipt.revision}`),
      "Obsolete A cache must be removed",
    );
    assert.ok(keys.includes(`packed-transition-${b.receipt.revision}`));
    for (const url of stale) {
      assert.equal(
        await page.evaluate(async (url) => {
          try {
            const r = await fetch(url, { cache: "no-store" });
            return r.ok;
          } catch {
            return false;
          }
        }, url),
        false,
        "Stale assets must not survive offline cleanup",
      );
      assert.equal(
        await page.evaluate(
          async (url) => Boolean(await caches.match(url, { ignoreSearch: true })),
          url,
        ),
        false,
        "Stale asset must leave every cache",
      );
    }
    assert.equal(
      await page.evaluate(async () =>
        (await (await caches.open("unrelated-client")).match("/sentinel")).text(),
      ),
      "retain",
    );
    serverOnline = true;
    await context.setOffline(false);
    await page.goto(origin + "/");
    await poll(
      page,
      () => document.documentElement.dataset.consumer === "B",
      "Reconnect retains current client behavior",
    );
    await checkResources(page, b.expected);
    assert.deepEqual(errors, [], "Compiled public components must execute without page errors");
    const proof = {
      pass: true,
      baseline: {
        head: baseline.sourceHead,
        version: baseline.manifest.version,
        sha256: baseline.sha256,
        ...a,
      },
      candidate: {
        head: candidate.sourceHead,
        version: candidate.manifest.version,
        sha256: candidate.sha256,
        ...b,
      },
      browser: browser.version(),
      stale,
      common,
      root,
    };
    if (saveProof) await writeFile(join(root, "proof.json"), JSON.stringify(proof, null, 2) + "\n");
    console.log(
      `Packed transition passed; ${baseline.manifest.version} -> ${candidate.manifest.version}; ${stale.length} obsolete assets removed, ${common.length} shared assets retained; proof: ${join(root, "proof.json")}`,
    );
  } finally {
    await context.close();
    await browser.close();
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
}

// Mutate only disposable emitted workers. Each browser run uses a fresh origin
// and context; the real packages and specialist implementation stay untouched.
export async function verifyPackedClientTransitionControls(fixture) {
  const { a, b, root } = fixture;
  const workerFile = join(b.output, "sw.js");
  const worker = await readFile(workerFile, "utf8");
  const mutations = [
    [
      "early-old-cache-deletion",
      `self.addEventListener('install', event => event.waitUntil(caches.delete('packed-transition-${a.receipt.revision}')));`,
      /Waiting install must preserve all A cache entries/,
    ],
    [
      "missing-old-cache-cleanup",
      `const deleteCache=caches.delete.bind(caches); caches.delete=name=>name==='packed-transition-${a.receipt.revision}'?Promise.resolve(false):deleteCache(name);`,
      /Obsolete A cache must be removed/,
    ],
    [
      "shared-font-deletion",
      `self.addEventListener('activate', event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);for(const request of await cache.keys())if(new URL(request.url).pathname.endsWith('.woff2'))await cache.delete(request);})()));`,
      /Every current cache entry must remain available/,
    ],
  ];
  const results = [];
  try {
    for (const [name, mutation, expected] of mutations) {
      await writeFile(workerFile, worker + "\n" + mutation + "\n");
      await assert.rejects(
        verifyPackedClientTransition(fixture, { saveProof: false }),
        expected,
        `Must detect ${name}`,
      );
      results.push({ name, rejected: true, assertion: expected.source });
      console.log(`Discriminating negative passed: ${name}`);
    }
  } finally {
    await writeFile(workerFile, worker);
  }
  await writeFile(join(root, "negative-controls.json"), JSON.stringify(results, null, 2) + "\n");
}

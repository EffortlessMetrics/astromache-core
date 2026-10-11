import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { chromium } from "@playwright/test";

async function poll(page, predicate, label) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    if (await page.evaluate(predicate)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
}

// Serve the exact two consumer builds on one origin. Neither output is rewritten,
// and the replacement must wait for all controlled clients to close naturally.
export async function verifyPublicationWorkerUpgrade(baseline, directory) {
  const current = join(directory, "dist");
  const revision = async (root) => {
    const worker = await readFile(join(root, "reading-worker.js"), "utf8");
    const match = /const REVISION="([a-f0-9]+)"/.exec(worker);
    assert.ok(match, "Actual recipe output must identify its worker revision");
    return match[1];
  };
  const oldRevision = await revision(baseline);
  const newRevision = await revision(current);
  assert.notEqual(
    newRevision,
    oldRevision,
    "Current package must produce a distinct upgrade build",
  );
  let serving = baseline;
  let transformed = false;
  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      assert.equal(request.method, "GET");
      const root = resolve(serving);
      const file = resolve(root, "." + path + (path.endsWith("/") ? "index.html" : ""));
      assert.ok(file.startsWith(root + sep));
      let body = await readFile(file);
      if (transformed && extname(file) === ".html")
        body = Buffer.from(
          body
            .toString()
            .replace("</head>", '<meta name="qualification-transform" content="rejected"></head>'),
        );
      response
        .writeHead(200, {
          "Content-Type":
            {
              ".html": "text/html",
              ".js": "text/javascript",
              ".css": "text/css",
              ".json": "application/json",
              ".svg": "image/svg+xml",
              ".woff2": "font/woff2",
            }[extname(file)] ?? "application/octet-stream",
          "Cache-Control": "no-store",
        })
        .end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext();
    // Registration deliberately defers constrained connections. This lifecycle
    // test qualifies an eligible connection, independently of host estimates.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "connection", {
        configurable: true,
        value: Object.assign(new EventTarget(), {
          effectiveType: "4g",
          downlink: 10,
          rtt: 10,
          saveData: false,
        }),
      });
    });
    try {
      let page = await context.newPage();
      await page.goto(origin + "/search/");
      await poll(
        page,
        async () => Boolean((await navigator.serviceWorker.getRegistration())?.active),
        "historical worker naturally active",
      );
      assert.equal(
        await page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
        false,
        "Initial install cannot claim the existing page",
      );
      await page.reload();
      await poll(
        page,
        () => Boolean(navigator.serviceWorker.controller),
        "historical page controlled",
      );
      await page.getByLabel("Search", { exact: true }).fill("quiet");
      await page.locator("#search-form button").click();
      await page.locator('#search-results a[href="/notes/a-quiet-system/"]').waitFor();
      const oldWorker = context.serviceWorkers()[0];
      assert.equal(await oldWorker.evaluate(() => REVISION), oldRevision);
      const tab = await context.newPage();
      await tab.goto(origin + "/notes/a-quiet-system/");
      await page.evaluate(async () => {
        const cache = await caches.open("unrelated-consumer-cache");
        await cache.put("/sentinel", new Response("retain"));
      });
      serving = current;
      transformed = true;
      const rejected = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        const installing = new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Transformed replacement lifecycle timed out")),
            30000,
          );
          registration.addEventListener(
            "updatefound",
            () => {
              const worker = registration.installing;
              worker.addEventListener("statechange", () => {
                if (worker.state === "redundant" || worker.state === "installed") {
                  clearTimeout(timer);
                  resolve(worker.state);
                }
              });
            },
            { once: true },
          );
        });
        await registration.update();
        return installing;
      });
      assert.equal(rejected, "redundant", "Transformed current output must reject installation");
      assert.equal(
        await page.evaluate(async () =>
          Boolean((await navigator.serviceWorker.getRegistration()).waiting),
        ),
        false,
      );
      assert.ok(
        (await page.evaluate(() => caches.keys())).includes(
          `astromache-recipe-reading-${oldRevision}`,
        ),
        "Rejected upgrade preserves historical corpus",
      );
      transformed = false;
      await page.evaluate(async () => {
        await (await navigator.serviceWorker.getRegistration()).update();
      });
      await poll(
        page,
        async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting),
        "current upgrade waits for controlled clients",
      );
      const replacement = context.serviceWorkers().findLast((worker) => worker !== oldWorker);
      assert.ok(replacement, "Browser must expose the replacement worker");
      assert.equal(await replacement.evaluate(() => REVISION), newRevision);
      await oldWorker.evaluate(() => {
        if (self.registration.active?.state !== "activated" || !self.registration.waiting)
          throw new Error("Old worker must remain active while clients are open");
      });
      assert.equal(
        await page.getByLabel("Search", { exact: true }).inputValue(),
        "quiet",
        "Upgrade preserves live search draft",
      );
      assert.equal(
        await tab.getByRole("heading", { name: "A quiet system", exact: true }).count(),
        1,
        "Upgrade preserves another live article tab",
      );
      await page.close();
      await tab.close();
      await replacement.evaluate(async () => {
        const end = Date.now() + 30000;
        while (self.registration.active?.state !== "activated" || self.registration.waiting) {
          if (Date.now() > end) throw new Error("Natural current activation timed out");
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      });
      page = await context.newPage();
      await page.goto(origin + "/search/");
      await poll(
        page,
        () => Boolean(navigator.serviceWorker.controller),
        "naturally activated current worker controls new page",
      );
      const keys = await page.evaluate(() => caches.keys());
      assert.ok(keys.includes(`astromache-recipe-reading-${newRevision}`));
      assert.ok(
        !keys.includes(`astromache-recipe-reading-${oldRevision}`),
        "Natural activation removes obsolete owned cache",
      );
      assert.equal(
        await page.evaluate(async () =>
          (await (await caches.open("unrelated-consumer-cache")).match("/sentinel")).text(),
        ),
        "retain",
      );
      await context.setOffline(true);
      await page.reload();
      await page.getByLabel("Search", { exact: true }).fill("quiet");
      await page.locator("#search-form button").click();
      await page.locator('#search-results a[href="/notes/a-quiet-system/"]').click();
      await page.getByRole("heading", { name: "A quiet system", exact: true }).waitFor();
      // Compare the response bytes, before browser scripts alter the DOM.
      assert.equal(
        await page.evaluate(async () => (await fetch("/notes/a-quiet-system/")).text()),
        await readFile(join(current, "notes/a-quiet-system/index.html"), "utf8"),
        "Offline navigation returns exact current build bytes",
      );
      await context.setOffline(false);
      await page.reload();
      await page.getByRole("heading", { name: "A quiet system", exact: true }).waitFor();
      console.log(
        `Natural full-consumer worker upgrade passed: ${oldRevision} -> ${newRevision}; rejected transform preserves A, waiting clients preserved, natural B control, unrelated cache retained, exact offline B and reconnect.`,
      );
      return {
        oldRevision,
        newRevision,
        rejectedInstallPreservesOld: true,
        naturalActivation: true,
        unrelatedCachePreserved: true,
        exactOfflineCurrent: true,
      };
    } finally {
      await context.close();
    }
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

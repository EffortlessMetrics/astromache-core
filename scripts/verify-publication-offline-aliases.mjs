import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { chromium } from "@playwright/test";
import { snapshotOfflineCache, assertOfflineCacheUnchanged } from "./offline-cache-snapshot.mjs";

// Qualify the consumer's actual built worker, without regenerating its policy.
export async function verifyPublicationOfflineAliases(directory) {
  const root = resolve(directory, "dist");
  const worker = await readFile(join(root, "reading-worker.js"), "utf8");
  const revision = /const REVISION="([a-f0-9]+)"/.exec(worker)?.[1];
  const prefix = /const PREFIX="([^"]+)"/.exec(worker)?.[1];
  assert.ok(revision && prefix, "Built publication worker identifies its owned cache");
  let disconnected = false;
  const server = createServer(async (request, response) => {
    try {
      if (disconnected) {
        request.socket.destroy();
        return;
      }
      const url = new URL(request.url, "http://localhost");
      const path = decodeURIComponent(url.pathname);
      assert.equal(request.method, "GET");
      if (path === "/posts") {
        response.writeHead(301, { Location: "/posts/" + url.search }).end();
        return;
      }
      const file = resolve(root, "." + path + (path.endsWith("/") ? "index.html" : ""));
      assert.ok(file.startsWith(root + sep));
      response.writeHead(200, {
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
      });
      response.end(await readFile(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const states = [];
  const identity = (bytes) => ({
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  try {
    browser = await chromium.launch();
    const context = await browser.newContext();
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
      const page = await context.newPage();
      await page.goto(origin);
      const deadline = Date.now() + 30000;
      while (
        !(await page.evaluate(async () =>
          Boolean((await navigator.serviceWorker.getRegistration())?.active),
        ))
      ) {
        assert.ok(Date.now() < deadline, "Actual publication worker naturally activates");
        await new Promise((done) => setTimeout(done, 100));
      }
      await page.reload();
      assert.ok(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)));
      const snapshot = () => page.evaluate(snapshotOfflineCache, prefix + revision);
      const before = await snapshot();
      assert.ok(before.length > 0);
      const paths = new Set(before.map((entry) => new URL(entry.url).pathname));
      const routes = [
        ["/", "index.html"],
        ["/index.html", "index.html"],
        ["/posts/", "posts/index.html"],
        ["/posts", "posts/index.html"],
        ["/posts/index.html", "posts/index.html"],
      ];
      for (let cycle = 1; cycle <= 3; cycle++) {
        for (const offline of [true, false]) {
          disconnected = offline;
          await context.setOffline(offline);
          for (const [path, file] of routes) {
            const response = await page.goto(origin + path);
            assert.equal(response.status(), 200, `${path} must remain readable`);
            assert.deepEqual(
              identity(await response.body()),
              identity(await readFile(join(root, file))),
              `${path} returns exact built bytes on cycle ${cycle}, offline=${offline}`,
            );
            const location =
              path === "/posts" && (!offline || paths.has("/posts/")) ? "/posts/" : path;
            assert.equal(new URL(page.url()).pathname, location);
            states.push({ cycle, offline, path, location });
          }
          assertOfflineCacheUnchanged(
            await snapshot(),
            before,
            "Actual publication navigation preserves the verified cache",
          );
        }
      }
      disconnected = true;
      await context.setOffline(true);
      for (const [path] of routes.filter(([path]) => path.endsWith("index.html"))) {
        if (!paths.has(path))
          await assert.rejects(
            page.evaluate((url) => fetch(url), path),
            `${path} cannot gain a non-navigation directory alias`,
          );
      }
      for (const path of ["/api", "/api/index.html"]) {
        const child = await context.newPage();
        try {
          await assert.rejects(child.goto(origin + path));
        } finally {
          await child.close();
        }
      }
      await page.goto(origin + "/posts/index.html?excluded-query=1");
      assert.equal(await page.locator("h1").textContent(), "Offline");
      assertOfflineCacheUnchanged(
        await snapshot(),
        before,
        "Actual publication guard probes preserve the verified cache",
      );
      console.log(
        "Actual built publication worker alias acceptance passed",
        JSON.stringify(states),
      );
      return { revision, cacheEntries: before.length, states, exclusions: true, immutable: true };
    } finally {
      await context.close();
    }
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
}

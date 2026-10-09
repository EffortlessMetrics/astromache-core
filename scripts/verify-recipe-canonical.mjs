import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { chromium } from "@playwright/test";

export async function verifyRecipeCanonical(directory) {
  // Exercise a supported canonical-pages policy using actual exported HTML,
  // bundled registration callbacks and the consumer's installed library.
  // The recipe's default index.html corpus policy remains unchanged.
  const integration = process.env.RECIPE_CANONICAL_PACKAGE_ROOT
    ? join(process.env.RECIPE_CANONICAL_PACKAGE_ROOT, "src/integration.mjs")
    : join(directory, "node_modules/@effortlessmetrics/astro-offline/src/integration.mjs");
  const { generateOfflineWorker } = await import(pathToFileURL(integration).href);
  const root = await mkdtemp(join(tmpdir(), "recipe-canonical-"));
  for (const version of ["a", "b"]) {
    const dir = join(root, version);
    await cp(join(directory, "dist"), dir, { recursive: true });
    const file = join(dir, "posts/index.html");
    const html = (await readFile(file, "utf8")).replace(
      "<body",
      `<body data-canonical-build="${version}"`,
    );
    await writeFile(file, html);
  }
  const receipt = await generateOfflineWorker(join(root, "a"), {
    cachePrefix: "astromache-recipe-reading-",
    workerFile: "reading-worker.js",
    pages: ["/posts/"],
    globPatterns: ["**/*.{html,js,css,json,svg,woff2}"],
    globIgnores: ["posts/index.html"],
    maxResources: 100,
    maxBytes: 5 * 1024 * 1024,
    maxFileBytes: 2 * 1024 * 1024,
    maxHtmlBytes: 256 * 1024,
    worker: {
      navigationStrategy: "network-first",
      stripQuery: false,
      excludedPrefixes: ["/api/"],
      navigationFallback: "/offline/index.html",
    },
  });
  assert.ok(receipt.urls.includes("/posts/"));
  assert.ok(!receipt.urls.includes("/posts/index.html"));
  let serving = "a",
    disconnected = false;
  const server = createServer(async (request, response) => {
    try {
      if (disconnected) {
        request.socket.destroy();
        return;
      }
      const url = new URL(request.url, "http://localhost");
      if (url.pathname === "/posts") {
        response
          .writeHead(301, { Location: "/posts/" + url.search, "Cache-Control": "no-store" })
          .end();
        return;
      }
      // Keep worker A fixed while testing current online document B versus
      // immutable offline A. The existing freshness verifier owns migration.
      const base = join(root, url.pathname === "/reading-worker.js" ? "a" : serving);
      const file = resolve(
        base,
        "." + decodeURIComponent(url.pathname) + (url.pathname.endsWith("/") ? "index.html" : ""),
      );
      assert.ok(file.startsWith(base + sep));
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
            }[extname(file)] || "application/octet-stream",
          "Cache-Control": "no-store",
        })
        .end(await readFile(file));
    } catch {
      response.writeHead(404).end("missing");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const states = [];
  try {
    browser = await chromium.launch();
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(origin);
      await page.waitForFunction(
        () => document.documentElement.dataset.offlineLifecycle === "active",
        null,
        { timeout: 10000 },
      );
      await page.goto(origin + "/posts/");
      await page.waitForFunction(() => navigator.serviceWorker.controller, null, {
        timeout: 10000,
      });
      const snapshot = () =>
        page.evaluate(async (name) => {
          const cache = await caches.open(name);
          return Promise.all(
            (await cache.keys()).map(async (request) => {
              const digest = await crypto.subtle.digest(
                "SHA-256",
                await (await cache.match(request)).arrayBuffer(),
              );
              return [
                request.url,
                Array.from(new Uint8Array(digest), (byte) =>
                  byte.toString(16).padStart(2, "0"),
                ).join(""),
              ];
            }),
          );
        }, "astromache-recipe-reading-" + receipt.revision);
      const before = await snapshot();
      disconnected = true;
      await context.setOffline(true);
      for (const path of ["/posts/", "/posts"]) {
        await page.goto(origin + path);
        assert.equal(
          await page.locator("h1").textContent(),
          "Posts",
          "Canonical and slashless actual recipe must read the cached page",
        );
        assert.equal(new URL(page.url()).pathname, "/posts/");
        assert.equal(await page.locator("body").getAttribute("data-canonical-build"), "a");
        states.push({ path, offlineBuild: "a", canonicalURL: new URL(page.url()).pathname });
      }
      await assert.rejects(page.evaluate(() => fetch("/posts")));
      await page.goto(origin + "/posts?excluded-query=1");
      assert.equal(await page.locator("h1").textContent(), "Offline");
      for (const path of ["/api", "/api/", "/api/contact", "/api?excluded-query=1"]) {
        const child = await context.newPage();
        try {
          await assert.rejects(child.goto(origin + path));
        } finally {
          await child.close();
        }
      }
      await page.goto(origin + "/not-published");
      assert.equal(await page.locator("h1").textContent(), "Offline");
      await context.setOffline(false);
      disconnected = false;
      serving = "b";
      for (const path of ["/posts/", "/posts"]) {
        await page.goto(origin + path);
        assert.equal(await page.locator("body").getAttribute("data-canonical-build"), "b");
        assert.equal(new URL(page.url()).pathname, "/posts/");
        states.push({ path, reconnectBuild: "b", canonicalURL: new URL(page.url()).pathname });
      }
      assert.deepEqual(await snapshot(), before, "Online B never mutates verified A corpus");
      disconnected = true;
      await context.setOffline(true);
      await page.goto(origin + "/posts");
      assert.equal(await page.locator("body").getAttribute("data-canonical-build"), "a");
      assert.equal(new URL(page.url()).pathname, "/posts/");
      await writeFile(
        join(directory, "CANONICAL-QUALIFICATION.json"),
        JSON.stringify(
          {
            pass: true,
            fixturePolicy: "canonical-pages variant; default recipe policy unchanged",
            revision: receipt.revision,
            states,
            exclusions: true,
            immutableCorpus: true,
          },
          null,
          2,
        ) + "\n",
      );
      console.log(
        "Actual exported recipe canonical-pages variant passed: slashless/canonical offline A, reconnect B, exclusions and immutable A",
      );
    } finally {
      await context.close();
    }
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

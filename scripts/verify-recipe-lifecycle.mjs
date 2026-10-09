import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep, extname } from "node:path";
import { createServer } from "node:http";
import { chromium } from "@playwright/test";

export async function verifyRecipeLifecycle(directory) {
  const root = resolve(directory, "dist");
  let transformed = false;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      const file = resolve(
        root,
        "." + decodeURIComponent(url.pathname) + (url.pathname.endsWith("/") ? "index.html" : ""),
      );
      assert.ok(file.startsWith(root + sep));
      let body = await readFile(file);
      if (transformed && extname(file) === ".html")
        body = Buffer.from(
          body
            .toString()
            .replace("</head>", '<meta name="edge-transform" content="rewritten"></head>'),
        );
      response
        .writeHead(200, {
          "Content-Type":
            {
              ".html": "text/html",
              ".js": "text/javascript",
              ".css": "text/css",
              ".svg": "image/svg+xml",
              ".json": "application/json",
              ".woff2": "font/woff2",
            }[extname(file)] || "application/octet-stream",
          "Cache-Control": "no-store",
        })
        .end(body);
    } catch {
      response.writeHead(404).end("missing");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  const results = [];
  try {
    browser = await chromium.launch();
    for (const transform of [true, false]) {
      transformed = transform;
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await page.goto("http://127.0.0.1:" + server.address().port);
        const expected = transform ? "failed" : "active";
        // Exercise the actual bundled recipe callback, not a test registration.
        await page.waitForFunction(
          (state) => document.documentElement.dataset.offlineLifecycle === state,
          expected,
          { timeout: 10000 },
        );
        const result = await page.evaluate(async () => ({
          registration: document.documentElement.dataset.offlineRegistration,
          lifecycle: document.documentElement.dataset.offlineLifecycle,
          hasActiveWorker: document.documentElement.dataset.offlineHasActiveWorker,
          controlsPage: document.documentElement.dataset.offlineControlsPage,
          nativePageControl: Boolean(navigator.serviceWorker.controller),
          registrations: (await navigator.serviceWorker.getRegistrations()).length,
          caches: await caches.keys(),
        }));
        assert.equal(
          result.registration,
          "registered",
          "Registration acceptance stays distinct from readiness",
        );
        assert.equal(result.hasActiveWorker, String(!transform));
        assert.equal(result.controlsPage, String(result.nativePageControl));
        assert.equal(
          result.nativePageControl,
          false,
          "First installation must not claim this existing page",
        );
        assert.equal(result.registrations, transform ? 0 : 1);
        if (transform)
          assert.deepEqual(result.caches, [], "Transformed corpus leaves no usable cache");
        else {
          assert.ok(result.caches.some((name) => name.startsWith("astromache-recipe-reading-")));
          await context.setOffline(true);
          const child = await context.newPage();
          await child.goto("http://127.0.0.1:" + server.address().port + "/posts/");
          assert.ok((await child.locator("h1").textContent()).length > 0);
        }
        results.push({ simulatedHostedTransform: transform, ...result });
      } finally {
        await context.close();
      }
    }
    await writeFile(
      join(directory, "LIFECYCLE-QUALIFICATION.json"),
      JSON.stringify({ pass: true, results }, null, 2) + "\n",
    );
    console.log(
      "Actual exported recipe lifecycle passed: transformed HTML surfaces failed/zero cache; byte-stable output activates and serves offline",
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

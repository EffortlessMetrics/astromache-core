import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { chromium } from "@playwright/test";
export async function verifyRecipeFreshness(directory) {
  const root = await mkdtemp(join(tmpdir(), "recipe-freshness-"));
  const config = (await import(pathToFileURL(join(directory, "astro.config.mjs")).href)).default;
  let serving = "a",
    network = true;
  const server = createServer(async (req, res) => {
    try {
      if (!network) {
        req.socket.destroy();
        return;
      }
      const url = new URL(req.url, "http://localhost");
      const base = join(root, serving);
      const file = resolve(
        base,
        "." + decodeURIComponent(url.pathname) + (url.pathname.endsWith("/") ? "index.html" : ""),
      );
      assert.ok(file.startsWith(base + sep));
      const body = await readFile(file);
      res
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
      res.writeHead(404).end("missing");
    }
  });
  let browser;
  try {
    for (const version of ["a", "b"]) {
      const dir = join(root, version);
      await cp(join(directory, "dist"), dir, { recursive: true });
      const page = join(dir, "index.html");
      let html = await readFile(page, "utf8");
      html = html
        .replace("<body", '<body data-build="' + version + '"')
        .replace("</body>", '<script src="/_astro/fresh-' + version + '.js"></script></body>');
      await writeFile(page, html);
      await writeFile(
        join(dir, "_astro", "fresh-" + version + ".js"),
        "window.recipeAssetBuild=" + JSON.stringify(version) + ";",
      );
      await config.integrations[0].hooks["astro:build:done"]({ dir: pathToFileURL(dir + sep) });
    }
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const origin = "http://127.0.0.1:" + server.address().port;
    browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(origin);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/reading-worker.js", {
        scope: "/",
        updateViaCache: "none",
      });
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    assert.equal(await page.locator("body").getAttribute("data-build"), "a");
    serving = "b";
    await page.reload();
    assert.equal(
      await page.locator("body").getAttribute("data-build"),
      "b",
      "Ordinary online reload must show current recipe deployment",
    );
    assert.equal(await page.evaluate(() => window.recipeAssetBuild), "b");
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setBypassServiceWorker", { bypass: true });
    await Promise.all([page.waitForEvent("load"), cdp.send("Page.reload", { ignoreCache: true })]);
    assert.equal(await page.locator("body").getAttribute("data-build"), "b");
    await cdp.send("Network.setBypassServiceWorker", { bypass: false });
    await page.reload();
    assert.equal(
      await page.locator("body").getAttribute("data-build"),
      "b",
      "Force reload must not be followed by old recipe HTML",
    );
    await context.setOffline(true);
    await page.reload();
    assert.equal(await page.locator("body").getAttribute("data-build"), "a");
    assert.equal(
      await page.evaluate(() => window.recipeAssetBuild),
      "a",
      "Offline HTML and hashed assets must remain one verified build",
    );
    await context.setOffline(false);
    await page.reload();
    assert.equal(await page.locator("body").getAttribute("data-build"), "b");
    console.log(
      "Actual exported recipe freshness passed: ordinary/force/ordinary B, coherent offline A and reconnect B",
    );
    await context.close();
  } finally {
    await browser?.close();
    if (server.listening) await new Promise((r) => server.close(r));
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    await rm(root, { recursive: true, force: true });
  }
}

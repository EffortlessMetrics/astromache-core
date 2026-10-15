import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
const { default: staticOffline } = await import(
  process.env.ASTROMACHE_ROUTE_PRESET ??
    new URL("../packages/astromache/src/static-offline.mjs", import.meta.url).href
);

// Minimal consumer-owned HTML; exercise the actual preset and bundled worker.
const root = await mkdtemp(
  join(process.env.ASTROMACHE_QUALIFICATION_ROOT ?? tmpdir(), "route-recovery-"),
);
const checks = [];
const options = {
  cachePrefix: "route-recovery-",
  globPatterns: ["**/*.{html,svg}"],
  maxBytes: 100000,
  maxResources: 20,
};
for (const base of ["/docs", "/docs/"]) {
  await assert.rejects(
    staticOffline(options).hooks["astro:config:done"]({
      config: { base, build: { format: "directory" } },
    }),
    /requires base/,
  );
  checks.push(`reject base ${base}`);
}
let serving,
  offline = false;
const server = createServer(async (req, res) => {
  try {
    if (offline) {
      req.socket.destroy();
      return;
    }
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/http-error/") {
      res.writeHead(503);
      res.end("real HTTP failure");
      return;
    }
    const file = join(serving, url.pathname, url.pathname.endsWith("/") ? "index.html" : "");
    const body = await readFile(file);
    res.setHeader(
      "Content-Type",
      { ".js": "text/javascript", ".html": "text/html", ".svg": "image/svg+xml" }[extname(file)] ??
        "text/plain",
    );
    res.setHeader("Cache-Control", "no-store");
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("missing fixture");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const bounded = async (promise, label, timeout = 20000) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(label + " timeout")), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
const failures = [];
try {
  for (const fallback of [
    "",
    "/myindex.html",
    "/fallback.txt",
    "/offline?x=1",
    "/offline#fragment",
    "//host/path",
    "relative",
    "https://example.invalid/offline",
    "https://example.invalid/index.html",
    "//host/index.html",
    "relative/index.html",
    "/missing/index.html",
    "/offline/index.html?x=1",
  ]) {
    const dir = await mkdtemp(join(root, "policy-"));
    await writeFile(join(dir, "index.html"), "<h1>neutral policy control</h1>");
    await writeFile(join(dir, "asset.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await staticOffline({ ...options, worker: { navigationFallback: fallback } }).hooks[
      "astro:build:done"
    ]({ dir: pathToFileURL(dir + "/") });
    assert.ok(
      (await readFile(join(dir, "sw.js"), "utf8")).includes(
        `"navigationFallback":${JSON.stringify(fallback)}`,
      ),
      `preserve literal fallback ${fallback}`,
    );
    checks.push(`preserve literal fallback ${fallback}`);
  }
  browser = await chromium.launch();
  console.log("chromium", browser.version());
  for (const fallback of ["/offline/", "/offline/index.html", "/offline"]) {
    console.log("begin", fallback);
    const dir = await mkdtemp(join(root, "consumer-"));
    for (const route of ["", "article", "offline"]) {
      await mkdir(join(dir, route), { recursive: true });
      await writeFile(
        join(dir, route, "index.html"),
        `<h1>${route || "home"}</h1><a href="./image.svg">relative</a>`,
      );
    }
    await writeFile(join(dir, "article/image.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await writeFile(join(dir, "404.html"), "<h1>consumer missing</h1>");
    const preset = staticOffline({
      ...options,
      worker: {
        navigationFallback: fallback,
        navigationStrategy: "network-first",
        navigationTimeoutMs: 100,
      },
    });
    await preset.hooks["astro:config:done"]({
      config: { base: "/", build: { format: "directory" } },
    });
    await preset.hooks["astro:build:done"]({ dir: pathToFileURL(dir + "/") });
    const receipt = JSON.parse(await readFile(join(dir, "offline-receipt.json"), "utf8"));
    assert.deepEqual(receipt.urls, ["/", "/404/", "/article/", "/article/image.svg", "/offline/"]);
    assert.equal(
      await readFile(join(dir, "404/index.html"), "utf8"),
      await readFile(join(dir, "404.html"), "utf8"),
    );
    serving = dir;
    offline = false;
    const context = await browser.newContext({ serviceWorkers: "allow" });
    context.setDefaultTimeout(5000);
    context.setDefaultNavigationTimeout(10000);
    const page = await context.newPage();
    const evaluate = (...args) => bounded(page.evaluate(...args), "browser evaluation");
    try {
      await page.goto(origin + "/");
      await evaluate(async () => {
        await navigator.serviceWorker.register("/sw.js");
        await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((_, reject) =>
            setTimeout(() => reject(Error("worker ready timeout")), 15000),
          ),
        ]);
      });
      await page.reload();
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
      const status = await page.goto(origin + "/http-error/");
      assert.equal(status.status(), 503, "HTTP failures must remain visible online");
      offline = true;
      await context.setOffline(true);
      const cached = await page.goto(origin + "/article/");
      assert.ok(cached.fromServiceWorker(), "canonical document comes from generated worker");
      assert.equal(await page.locator("h1").textContent(), "article");
      await page.goto(origin + "/article");
      assert.equal(
        new URL(page.url()).pathname,
        "/article/",
        "slashless navigation recovers canonical directory URL",
      );
      assert.equal(await page.locator("h1").textContent(), "article");
      const asset = await evaluate(async () => (await fetch("./image.svg")).text());
      assert.match(asset, /<svg/);
      assert.equal(
        await evaluate(async () => {
          try {
            await fetch("/article");
            return true;
          } catch {
            return false;
          }
        }),
        false,
        "resource requests must not gain navigation aliases",
      );
      for (const path of ["/api", "/api/private", "/article/?private=1"]) {
        assert.equal(
          await evaluate(async (path) => {
            try {
              await fetch(path);
              return true;
            } catch {
              return false;
            }
          }, path),
          false,
          `offline negative control ${path}`,
        );
      }
      for (const path of ["/api", "/api/private"]) {
        const denied = await context.newPage();
        try {
          await assert.rejects(
            denied.goto(origin + path),
            /net::ERR_/,
            `API document navigation ${path}`,
          );
        } finally {
          await bounded(denied.close(), "close negative-control page");
        }
      }
      const recovered = await page.goto(origin + "/not-in-corpus/");
      assert.ok(recovered.fromServiceWorker(), "fallback comes from generated worker");
      assert.equal(
        await page.locator("h1").textContent(),
        "offline",
        `offline fallback ${fallback}`,
      );
      console.log("pass", fallback);
      checks.push(
        `generated worker: canonical/slashless document, relative asset, API navigation/resource exclusions, HTTP error, fallback ${fallback}`,
      );
    } catch (error) {
      console.log("failure", fallback, error.message);
      failures.push({ fallback, error: error.message });
    } finally {
      offline = false;
      try {
        await bounded(context.setOffline(false), "restore online");
      } finally {
        await bounded(context.close(), "close context");
      }
    }
  }
} finally {
  try {
    await bounded(browser?.close(), "close browser", 60000);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
console.log(JSON.stringify({ root, node: process.version, checks, failures }, null, 2));
assert.deepEqual(failures, [], "generated route recovery failed");

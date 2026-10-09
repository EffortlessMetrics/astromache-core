import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { chromium } from "@playwright/test";

// Await each browser predicate in Node: an async waitForFunction predicate can
// accidentally treat the Promise itself as truthy instead of its resolved value.
async function poll(page, predicate, description) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${description}`);
}

export async function verifyPublicationBrowser(directory, { recipe }) {
  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (request.method !== "GET" || path.split("/").includes(".."))
        throw new Error("Invalid request");
      const file = join(directory, "dist", path.endsWith("/") ? `${path}index.html` : path);
      response.setHeader(
        "Content-Type",
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".json": "application/json",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".xml": "application/xml",
          ".woff2": "font/woff2",
        }[extname(file)] ?? "text/plain",
      );
      response.end(await readFile(file));
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    for (const width of [320, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      if (recipe)
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
      await context.route("**/*", (route) =>
        new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
      );
      const page = await context.newPage();
      for (const [path, expected] of [
        ["/rss.xml", /a-quiet-system/],
        ["/robots.txt", /sitemap/i],
        ["/sitemap-index.xml", /sitemap/i],
      ]) {
        const response = await page.request.get(`${origin}${path}`);
        assert.equal(response.status(), 200, `${path} must be served`);
        assert.match(await response.text(), expected, `${path} must contain publication metadata`);
      }
      await page.goto(`${origin}/404.html`);
      assert.equal(await page.getByRole("main").count(), 1);
      await page.locator('a.site-title[href="/"]').first().click();
      await page.waitForURL(`${origin}/`);
      await page.getByRole("heading", { name: "Field Notes", exact: true }).waitFor();
      await poll(
        page,
        () =>
          document
            .querySelector("#theme-toggle")
            ?.getAttribute("aria-label")
            ?.startsWith("Switch to "),
        "theme controller initialized",
      );
      if (width < 640) {
        const menu = page.getByRole("button", { name: "Open Menu", exact: true });
        await menu.click();
        assert.equal(await page.locator("main").evaluate((element) => element.inert), true);
        await page.keyboard.press("Escape");
        assert.equal(await page.locator("main").evaluate((element) => element.inert), false);
        assert.equal(await menu.evaluate((element) => element === document.activeElement), true);
        await menu.click();
      }
      const theme = await page.locator("html").getAttribute("data-theme");
      await page.locator("#theme-toggle").click();
      assert.notEqual(await page.locator("html").getAttribute("data-theme"), theme);
      assert.equal(
        await page.evaluate(() => localStorage.getItem("field-notes-theme")),
        await page.locator("html").getAttribute("data-theme"),
      );
      await page.locator("#theme-toggle").click();
      assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
      const posts = page.locator('nav a[href="/posts/"]');
      await posts.focus();
      await page.keyboard.press("Enter");
      await page.waitForURL(`${origin}/posts/`);
      for (const slug of ["a-quiet-system", "making-room-for-change"]) {
        const article = page.locator(`a[href="/notes/${slug}/"]`).first();
        assert.equal(await article.count(), 1);
      }
      await page.locator('a[href="/notes/a-quiet-system/"]').first().click();
      await page.getByRole("heading", { name: "A quiet system", exact: true }).waitFor();
      await page.locator(".post-content h2 .heading-link").first().waitFor({ state: "attached" });
      await page.getByRole("button", { name: "Toggle focus mode", exact: true }).click();
      assert.equal(
        await page.locator("body").evaluate((element) => element.classList.contains("focus-mode")),
        true,
      );
      await page.getByRole("button", { name: "Toggle focus mode", exact: true }).click();
      assert.equal(
        await page.locator("body").evaluate((element) => element.classList.contains("focus-mode")),
        false,
      );
      assert.ok(await page.locator("#reading-time").textContent());
      await page.evaluate(() => {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async (text) => {
              window.__copied = text;
            },
          },
        });
      });
      await page.getByRole("button", { name: "Copy link", exact: true }).click();
      await page.getByRole("button", { name: "Copied link", exact: true }).waitFor();
      assert.match(await page.evaluate(() => window.__copied), /\/notes\/a-quiet-system\/$/);
      await page.locator('a[href="/tags/practice/"]').first().click();
      await page.waitForURL(`${origin}/tags/practice/`);
      assert.ok(await page.locator('a[href="/notes/a-quiet-system/"]').count());
      await page.goto(`${origin}/posts/`);
      await page.locator('a[href="/notes/making-room-for-change/"]').first().click();
      await page.getByRole("heading", { name: "Making room for change", exact: true }).waitFor();
      await page.goto(`${origin}/portfolio/`);
      const trigger = page.getByRole("button", {
        name: "Open Geometric landscape in the portfolio lightbox",
        exact: true,
      });
      await trigger.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Geometric landscape", exact: true });
      await dialog.waitFor({ state: "visible" });
      await poll(
        page,
        () => {
          const image = document.querySelector("#portfolio-lightbox-image");
          return image?.complete && image.naturalWidth > 0;
        },
        "gallery image decoded",
      );
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      if (recipe) {
        await page.goto(`${origin}/search/`);
        await page.getByLabel("Search", { exact: true }).fill("quiet");
        await page.locator("#search-form button").click();
        await page.locator('#search-results a[href="/notes/a-quiet-system/"]').waitFor();
        await poll(
          page,
          async () => Boolean((await navigator.serviceWorker.getRegistration())?.active),
          "active recipe worker",
        );
        await page.reload();
        await poll(page, () => Boolean(navigator.serviceWorker.controller), "recipe controller");
        await poll(
          page,
          async () =>
            Boolean(await caches.match("/search-index.json", { ignoreSearch: true })) &&
            Boolean(
              (await caches.match("/notes/a-quiet-system/", { ignoreSearch: true })) ||
              (await caches.match("/notes/a-quiet-system/index.html", { ignoreSearch: true })),
            ) &&
            Boolean(
              (await caches.match("/search/", { ignoreSearch: true })) ||
              (await caches.match("/search/index.html", { ignoreSearch: true })),
            ),
          "precache search and navigation",
        );
        // A fresh page has no in-memory search index and must fetch it offline.
        await page.close();
        await context.setOffline(true);
        const offlinePage = await context.newPage();
        await offlinePage.goto(`${origin}/search/`);
        await offlinePage.getByLabel("Search", { exact: true }).fill("quiet");
        await offlinePage.locator("#search-form button").click();
        await offlinePage.locator('#search-results a[href="/notes/a-quiet-system/"]').click();
        await offlinePage.getByRole("heading", { name: "A quiet system", exact: true }).waitFor();
      }
      await context.close();
    }
    console.log(
      `Publication browser passed: keyboard navigation, article/taxonomy, gallery focus and responsive layout${recipe ? ", online and fresh offline search/navigation" : ""}`,
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

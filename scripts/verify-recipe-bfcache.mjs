import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { chromium } from "@playwright/test";
async function poll(page, predicate, label) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    if (await page.evaluate(predicate)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out: " + label);
}
export async function verifyRecipeBFCache(directory) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if (request.method !== "GET" || url.pathname.split("/").includes(".."))
        throw new Error("Invalid path");
      const file = join(
        directory,
        "dist",
        url.pathname.endsWith("/") ? url.pathname + "index.html" : url.pathname,
      );
      response.setHeader(
        "Content-Type",
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".json": "application/json",
          ".svg": "image/svg+xml",
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
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({
    channel: "chromium",
    ignoreDefaultArgs: ["--disable-back-forward-cache"],
  });
  try {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      window.__recipeDocument = crypto.randomUUID();
      window.__recipeRestored = false;
      window.__recipeRestores = 0;
      window.__recipeHides = [];
      window.addEventListener("pagehide", (event) => {
        window.__recipeHides.push(event.persisted);
        if (!event.persisted)
          sessionStorage.setItem(
            "__recipeDiscard",
            JSON.stringify({ marker: window.__recipeDocument, hides: window.__recipeHides }),
          );
      });
      window.addEventListener("pageshow", (event) => {
        if (event.persisted) {
          window.__recipeRestored = true;
          window.__recipeRestores++;
        }
      });
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
    const page = await context.newPage();

    await page.goto(origin + "/search/");
    await poll(
      page,
      async () => Boolean((await navigator.serviceWorker.getRegistration())?.active),
      "initial worker active",
    );
    await page.reload();
    await poll(page, () => Boolean(navigator.serviceWorker.controller), "search page controlled");
    await page.getByLabel("Search", { exact: true }).fill("A quiet system");
    await page.locator("#search-form button").click();
    await page.locator('#search-results a[href="/notes/a-quiet-system/"]').waitFor();
    await poll(
      page,
      async () => Boolean((await navigator.serviceWorker.getRegistration())?.active),
      "worker active before cacheable navigation",
    );
    const marker = await page.evaluate(() => window.__recipeDocument);
    await page.locator('#search-results a[href="/notes/a-quiet-system/"]').click();
    await page.getByRole("heading", { name: "A quiet system", exact: true }).waitFor();
    await context.setOffline(true);
    await page.goBack({ waitUntil: "commit" });
    await poll(page, () => window.__recipeRestored === true, "actual persisted pageshow");
    assert.equal(
      await page.evaluate(() => window.__recipeDocument),
      marker,
      "Back restores the same live document",
    );
    console.log("BFCache proof: persisted pageshow and identical live document marker.");
    await page.getByLabel("Search", { exact: true }).fill("Making room for change");
    await page.locator("#search-form button").click();
    await poll(
      page,
      () =>
        Boolean(
          document.querySelector('#search-results a[href="/notes/making-room-for-change/"]'),
        ) || document.querySelector("#search-status")?.textContent === "Search unavailable",
      "restored search settles",
    );
    assert.equal(
      await page.locator('#search-results a[href="/notes/making-room-for-change/"]').count(),
      1,
      "BFCache-restored backend must perform another search",
    );
    assert.equal(
      await page.locator('#search-results a[href="/notes/a-quiet-system/"]').count(),
      0,
      "new query replaces old results",
    );
    for (let cycle = 0; cycle < 3; cycle++) {
      const restores = await page.evaluate(() => window.__recipeRestores);
      await page.locator("#search-results a").click();
      await page
        .getByRole("heading", { name: /A quiet system|Making room for change/ })
        .first()
        .waitFor();
      await context.setOffline(true);
      await page.goBack({ waitUntil: "commit" });
      const end = Date.now() + 30000;
      while (Date.now() < end && (await page.evaluate(() => window.__recipeRestores)) === restores)
        await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(
        await page.evaluate(() => window.__recipeRestores),
        restores + 1,
        "Each Back really restores BFCache",
      );
      assert.equal(
        await page.evaluate(() => window.__recipeDocument),
        marker,
        "Repeated Back retains the same document",
      );
      const title = cycle % 2 === 0 ? "A quiet system" : "Making room for change";
      await page.getByLabel("Search", { exact: true }).fill(title);
      await page.locator("#search-form button").click();
      await page.locator("#search-results a").filter({ hasText: title }).waitFor();
      assert.equal(await page.locator("#search-results a").textContent(), title);
      assert.equal(
        await page.locator("#search-results a").count(),
        1,
        "One result after repeated restoration",
      );
    }
    assert.deepEqual(
      await page.evaluate(() => window.__recipeHides),
      [true, true, true, true],
      "Four real persisted exits recorded in the original live document",
    );
    await context.setOffline(false);
    await page.reload();
    assert.notEqual(
      await page.evaluate(() => window.__recipeDocument),
      marker,
      "Reload genuinely discards the previous document",
    );
    const discarded = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("__recipeDiscard")),
    );
    assert.equal(discarded.marker, marker, "Discard receipt is from the original document");
    assert.deepEqual(
      discarded.hides,
      [true, true, true, true, false],
      "Genuine reload emits nonpersisted hide after four persisted exits",
    );
    await page.getByLabel("Search", { exact: true }).fill("A quiet system");
    await page.locator("#search-form button").click();
    await page.locator('#search-results a[href="/notes/a-quiet-system/"]').waitFor();
    await context.close();
    console.log(
      "Actual recipe BFCache passed: four persisted offline restores, query replacement and genuine reload.",
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

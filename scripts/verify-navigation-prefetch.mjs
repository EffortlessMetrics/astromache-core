import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

export async function verifyNavigationPrefetchBrowser(
  sourceFile = fileURLToPath(new URL("../packages/astromache/src/navigation.ts", import.meta.url)),
) {
  const source = await readFile(sourceFile, "utf8");
  const javascript = stripTypeScriptTypes(source);
  const server = createServer((request, response) => {
    response.setHeader(
      "Content-Type",
      request.url === "/navigation.js" ? "text/javascript" : "text/html",
    );
    response.end(
      request.url === "/navigation.js"
        ? javascript
        : '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Navigation fixture</title></head><body></body></html>',
    );
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const results = [];
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    page.setDefaultTimeout(3000);
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));

    async function open(links, maxTargets = 1) {
      await page.mouse.move(1000, 600);
      await page.goto(origin);
      errors.length = 0;
      await page.evaluate(
        async ({ links, maxTargets }) => {
          Object.defineProperty(navigator, "connection", { configurable: true, value: undefined });
          const { installNavigationPrefetch } = await import("/navigation.js");
          for (const [id, href] of Object.entries(links)) {
            const link = document.createElement("a");
            link.id = id;
            link.href = href;
            link.textContent = id;
            link.style.display = "block";
            document.body.append(link);
          }
          window.calls = [];
          window.dispose = installNavigationPrefetch((url) => window.calls.push(url), {
            maxTargets,
            delayMs: 20,
          });
        },
        { links, maxTargets },
      );
    }

    async function test(name, run) {
      try {
        await run();
        results.push({ name, pass: true });
      } catch (error) {
        results.push({ name, pass: false, error: error.message });
      }
    }

    for (const href of ["http://[", "https://example.com:invalid/", "//[::1"]) {
      for (const intent of ["hover", "focus"]) {
        await test(`${intent} ignores malformed href ${href} and preserves the budget`, async () => {
          await open({ invalid: href, valid: "/valid/" });
          await page.locator("#invalid")[intent]();
          // Let the configured debounce expire before testing the eligible control.
          await page.waitForTimeout(50);
          assert.deepEqual(await page.evaluate(() => window.calls), []);
          await page.locator("#valid")[intent]();
          await page.waitForFunction(() => window.calls.length === 1);
          assert.deepEqual(await page.evaluate(() => window.calls), [`${origin}/valid/`]);
          assert.deepEqual(errors, [], "Malformed URLs must not escape the intent handler");
        });
      }
    }

    await test("valid relative URLs remain bounded and deduplicated", async () => {
      await open(
        { first: "/first/", duplicate: "/first/", second: "/second/", third: "/third/" },
        2,
      );
      await page.locator("#first").focus();
      await page.waitForFunction(() => window.calls.length === 1);
      await page.locator("#duplicate").hover();
      await page.waitForTimeout(50);
      assert.deepEqual(await page.evaluate(() => window.calls), [`${origin}/first/`]);
      await page.locator("#second").focus();
      await page.waitForFunction(() => window.calls.length === 2);
      await page.locator("#third").hover();
      await page.waitForTimeout(50);
      assert.deepEqual(await page.evaluate(() => window.calls), [
        `${origin}/first/`,
        `${origin}/second/`,
      ]);
      assert.deepEqual(errors, []);
    });
    await test("disposal cancels a pending valid prefetch", async () => {
      await open({ valid: "/valid/" });
      await page.evaluate(() => {
        document.querySelector("#valid").focus();
        window.dispose();
      });
      await page.waitForTimeout(50);
      assert.deepEqual(await page.evaluate(() => window.calls), []);
      assert.deepEqual(errors, []);
    });
    console.log(
      JSON.stringify(
        {
          sourceFile,
          sourceSha256: createHash("sha256").update(source).digest("hex"),
          browser: browser.version(),
          results,
        },
        null,
        2,
      ),
    );
    assert.ok(
      results.every((result) => result.pass),
      "Navigation prefetch browser regressions failed",
    );
  } finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyNavigationPrefetchBrowser(process.env.ASTROMACHE_NAVIGATION_SOURCE);
}

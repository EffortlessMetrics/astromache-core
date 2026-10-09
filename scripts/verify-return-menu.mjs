import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, readFile, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const fixture = await mkdtemp(join(tmpdir(), "astromache-return-menu-"));
let browser, server;
try {
  await mkdir(join(fixture, "src/pages"), { recursive: true });
  await symlink(join(root, "node_modules"), join(fixture, "node_modules"), "junction");
  await writeFile(join(fixture, "package.json"), JSON.stringify({ type: "module" }));
  const packageRequire = createRequire(join(root, "packages/astromache/package.json"));
  await writeFile(
    join(fixture, "astro.config.mjs"),
    `export default {vite:{resolve:{alias:{"bcp-47":${JSON.stringify(packageRequire.resolve("bcp-47").replaceAll("\\", "/"))}}}}};`,
  );
  await cp(join(root, "packages/astromache/src"), join(fixture, "src/components"), {
    recursive: true,
  });
  const component = (name) => JSON.stringify("../components/" + name + ".astro");
  await writeFile(
    join(fixture, "src/pages/index.astro"),
    `---
import Header from ${component("Header")};
import PostList from ${component("PostList")};
---
<html><head><meta name="viewport" content="width=device-width" /></head><body>
<Header brand="Fixture" links={[{label:'Article',href:'/article/'}]} />
<main><PostList items={[{title:'Read article',href:'/article/',description:'Neutral'}]} returnStorageKey="fixture-return"/><button id="outside">Outside</button></main><footer>Footer</footer>
<dialog data-tas-dialog><button id="overlay-control">Overlay</button></dialog>
<style is:global>.nav-items{display:none}.nav-items[data-open]{display:block}</style>
</body></html>`,
  );
  await writeFile(
    join(fixture, "src/pages/article.astro"),
    `---
import Article from ${component("Article")};
---
<html><body><main><Article title="Article" published={{datetime:'2026-01-01',label:'January'}} returnStorageKey="fixture-return"/></main></body></html>`,
  );
  for (const [name, text] of [
    ["empty", ""],
    ["whitespace", " \n\t "],
    ["nonempty", "A normal article"],
  ]) {
    await writeFile(
      join(fixture, `src/pages/progress-${name}.astro`),
      `---
import ReadingProgress from ${component("ReadingProgress")};
---
<html><body><ReadingProgress/><main class="post-content">${text}</main><div style="height:3000px"></div></body></html>`,
    );
  }
  await writeFile(
    join(fixture, "src/pages/theme.astro"),
    `---
import Publication from ${component("Publication")};
import ${JSON.stringify(join(root, "packages/astromache/src/publication.css").replaceAll("\\", "/"))};
---
<Publication title="Theme fixture" description="Native controls" canonical={new URL('https://example.com/theme/')} language="en"><button id="theme-toggle">Theme</button><input id="native-control" aria-label="Native control"/></Publication>`,
  );
  execFileSync(
    process.execPath,
    [join(dirname(require.resolve("astro/package.json")), "bin/astro.mjs"), "build"],
    { cwd: fixture, stdio: "inherit" },
  );
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://localhost").pathname;
      const file = join(
        fixture,
        "dist",
        pathname.endsWith("/") ? pathname + "index.html" : pathname,
      );
      response.setHeader(
        "Content-Type",
        extname(file) === ".js"
          ? "text/javascript"
          : extname(file) === ".css"
            ? "text/css"
            : "text/html",
      );
      response.end(await readFile(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
  page.setDefaultTimeout(3000);
  const results = [];
  async function test(name, run) {
    try {
      await run();
      results.push({ name, pass: true });
    } catch (error) {
      results.push({ name, pass: false, error: error.message });
    }
  }
  await test("query return restored by actual Article", async () => {
    await page.goto(origin + "/?page=2&tag=notes");
    await page.getByText("Read article", { exact: true }).click();
    await page.waitForURL("**/article/");
    await page.waitForFunction(
      () => document.querySelector("[data-article-back]").getAttribute("href").includes("page=2"),
      null,
      { timeout: 3000 },
    );
    assert.equal(
      await page.locator("[data-article-back]").getAttribute("href"),
      "/?page=2&tag=notes",
    );
    await page.locator("[data-article-back]").click();
    await page.waitForURL("**/?page=2&tag=notes");
  });
  await test("closed native dialog does not steal Escape", async () => {
    await page.goto(origin + "/");
    await page.locator(".menu-toggle").click();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".menu-toggle").getAttribute("aria-expanded"), "false");
    assert.equal(await page.locator("main").evaluate((el) => el.inert), false);
    assert.equal(
      await page.evaluate(() => document.activeElement.classList.contains("menu-toggle")),
      true,
    );
  });
  await test("closed native dialog does not steal Tab boundary", async () => {
    await page.goto(origin + "/");
    await page.locator(".menu-toggle").click();
    await page.locator(".nav-items a").focus();
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement.classList.contains("site-title")),
      true,
    );
  });
  await test("open overlay retains Escape and Tab ownership", async () => {
    await page.goto(origin + "/");
    await page.locator(".menu-toggle").click();
    await page.evaluate(() => document.querySelector("dialog").showModal());
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement.classList.contains("site-title")),
      false,
    );
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".menu-toggle").getAttribute("aria-expanded"), "true");
    await page.waitForFunction(() => !document.querySelector("dialog").open);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".menu-toggle").getAttribute("aria-expanded"), "false");
  });
  await test("closed first dialog does not mask later active overlay", async () => {
    await page.goto(origin + "/");
    await page.locator(".menu-toggle").click();
    await page.evaluate(() => {
      const later = document.createElement("dialog");
      later.dataset.tasDialog = "";
      later.id = "later-dialog";
      later.innerHTML = "<button>Later overlay</button>";
      document.body.append(later);
      later.showModal();
    });
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".menu-toggle").getAttribute("aria-expanded"), "true");
    await page.waitForFunction(() => !document.querySelector("#later-dialog").open);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".menu-toggle").getAttribute("aria-expanded"), "false");
  });
  for (const [name, expected] of [
    ["empty", "Complete!"],
    ["whitespace", "Complete!"],
    ["nonempty", "1 min left"],
  ]) {
    await test(`${name} scrollable content reading progress`, async () => {
      await page.goto(origin + `/progress-${name}/`);
      await page.waitForFunction(
        () => document.querySelector(".time-remaining")?.textContent !== "",
        null,
        { timeout: 3000 },
      );
      assert.equal(await page.locator(".time-remaining").textContent(), expected);
      assert.equal(await page.locator(".progress-percent").textContent(), "0%");
    });
  }
  for (const [os, saved] of [
    ["dark", "light"],
    ["light", "dark"],
  ]) {
    await test(`native controls follow ${saved} preference against ${os} OS and toggle`, async () => {
      const context = await browser.newContext({ colorScheme: os });
      try {
        await context.addInitScript((value) => localStorage.setItem("theme", value), saved);
        const themed = await context.newPage();
        await themed.goto(origin + "/theme/");
        assert.equal(await themed.locator("html").getAttribute("data-theme"), saved);
        assert.equal(
          await themed
            .locator("#native-control")
            .evaluate((el) => getComputedStyle(el).colorScheme),
          saved,
        );
        const initial = await themed
          .locator("#native-control")
          .evaluate((el) => getComputedStyle(el).backgroundColor);
        await themed.locator("#theme-toggle").click();
        assert.equal(await themed.locator("html").getAttribute("data-theme"), os);
        assert.equal(
          await themed
            .locator("#native-control")
            .evaluate((el) => getComputedStyle(el).colorScheme),
          os,
        );
        assert.notEqual(
          await themed
            .locator("#native-control")
            .evaluate((el) => getComputedStyle(el).backgroundColor),
          initial,
        );
        assert.equal(await themed.evaluate(() => localStorage.getItem("theme")), os);
      } finally {
        await context.close();
      }
    });
  }
  console.log(JSON.stringify(results));
  assert(
    results.every((result) => result.pass),
    "Return/menu browser regressions failed",
  );
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(fixture, { recursive: true, force: true });
}

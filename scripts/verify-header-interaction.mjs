import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
// Windows tmpdir can use a DOS alias. Keep Astro/Vite CSS identities canonical.
const fixture = await realpath(await mkdtemp(join(tmpdir(), "astromache-header-interaction-")));
const headerSource = await readFile(
  process.env.ASTROMACHE_HEADER_COMPONENT || join(root, "packages/astromache/src/Header.astro"),
);
const results = [];
let browser, server;

try {
  await mkdir(join(fixture, "src/pages"), { recursive: true });
  await mkdir(join(fixture, "src/components"));
  await symlink(
    join(root, "node_modules"),
    join(fixture, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await writeFile(join(fixture, "package.json"), JSON.stringify({ type: "module" }));
  await writeFile(join(fixture, "astro.config.mjs"), "export default {};");
  await writeFile(join(fixture, "src/components/Header.astro"), headerSource);
  await copyFile(
    join(root, "packages/astromache/src/publication.css"),
    join(fixture, "src/components/publication.css"),
  );

  for (const [name, controls, footerInert] of [
    ["fragments", "", false],
    [
      "controls",
      `<input slot="controls" id="header-query" aria-label="Header search" />
       <input slot="controls" id="disabled-input" aria-label="Disabled input" disabled />
       <fieldset slot="controls" disabled><input id="fieldset-input" aria-label="Disabled fieldset input" /></fieldset>
       <input slot="controls" id="hidden-input" aria-label="Hidden input" hidden />
       <input slot="controls" id="invisible-input" aria-label="Invisible input" style="visibility:hidden" />
       <input slot="controls" id="negative-input" aria-label="Programmatic input" tabindex="-1" />
       <select slot="controls" id="header-choice" aria-label="Header choice"><option>One</option><option>Two</option></select>
       <textarea slot="controls" id="header-notes" aria-label="Header notes"></textarea>
       <span slot="controls" id="custom-control" tabindex="0" role="button">Custom control</span>
       <div slot="controls" id="header-editor" contenteditable="true" aria-label="Header editor">Editable text<div id="nested-editor" contenteditable="true">Nested text</div></div>
       <div slot="controls" id="negative-editor" contenteditable="true" tabindex="-1">Programmatic editor</div>`,
      false,
    ],
    [
      "radios",
      `<input slot="controls" id="selected-radio" type="radio" name="header-choice" aria-label="Selected choice" checked />
       <input slot="controls" id="unselected-radio" type="radio" name="header-choice" aria-label="Other choice" />`,
      false,
    ],
    ["preserved", "", true],
  ]) {
    await writeFile(
      join(fixture, `src/pages/${name}.astro`),
      `---
import Header from '../components/Header.astro';
import '../components/publication.css';
---
<html lang="en"><head><meta name="viewport" content="width=device-width"/><title>Header interaction fixture</title></head><body>
<Header brand="Fixture" brandHref="/fragments/" links={[{label:'Contents',href:'#contents'},{label:'Details',href:'/${name}/#details'},{label:'Top',href:'#'}]}>
${controls}
</Header>
<main><h1 id="contents" tabindex="-1">Contents</h1><p style="min-height:1200px">Neutral content</p><h2 id="details" tabindex="-1">Details</h2><button id="outside">Outside</button></main>
<footer${footerInert ? " inert" : ""}>Footer</footer>
</body></html>`,
    );
  }

  execFileSync(
    process.execPath,
    [join(dirname(require.resolve("astro/package.json")), "bin/astro.mjs"), "build"],
    { cwd: fixture, stdio: "inherit", timeout: 60000 },
  );
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (request.method !== "GET" || pathname.split("/").includes(".."))
        throw new Error("Invalid request");
      const file = join(
        fixture,
        "dist",
        pathname.endsWith("/") ? pathname + "index.html" : pathname,
      );
      response.setHeader(
        "Content-Type",
        { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[extname(file)] ??
          "application/octet-stream",
      );
      response.end(await readFile(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    executablePath: process.env.ASTROMACHE_HEADER_BROWSER_EXECUTABLE || undefined,
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
  page.setDefaultTimeout(3000);
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );

  async function test(name, run) {
    try {
      await run();
      results.push({ name, pass: true });
    } catch (error) {
      results.push({ name, pass: false, error: error.message });
    }
  }
  async function open(name) {
    await page.goto(`${origin}/${name}/`);
    await page.getByRole("button", { name: "Open Menu", exact: true }).click();
    assert.equal(await page.locator("main").evaluate((element) => element.inert), true);
  }
  async function active() {
    return page.evaluate(() => document.activeElement.id || document.activeElement.className);
  }
  async function expectClosed() {
    assert.equal(await page.locator(".menu-toggle").getAttribute("aria-expanded"), "false");
    assert.equal(await page.locator(".menu-toggle").getAttribute("aria-label"), "Open Menu");
    assert.equal(await page.locator("main").evaluate((element) => element.inert), false);
    assert.equal(
      await page.locator(".nav-items").evaluate((element) => element.hasAttribute("data-open")),
      false,
    );
  }

  for (const [label, hash] of [
    ["Contents", "#contents"],
    ["Details", "#details"],
  ]) {
    await test(`${label} fragment closes menu and releases destination focus`, async () => {
      await open("fragments");
      await page.getByRole("link", { name: label, exact: true }).focus();
      await page.keyboard.press("Enter");
      await page.waitForURL(`${origin}/fragments/${hash}`);
      await expectClosed();
      assert.equal(await active(), hash.slice(1));
    });
  }

  await test("empty fragment closes menu and restores access at the page top", async () => {
    await open("fragments");
    await page.getByRole("link", { name: "Top", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(`${origin}/fragments/#`);
    await expectClosed();
    assert.ok(await page.evaluate(() => scrollY < 2));
  });

  await test("forward cycle includes input/select/textarea/custom controls and skips unavailable inputs", async () => {
    await open("controls");
    await page.getByRole("link", { name: "Top", exact: true }).focus();
    for (const id of [
      "header-query",
      "header-choice",
      "header-notes",
      "custom-control",
      "header-editor",
      "site-title",
    ]) {
      await page.keyboard.press("Tab");
      assert.equal(await active(), id);
    }
  });
  await test("backward cycle includes all eligible slotted controls", async () => {
    await open("controls");
    await page.locator(".site-title").focus();
    for (const id of [
      "header-editor",
      "custom-control",
      "header-notes",
      "header-choice",
      "header-query",
    ]) {
      await page.keyboard.press("Shift+Tab");
      assert.equal(await active(), id);
    }
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.evaluate(() => document.activeElement.textContent), "Top");
  });
  await test("checked radio group is the forward and backward focus boundary", async () => {
    await open("radios");
    await page.locator("#selected-radio").focus();
    await page.keyboard.press("Tab");
    assert.equal(await active(), "site-title");
    await page.keyboard.press("Shift+Tab");
    assert.equal(await active(), "selected-radio");
    assert.equal(await page.locator("#selected-radio").isChecked(), true);
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator("#unselected-radio").isChecked(), true);
    await page.keyboard.press("Tab");
    assert.equal(await active(), "site-title");
    await page.keyboard.press("Shift+Tab");
    assert.equal(await active(), "unselected-radio");
  });
  for (const unavailable of ["disabled", "fieldset", "hidden", "invisible", "negative", "inert"]) {
    await test(`${unavailable} trailing control cannot become a focus boundary`, async () => {
      await open("controls");
      await page.evaluate((kind) => {
        const control = document.createElement("input");
        if (kind === "disabled") control.disabled = true;
        if (kind === "hidden") control.hidden = true;
        if (kind === "invisible") control.style.visibility = "hidden";
        if (kind === "negative") control.tabIndex = -1;
        if (kind === "inert") control.inert = true;
        let tail = control;
        if (kind === "fieldset") {
          const fieldset = document.createElement("fieldset");
          fieldset.disabled = true;
          fieldset.append(control);
          tail = fieldset;
        }
        document.querySelector(".nav-items").append(tail);
      }, unavailable);
      await page.locator("#header-editor").focus();
      await page.keyboard.press("Tab");
      assert.equal(await active(), "site-title");
    });
  }
  await test("Escape restores toggle focus and allows repeated opening", async () => {
    await open("controls");
    await page.locator("#header-choice").focus();
    await page.keyboard.press("Escape");
    await expectClosed();
    assert.equal(await active(), "icon-button menu-toggle");
    await page.getByRole("button", { name: "Open Menu", exact: true }).click();
    assert.equal(await page.locator("main").evaluate((element) => element.inert), true);
    await page.getByRole("button", { name: "Close Menu", exact: true }).click();
    await expectClosed();
    assert.equal(await active(), "icon-button menu-toggle");
  });
  await test("closing restores pre-existing inert state", async () => {
    await open("preserved");
    await page.keyboard.press("Escape");
    await expectClosed();
    assert.equal(await page.locator("footer").evaluate((element) => element.inert), true);
    assert.equal(await active(), "icon-button menu-toggle");
  });

  for (const width of [390, 280]) {
    for (const selector of [".nav-items a", "#header-query"]) {
      await test(`desktop ${selector} focus reaches the toggle at ${width}px`, async () => {
        await page.setViewportSize({ width: 1024, height: 800 });
        await page.goto(`${origin}/controls/`);
        await page.locator(selector).first().focus();
        await page.setViewportSize({ width, height: 800 });
        await page.waitForFunction(() => document.activeElement.matches(".menu-toggle"));
        await expectClosed();
        await page.keyboard.press("Enter");
        assert.equal(await page.locator(".menu-toggle").getAttribute("aria-expanded"), "true");
        assert.equal(await page.evaluate(() => document.activeElement.textContent), "Contents");
        await page.keyboard.press("Escape");
        await expectClosed();
      });
    }
    await test(`focused toggle reaches desktop navigation from ${width}px`, async () => {
      await page.setViewportSize({ width, height: 800 });
      await open("controls");
      await page.keyboard.press("Escape");
      assert.equal(await active(), "icon-button menu-toggle");
      await page.setViewportSize({ width: 1024, height: 800 });
      await page.waitForFunction(() => document.activeElement.textContent === "Contents");
      await expectClosed();
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement.textContent), "Details");
    });
  }

  await test("visible navigation retains focus while an open menu becomes desktop navigation", async () => {
    await page.setViewportSize({ width: 390, height: 800 });
    await open("controls");
    await page.locator("#header-query").focus();
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.waitForFunction(
      () => document.querySelector(".menu-toggle").getAttribute("aria-expanded") === "false",
    );
    await expectClosed();
    assert.equal(await active(), "header-query");
  });

  for (const selector of [".site-title", "#outside"]) {
    await test(`${selector} focus is preserved across both breakpoint directions`, async () => {
      await page.setViewportSize({ width: 1024, height: 800 });
      await page.goto(`${origin}/controls/`);
      await page.locator(selector).focus();
      await page.setViewportSize({ width: 390, height: 800 });
      await page.waitForFunction(
        () => document.querySelector(".menu-toggle").getClientRects().length > 0,
      );
      assert.equal(
        await page.locator(selector).evaluate((element) => element === document.activeElement),
        true,
      );
      await page.setViewportSize({ width: 1024, height: 800 });
      await page.waitForFunction(
        () => document.querySelector(".menu-toggle").getClientRects().length === 0,
      );
      assert.equal(
        await page.locator(selector).evaluate((element) => element === document.activeElement),
        true,
      );
    });
  }

  for (const crossings of [12, 13]) {
    await test(`${crossings} rapid breakpoint crossings retain usable keyboard focus`, async () => {
      await page.setViewportSize({ width: 640, height: 800 });
      await page.goto(`${origin}/controls/`);
      await page.getByRole("link", { name: "Contents", exact: true }).focus();
      for (let index = 0; index < crossings; index++)
        await page.setViewportSize({ width: index % 2 ? 640 : 639, height: 800 });
      if (crossings % 2) {
        await page.waitForFunction(() => document.activeElement.matches(".menu-toggle"));
        await page.keyboard.press("Enter");
        assert.equal(await page.locator("main").evaluate((element) => element.inert), true);
        await page.keyboard.press("Escape");
      } else {
        await page.waitForFunction(() => document.activeElement.textContent === "Contents");
        await page.keyboard.press("Tab");
        assert.equal(await page.evaluate(() => document.activeElement.textContent), "Details");
      }
      await expectClosed();
    });
  }

  const evidence = {
    fixture,
    stylesheets: await page.evaluate(() => [...document.styleSheets].map((sheet) => sheet.href)),
    headerSha256: createHash("sha256").update(headerSource).digest("hex"),
    nodeVersion: process.version,
    browserVersion: browser.version(),
    results,
  };
  console.log(JSON.stringify(evidence, null, 2));
  if (process.env.ASTROMACHE_HEADER_EVIDENCE)
    await writeFile(
      resolve(process.env.ASTROMACHE_HEADER_EVIDENCE),
      JSON.stringify(evidence, null, 2) + "\n",
    );
  assert.ok(
    results.every((result) => result.pass),
    "Header interaction regressions failed",
  );
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(fixture, { recursive: true, force: true });
}

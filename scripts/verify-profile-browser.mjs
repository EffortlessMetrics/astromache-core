import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

export async function verifyProfileBrowser(directory, evidenceDirectory) {
  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (request.method !== "GET" || path.split("/").includes("..")) {
        response.writeHead(400).end();
        return;
      }
      const file = join(directory, "dist", path.endsWith("/") ? `${path}index.html` : path);
      response.setHeader(
        "Content-Type",
        {
          ".html": "text/html",
          ".svg": "image/svg+xml",
          ".woff2": "font/woff2",
          ".css": "text/css",
          ".js": "text/javascript",
        }[extname(file)] ?? "application/octet-stream",
      );
      response.end(await readFile(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.ASTROMACHE_CHROMIUM_EXECUTABLE;
  let browser;
  const checks = [];
  try {
    browser = await chromium.launch(executablePath ? { executablePath } : undefined);
    if (evidenceDirectory) await mkdir(evidenceDirectory, { recursive: true });
    for (const width of [320, 390, 1440]) {
      for (const colorScheme of ["light", "dark"]) {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          colorScheme,
          serviceWorkers: "block",
        });
        await context.route("**/*", (route) =>
          new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
        );
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`${origin}/profile/`);
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1);
        assert.equal(await page.getByRole("heading", { level: 1 }).textContent(), "Example author");
        assert.deepEqual(await page.getByRole("heading", { level: 2 }).allTextContents(), [
          "Speaking",
          "Follow me",
        ]);
        assert.equal(await page.locator("html").getAttribute("data-theme"), colorScheme);
        assert.equal(
          await page.getByRole("link", { name: "Example profile" }).getAttribute("rel"),
          "me",
        );
        assert.equal(
          await page.getByRole("link", { name: "Example profile" }).getAttribute("target"),
          null,
        );
        const portrait = await page.locator(".profile-portrait").boundingBox();
        const biography = await page.locator(".profile-about").boundingBox();
        assert.ok(portrait && biography);
        if (width < 640)
          assert.ok(
            biography.y >= portrait.y + portrait.height,
            "Narrow portrait stacks above About",
          );
        else
          assert.ok(biography.x >= portrait.x + portrait.width, "Wide portrait stays beside About");
        const recordedTalk = page.getByRole("link", { name: "Example recorded talk" });
        await recordedTalk.focus();
        await page.keyboard.press("Tab");
        assert.equal(
          await page
            .getByRole("link", { name: "Example profile" })
            .evaluate((el) => el === document.activeElement),
          true,
        );
        if (width < 640) await page.getByRole("button", { name: "Open Menu", exact: true }).click();
        await page.getByRole("navigation").getByRole("link", { name: "Follow me" }).click();
        assert.equal(new URL(page.url()).hash, "#follow");
        if (width < 640)
          assert.equal(await page.locator(".menu-toggle").getAttribute("aria-expanded"), "false");
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
        if (evidenceDirectory)
          await page.screenshot({
            path: join(evidenceDirectory, `profile-${width}-${colorScheme}.png`),
            fullPage: true,
          });
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "32px";
        });
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
          "Enlarged text must not overflow horizontally",
        );
        assert.deepEqual(errors, []);
        await page.goto(`${origin}/profile-flow/`);
        const flow = await page.locator(".profile-body").evaluate((element) => {
          const portrait = element.querySelector(".profile-portrait");
          return {
            display: getComputedStyle(element).display,
            float: getComputedStyle(portrait).float,
            width: portrait.getBoundingClientRect().width,
            container: element.getBoundingClientRect().width,
          };
        });
        assert.equal(flow.display, "flow-root");
        assert.equal(flow.float, "left");
        assert.ok(Math.abs(flow.width - (width <= 380 ? flow.container * 0.4 : 192)) < 1);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
        await page.locator(".profile-home").evaluate((element) => {
          element.style.width = "180px";
          element.style.fontSize = "200%";
        });
        const narrow = await page.locator(".profile-body").evaluate((element) => {
          const portrait = element.querySelector(".profile-portrait");
          const box = element.getBoundingClientRect();
          const image = portrait.getBoundingClientRect();
          return {
            width: box.width,
            portraitWidth: image.width,
            right: image.right,
            edge: box.right,
            overflow: element.scrollWidth > element.clientWidth,
          };
        });
        assert.ok(Math.abs(narrow.portraitWidth - narrow.width * 0.4) < 1);
        assert.ok(
          narrow.right <= narrow.edge && !narrow.overflow,
          "Flow portrait fits a narrow container at enlarged text",
        );
        for (const route of ["profile", "profile-flow"]) {
          await page.goto(`${origin}/${route}/`);
          const intrinsicWidth = await page.locator(".profile-home").evaluate((element) => {
            element.parentElement.style.display = "flex";
            return element.getBoundingClientRect().width;
          });
          assert.ok(intrinsicWidth > 150, `${route} retains intrinsic width as a flex child`);
        }
        checks.push({
          width,
          colorScheme,
          headings: true,
          portraitLayout: true,
          keyboard: true,
          anchors: true,
          enlargedText: true,
        });
        await context.close();
      }
    }
    const context = await browser.newContext({
      viewport: { width: 320, height: 900 },
      javaScriptEnabled: false,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    await page.goto(`${origin}/profile/`);
    assert.equal(
      await page.getByRole("heading", { level: 1, name: "Example author" }).isVisible(),
      true,
    );
    assert.equal(await page.getByRole("link", { name: "Example recorded talk" }).isVisible(), true);
    assert.equal(await page.getByRole("link", { name: "Example profile" }).isVisible(), true);
    await page.goto(`${origin}/profile-minimal/`);
    assert.equal(
      await page.getByRole("heading", { level: 1, name: "Example & author" }).count(),
      1,
    );
    assert.equal(await page.getByRole("heading", { level: 2 }).count(), 0);
    assert.equal(await page.locator(".profile-portrait").count(), 0);
    await context.close();
    const receipt = {
      browserVersion: browser.version(),
      browserExecutable: executablePath ?? "playwright-pinned",
      node: process.version,
      directory: resolve(directory),
      checks,
      noJavaScript: true,
      optionalSections: true,
    };
    if (evidenceDirectory)
      await writeFile(
        join(evidenceDirectory, "profile-browser-receipt.json"),
        JSON.stringify(receipt, null, 2) + "\n",
      );
    console.log("Profile landing browser qualification", JSON.stringify(receipt));
    return receipt;
  } finally {
    try {
      await browser?.close();
    } finally {
      await new Promise((done) => server.close(done));
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyProfileBrowser(
    resolve(process.argv[2] ?? "consumers/neutral"),
    resolve(".qualification/profile"),
  );
}

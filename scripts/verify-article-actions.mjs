import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, writeFile, symlink, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
// Exercise exact installed archive bytes when qualifying a packed consumer.
const componentPackage = process.env.ASTROMACHE_GEOMETRY_PACKAGE_ROOT
  ? resolve(process.env.ASTROMACHE_GEOMETRY_PACKAGE_ROOT)
  : join(root, "packages/astromache");
const require = createRequire(import.meta.url);
// Windows hosted tmpdir can use a DOS alias. Astro/Vite CSS identities must
// use the same canonical path as the files resolved during compilation.
const fixture = await realpath(await mkdtemp(join(tmpdir(), "astromache-action-geometry-")));
const evidence = process.env.ASTROMACHE_GEOMETRY_EVIDENCE
  ? resolve(process.env.ASTROMACHE_GEOMETRY_EVIDENCE)
  : undefined;
let browser, server;
try {
  await mkdir(join(fixture, "src/pages"), { recursive: true });
  await symlink(
    join(root, "node_modules"),
    join(fixture, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await writeFile(join(fixture, "package.json"), JSON.stringify({ type: "module" }));
  await cp(join(componentPackage, "src"), join(fixture, "src/components"), {
    recursive: true,
  });
  await writeFile(
    join(fixture, "src/pages/index.astro"),
    `---
import Article from '../components/Article.astro';
import CopyLink from '../components/CopyLink.astro';
import '../components/publication.css';
---
<html lang="en"><head><meta name="viewport" content="width=device-width"/><title>Neutral action geometry</title></head><body><main>
<Article title="Neutral article" published={{datetime:'2026-01-01',label:'January'}}>
  <p style="min-height:1200px">Neutral article content.</p>
  <Fragment slot="actions"><div><button type="button" data-fixture-share aria-label="Share this article">Share</button><div hidden>Neutral share options.</div><span class="sr-only" role="status"></span></div><CopyLink url="https://example.com/"/></Fragment>
</Article>
</main></body></html>`,
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
        { ".js": "text/javascript", ".css": "text/css", ".html": "text/html" }[extname(file)] ??
          "application/octet-stream",
      );
      response.end(await readFile(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch();
  if (evidence) await mkdir(evidence, { recursive: true });
  const results = [];
  for (const [label, width, height] of [
    ["desktop", 1440, 1000],
    ["mobile", 390, 844],
    ["wrapped", 280, 844],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    const result = { label, viewport: { width, height }, pass: false };
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.evaluate(() => document.fonts.ready);
      await page.locator(".article-actions").scrollIntoViewIfNeeded();
      const share = page.getByRole("button", { name: "Share this article", exact: true });
      const top = page.getByRole("button", { name: "Back to Top", exact: true });
      const copy = page.getByRole("button", { name: "Copy link", exact: true });
      result.share = await share.boundingBox();
      result.top = await top.boundingBox();
      result.copy = await copy.boundingBox();
      result.alignItems = await page
        .locator(".article-actions")
        .evaluate((element) => getComputedStyle(element).alignItems);
      if (evidence) await page.screenshot({ path: join(evidence, `${label}.png`) });
      assert.ok(result.share && result.top && result.copy, "Every action must remain visible");
      assert.ok(
        Math.abs(result.share.height - result.top.height) <= 1,
        "Share and Back to Top border-box heights must match",
      );
      if (label === "wrapped")
        assert.ok(
          result.top.y > result.share.y + result.share.height,
          "Narrow actions must retain wrapping",
        );
      else
        assert.ok(
          Math.abs(
            result.share.y + result.share.height / 2 - result.top.y - result.top.height / 2,
          ) <= 1,
          "Share and Back to Top centers must align",
        );
      for (const box of [result.share, result.top, result.copy])
        assert.ok(box.x >= 0 && box.x + box.width <= width, "Actions must fit the viewport");
      await share.focus();
      assert.equal(await share.evaluate((element) => element === document.activeElement), true);
      await copy.focus();
      assert.equal(await copy.evaluate((element) => element === document.activeElement), true);
      assert.ok(
        await page.evaluate(() => window.scrollY > 100),
        "Back-to-top must start scrolled down",
      );
      await top.focus();
      assert.equal(await top.evaluate((element) => element === document.activeElement), true);
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => window.scrollY < 2);
      result.pass = true;
    } catch (error) {
      result.error = error.message;
    } finally {
      await page.close();
      results.push(result);
    }
  }
  console.log(JSON.stringify(results, null, 2));
  if (evidence)
    await writeFile(join(evidence, "measurements.json"), JSON.stringify(results, null, 2) + "\n");
  assert.ok(
    results.every((result) => result.pass),
    "Article action geometry and keyboard regressions failed",
  );
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(fixture, { recursive: true, force: true });
}

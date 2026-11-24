import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { chromium, expect } from "@playwright/test";

export async function verifySearchBrowser(directory) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      const path = url.pathname;
      const file = join(directory, "dist", path.endsWith("/") ? path + "index.html" : path);
      const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
      response.setHeader("content-type", type[extname(file)] ?? "application/octet-stream");
      response.end(await readFile(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin + "/search-integration/?q=initial");
    const main = page.locator('[data-search-surface="page"]');
    const recovery = page.locator('[data-search-surface="recovery"]');
    const input = main.getByRole("searchbox");
    await expect(main.getByRole("link", { name: "initial result" })).toBeVisible();
    await page.getByRole("button", { name: "Search example content" }).click();
    await expect(page.locator("#search-mount")).toHaveText("Palette opened");
    await input.fill("slow");
    await input.press("Enter");
    await input.fill("fast");
    await expect(main.getByRole("link", { name: "fast result" })).toBeVisible();
    await page.waitForTimeout(450);
    await expect(main.getByRole("link", { name: "fast result" })).toBeVisible();
    await expect(page.getByText("Unsafe result")).toHaveCount(0);
    await input.fill("retry");
    await expect(main.getByRole("button", { name: "Retry search" })).toBeVisible();
    await main.getByRole("button", { name: "Retry search" }).click();
    await expect(main.getByRole("link", { name: "retry result" })).toBeVisible();
    const recoveryInput = recovery.getByRole("searchbox");
    await recoveryInput.fill("note");
    await expect(recovery.getByRole("link", { name: /note result/ })).toHaveAttribute(
      "href",
      "/profile/",
    );
    await recoveryInput.press("Escape");
    await expect(recovery.getByRole("link", { name: /note result/ })).toHaveCount(0);
    await recoveryInput.fill("note");
    await expect(recovery.getByRole("link", { name: /note result/ })).toBeVisible();
    await recoveryInput.press("Enter");
    await expect(page).toHaveURL(origin + "/profile/");
    assert.deepEqual(errors, []);
    console.log("Packed search surfaces passed: trigger, query ownership, stale results, retry and recovery navigation");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

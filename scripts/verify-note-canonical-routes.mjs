import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { preview } from "astro";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const temp = await mkdtemp(join(tmpdir(), "note-canonical-"));
const manager = join(root, "node_modules/pnpm/bin/pnpm.cjs");
const cases = ["decomposed-cafe\u0301", "café&tea?#", "ordinary-note"];
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const product of ["starters/publication", "recipes/search-offline"]) {
    const fixture = join(temp, product);
    await mkdir(dirname(fixture), { recursive: true });
    await cp(join(root, product), fixture, { recursive: true });
    for (const [index, slug] of cases.entries()) {
      await writeFile(
        join(fixture, `src/content/notes/canonical-${index}.md`),
        `---\ntitle: ${JSON.stringify(`Canonical fixture ${index}`)}\nslug: ${JSON.stringify(slug)}\ndescription: Test note\npublished: 2026-10-20\ncategory: Practice\ntags: [Practice]\n---\n\nFixture.\n`,
      );
    }
    const env = {
      ...process.env,
      ASTRO_TELEMETRY_DISABLED: "1",
      XDG_CONFIG_HOME: join(temp, "config"),
    };
    for (const args of [
      ["install", "--frozen-lockfile", "--ignore-scripts", "--store-dir", join(temp, "store")],
      ["build"],
    ])
      execFileSync(process.execPath, [manager, "--dir", fixture, ...args], {
        env,
        stdio: "inherit",
      });
    const server = await preview({
      root: fixture,
      logLevel: "silent",
      server: { host: "127.0.0.1", port: 0 },
    });
    try {
      for (const [index, slug] of cases.entries()) {
        const artifact = slug.normalize().replace(/\?/g, "%3F").replace(/#/g, "%23");
        const served = `http://127.0.0.1:${server.port}/notes/${encodeURIComponent(artifact)}/`;
        const response = await page.request.get(served);
        assert.equal(response.status(), 200, `${product}: fixture route ${slug}`);
        const html = await response.text();
        const links = await page.evaluate((html) => {
          const doc = new DOMParser().parseFromString(html, "text/html");
          return {
            title: doc.querySelector("h1")?.textContent,
            canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute("href"),
            copy: doc.querySelector(".copy-link-btn")?.getAttribute("data-url"),
          };
        }, html);
        assert.equal(links.title, `Canonical fixture ${index}`);
        assert.equal(links.canonical, links.copy, `${product}: canonical and copy URL must match`);
        for (const [kind, link] of [
          ["canonical", links.canonical],
          ["copy", links.copy],
        ]) {
          assert.ok(link, `${product}: missing ${kind}`);
          const url = new URL(link);
          assert.equal(url.search, "", `${product}: ${kind} query`);
          assert.equal(url.hash, "", `${product}: ${kind} fragment`);
          const target = await page.request.get(`http://127.0.0.1:${server.port}${url.pathname}`);
          assert.equal(target.status(), 200, `${product}: ${kind} must reach ${slug}: ${link}`);
          const body = await target.text();
          assert.match(body, new RegExp(`Canonical fixture ${index}`));
        }
      }
    } finally {
      await server.stop();
    }
  }
} finally {
  await browser.close();
}
console.log(
  "Both full products serve the canonical and copy-link URLs for normalized and reserved-character note IDs.",
);

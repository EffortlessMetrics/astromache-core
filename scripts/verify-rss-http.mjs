import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preview } from "astro";
import { chromium } from "@playwright/test";

const root = process.cwd();
const dir = await mkdtemp(join(tmpdir(), "rss-http-"));
const manager = join(root, "node_modules/pnpm/bin/pnpm.cjs");
const browser = await chromium.launch();
let failures = 0;
try {
  for (const product of ["publication", "search-offline"]) {
    const target = join(dir, product);
    execFileSync(process.execPath, [join(root, "scripts/create-starter.mjs"), product, target], {
      stdio: "inherit",
    });
    for (const [index, slug] of [
      "ordinary-note",
      "café&tea?#",
      "decomposed-cafe\u0301",
    ].entries()) {
      await writeFile(
        join(target, `src/content/notes/http-${index}.md`),
        `---\ntitle: HTTP fixture ${index}\nslug: ${JSON.stringify(slug)}\ndescription: HTTP fixture\npublished: 2026-10-20\ncategory: HTTP\ntags: []\n---\n\nFixture.\n`,
      );
    }
    execFileSync(process.execPath, [manager, "install", "--frozen-lockfile", "--ignore-scripts"], {
      cwd: target,
      stdio: "inherit",
    });
    execFileSync(process.execPath, [manager, "build"], { cwd: target, stdio: "inherit" });
    const server = await preview({ root: target, server: { host: "127.0.0.1", port: 0 } });
    try {
      const base = `http://127.0.0.1:${server.port}`;
      const xml = await (await fetch(base + "/rss.xml")).text();
      const page = await browser.newPage();
      const items = await page.evaluate(
        (xml) =>
          [...new DOMParser().parseFromString(xml, "application/xml").querySelectorAll("item")].map(
            (item) => ({
              title: item.querySelector("title")?.textContent,
              link: item.querySelector("link")?.textContent,
              guid: item.querySelector("guid")?.textContent,
            }),
          ),
        xml,
      );
      await page.close();
      for (let i = 0; i < 3; i++) {
        const item = items.find((x) => x.title === `HTTP fixture ${i}`);
        assert.ok(item);
        assert.equal(item.link, item.guid, "RSS link and GUID must identify the same note");
        for (const field of ["link", "guid"]) {
          const url = new URL(item[field]);
          const response = await fetch(base + url.pathname + url.search);
          const body = await response.text();
          const pass =
            !url.search &&
            !url.hash &&
            response.status === 200 &&
            body.includes(`HTTP fixture ${i}`);
          console.log(
            JSON.stringify({
              product,
              fixture: i,
              field,
              url: item[field],
              status: response.status,
              pass,
            }),
          );
          if (!pass) failures++;
        }
      }
    } finally {
      await server.stop();
    }
  }
  assert.equal(failures, 0, "RSS destinations must reach their generated note");
} finally {
  await browser.close();
  await rm(dir, { recursive: true, force: true });
}

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { preview } from "astro";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const temp = await mkdtemp(join(tmpdir(), "note-canonical-"));
const manager = join(root, "node_modules/pnpm/bin/pnpm.cjs");
// These are literal expected public paths, not a copy of the route encoder.
const cases = [
  { slug: "decomposed-cafe\u0301", path: "/notes/decomposed-caf%C3%A9/" },
  { slug: "café&tea?#", path: "/notes/caf%C3%A9%26tea%253F%2523/" },
  { slug: "ordinary-note", path: "/notes/ordinary-note/" },
  { filename: "nested/filename-note.md", path: "/notes/nested/filename-note/" },
  {
    slug: "série/nested/cafe\u0301&tea?#",
    path: "/notes/s%C3%A9rie/nested/caf%C3%A9%26tea%253F%2523/",
  },
];
const failures = [];
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  for (const product of ["starters/publication", "recipes/search-offline"]) {
    const fixture = join(temp, product);
    await mkdir(dirname(fixture), { recursive: true });
    await cp(join(root, product), fixture, { recursive: true });
    for (const [index, { slug, filename }] of cases.entries()) {
      const file = join(fixture, "src/content/notes", filename ?? `canonical-${index}.md`);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(
        file,
        `---\ntitle: ${JSON.stringify(`Canonical fixture ${index}`)}\n${slug === undefined ? "" : `slug: ${JSON.stringify(slug)}\n`}description: Test note\npublished: 2026-10-${10 + index}\ncategory: Practice\ntags: [Practice]\n---\n\nFixture.\n`,
      );
    }
    const env = {
      ...process.env,
      ASTRO_TELEMETRY_DISABLED: "1",
      XDG_CONFIG_HOME: join(temp, "config"),
    };
    for (const args of [
      [
        "install",
        "--frozen-lockfile",
        "--ignore-scripts",
        "--store-dir",
        process.env.ASTROMACHE_QUALIFICATION_STORE ?? join(temp, "store"),
      ],
      ["build"],
    ])
      execFileSync(process.execPath, [manager, "--dir", fixture, ...args], {
        env,
        stdio: "inherit",
        timeout: 300_000,
      });
    const server = await preview({
      root: fixture,
      logLevel: "silent",
      server: { host: "127.0.0.1", port: 0 },
    });
    try {
      const local = `http://127.0.0.1:${server.port}`;
      const navigationTargets = new Set();
      const navigationDirections = new Set();
      const verifyNavigation = async (kind, link, index) => {
        const title = `Canonical fixture ${index}`;
        try {
          assert.ok(link, `${product}: missing ${kind} to ${title}`);
          const target = await page.request.get(`${local}${link}`);
          assert.equal(target.status(), 200, `${product}: ${kind} must serve ${title}: ${link}`);
          assert.equal(link, cases[index].path, `${product}: ${kind} path for ${title}`);
          assert.equal(
            await page.evaluate(
              (html) =>
                new DOMParser().parseFromString(html, "text/html").querySelector("h1")?.textContent,
              await target.text(),
            ),
            title,
            `${product}: ${kind} must reach the expected note`,
          );
        } catch (error) {
          failures.push(error.message);
        }
      };
      for (const listing of ["/", "/posts/", "/tags/practice/"]) {
        const response = await page.request.get(`${local}${listing}`);
        assert.equal(response.status(), 200, `${product}: listing ${listing}`);
        const cards = await page.evaluate(
          (html) => {
            const doc = new DOMParser().parseFromString(html, "text/html");
            return [...doc.querySelectorAll(".article-cards a")].map((link) => ({
              title: link.textContent,
              href: link.getAttribute("href"),
            }));
          },
          await response.text(),
        );
        for (const [index] of cases.entries()) {
          const matches = cards.filter((card) => card.title === `Canonical fixture ${index}`);
          assert.equal(matches.length, 1, `${product}: ${listing} must list each fixture once`);
          await verifyNavigation(`card on ${listing}`, matches[0].href, index);
        }
      }
      if (product.startsWith("recipes/")) {
        const response = await page.request.get(`${local}/search-index.json`);
        assert.equal(response.status(), 200, `${product}: search index`);
        const { data } = await response.json();
        for (const [index] of cases.entries()) {
          const matches = data.filter((item) => item.title === `Canonical fixture ${index}`);
          assert.equal(matches.length, 1, `${product}: search must list each fixture once`);
          await verifyNavigation("search result", matches[0].url, index);
        }
      }
      const discovery = {};
      for (const file of ["rss.xml", "sitemap.xml"]) {
        const response = await page.request.get(`${local}/${file}`);
        assert.equal(response.status(), 200, `${product}: ${file}`);
        discovery[file] = await page.evaluate(
          (xml) => {
            const doc = new DOMParser().parseFromString(xml, "application/xml");
            return {
              error: doc.querySelector("parsererror")?.textContent,
              items: [...doc.querySelectorAll("item")].map((item) => ({
                title: item.querySelector("title")?.textContent,
                link: item.querySelector("link")?.textContent,
                guid: item.querySelector("guid")?.textContent,
              })),
              locations: [...doc.querySelectorAll("url > loc")].map((loc) => loc.textContent),
            };
          },
          await response.text(),
        );
        assert.equal(discovery[file].error, undefined, `${product}: ${file} must parse`);
      }
      for (const [index, { slug, filename, path }] of cases.entries()) {
        const label = slug ?? filename;
        const response = await page.request.get(`${local}${path}`);
        assert.equal(response.status(), 200, `${product}: fixture route ${label}`);
        const html = await response.text();
        const links = await page.evaluate((html) => {
          const doc = new DOMParser().parseFromString(html, "text/html");
          return {
            title: doc.querySelector("h1")?.textContent,
            canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute("href"),
            copy: doc.querySelector(".copy-link-btn")?.getAttribute("data-url"),
            adjacent: [...doc.querySelectorAll(".adjacent-posts a")].map((link) => ({
              label: link.getAttribute("aria-label") ?? link.textContent,
              href: link.getAttribute("href"),
            })),
          };
        }, html);
        assert.equal(links.title, `Canonical fixture ${index}`);
        for (const adjacent of links.adjacent) {
          const match = adjacent.label.match(/(Previous|Next) Post: Canonical fixture (\d+)/);
          if (!match) continue;
          const target = Number(match[2]);
          navigationTargets.add(target);
          navigationDirections.add(match[1]);
          await verifyNavigation(`${match[1]} link from fixture ${index}`, adjacent.href, target);
        }
        assert.equal(links.canonical, links.copy, `${product}: canonical and copy URL must match`);
        const expected = `https://publication.example${path}`;
        const items = discovery["rss.xml"].items.filter((item) => item.title === links.title);
        assert.equal(items.length, 1, `${product}: fixture must have exactly one RSS item`);
        const locations = discovery["sitemap.xml"].locations;
        const sitemap = locations.find((location) => location === expected);
        assert.equal(
          new Set(locations).size,
          locations.length,
          `${product}: duplicate sitemap URL`,
        );
        for (const [kind, link] of [
          ["canonical", links.canonical],
          ["copy", links.copy],
          ["RSS link", items[0].link],
          ["RSS GUID", items[0].guid],
          ["sitemap", sitemap],
        ]) {
          try {
            assert.equal(link, expected, `${product}: ${kind} path for ${label}`);
            const url = new URL(link);
            assert.equal(url.search, "", `${product}: ${kind} query`);
            assert.equal(url.hash, "", `${product}: ${kind} fragment`);
            const target = await page.request.get(`${local}${url.pathname}`);
            assert.equal(target.status(), 200, `${product}: ${kind} must reach ${label}: ${link}`);
            const body = await target.text();
            assert.equal(
              await page.evaluate(
                (html) =>
                  new DOMParser().parseFromString(html, "text/html").querySelector("h1")
                    ?.textContent,
                body,
              ),
              `Canonical fixture ${index}`,
              `${product}: ${kind} must reach the expected note`,
            );
          } catch (error) {
            failures.push(error.message);
          }
        }
      }
      assert.equal(
        navigationTargets.size,
        cases.length,
        `${product}: adjacent links must cover every fixture`,
      );
      assert.deepEqual(
        navigationDirections,
        new Set(["Previous", "Next"]),
        `${product}: both adjacent directions must be checked`,
      );
    } finally {
      await server.stop();
    }
  }
} finally {
  try {
    await browser?.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
assert.equal(failures.length, 0, failures.join("\n"));
console.log(
  "Both full products serve card, adjacent, search, canonical, copy-link, RSS link/GUID and sitemap URLs for normalized, reserved-character and nested note IDs, including native filename-derived IDs.",
);

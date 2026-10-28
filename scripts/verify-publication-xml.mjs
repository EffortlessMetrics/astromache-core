import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = process.env.ASTROMACHE_XML_SOURCE_ROOT
  ? resolve(process.env.ASTROMACHE_XML_SOURCE_ROOT)
  : root;
const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve("astro/package.json")), "bin/astro.mjs");
const temporary = await realpath(await mkdtemp(join(tmpdir(), "astromache-publication-xml-")));
const title = `Café <🛰️> & "quoted" 'notes'`;
const description = `Observations <today> & "tomorrow" 'again'`;
const origin = "https://publication.example";
const cases = [
  {
    slug: "café-🛰️",
    title: title + "\twith tab\nand line feed",
    description,
    category: "Category Alone",
    tags: ["Distinct Tag"],
    taxonomy: ["category-alone", "distinct-tag"],
  },
  {
    slug: "café&tea?#",
    title,
    description,
    category: "Practice",
    tags: ["Practice"],
    taxonomy: ["practice"],
  },
  {
    slug: "café&notes",
    title,
    description,
    category: "Category Without Tags",
    tags: [],
    taxonomy: ["category-without-tags"],
  },
  {
    slug: "café&amp;notes",
    title: title + " Literal &#1; and &#x1;",
    description: description + " Literal &#1; and &#x1;",
    category: "Practice",
    tags: ["Practice", "Practice"],
    taxonomy: ["practice"],
  },
  {
    slug: "whitespace",
    title: "Café\tA\nB\rC\r\nD 🛰️",
    description: "Description\tA\nB\rC\r\nD",
    category: "Practice",
    tags: ["Practice"],
    taxonomy: ["practice"],
  },
  {
    slug: "invalid-title",
    title: "Before\u0001after",
    description,
    category: "Practice",
    tags: ["Practice"],
    invalid: "RSS title",
  },
  {
    slug: "invalid-description",
    title,
    description: "Before\u0001after",
    category: "Practice",
    tags: ["Practice"],
    invalid: "RSS description",
  },
];
const results = [];
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  for (const adapter of ["starters/publication", "recipes/search-offline"]) {
    const fixture = join(temporary, adapter);
    await mkdir(join(fixture, "src/pages/notes"), { recursive: true });
    await mkdir(join(fixture, "src/pages/tags"), { recursive: true });
    await mkdir(join(fixture, "src/content/notes"), { recursive: true });
    await symlink(
      join(root, "node_modules"),
      join(fixture, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await writeFile(join(fixture, "package.json"), JSON.stringify({ type: "module" }));
    await writeFile(
      join(fixture, "astro.config.mjs"),
      `export default {site:${JSON.stringify(origin)},output:'static',trailingSlash:'always',cacheDir:'./.astro-cache',vite:{cacheDir:'./.vite-cache'}};`,
    );
    for (const file of [
      "content.config.ts",
      "publication-content.ts",
      "pages/rss.xml.ts",
      "pages/sitemap.xml.ts",
    ])
      await cp(join(source, adapter, "src", file), join(fixture, "src", file));
    // Older source candidates predate the shared XML serializer.
    if (existsSync(join(source, adapter, "src/xml.ts")))
      await cp(join(source, adapter, "src/xml.ts"), join(fixture, "src/xml.ts"));
    await writeFile(
      join(fixture, "src/pages/tags/[tag].astro"),
      `---
import {notes,taxonomyRoutes} from '../../publication-content';
export async function getStaticPaths(){return taxonomyRoutes(await notes());}
const {label}=Astro.props;
---
<html><head><meta charset="utf-8"/></head><body><h1>{label}</h1></body></html>`,
    );
    await writeFile(
      join(fixture, "src/pages/notes/[slug].astro"),
      `---
import {notes} from '../../publication-content';
export async function getStaticPaths(){return(await notes()).map(note=>({params:{slug:note.id},props:{note}}));}
const {note}=Astro.props;
---
<html><head><meta charset="utf-8"/></head><body><h1>{note.data.title}</h1></body></html>`,
    );
    for (const { slug, title, description, category, tags, taxonomy, invalid } of cases) {
      await writeFile(
        join(fixture, "src/content/notes/fixture.md"),
        `---\ntitle: ${JSON.stringify(title)}\nslug: ${JSON.stringify(slug)}\ndescription: ${JSON.stringify(description)}\npublished: 2026-10-20\ncategory: ${JSON.stringify(category)}\ntags: ${JSON.stringify(tags)}\n---\n\nNeutral content.\n`,
      );
      const build = spawnSync(process.execPath, [cli, "build"], { cwd: fixture, encoding: "utf8" });
      if (invalid) {
        const result = { adapter, slug, file: "rss.xml", pass: false };
        try {
          assert.notEqual(build.status, 0, "XML-invalid metadata must reject the build");
          assert.match(build.stdout + build.stderr, /XML 1\.0.*U\+0001/);
          assert.ok((build.stdout + build.stderr).includes(invalid));
          result.pass = true;
        } catch (error) {
          result.error = error.message;
          if (build.status === 0) {
            const xml = await readFile(join(fixture, "dist/rss.xml"), "utf8");
            result.parserError = await page.evaluate(
              (xml) =>
                new DOMParser().parseFromString(xml, "application/xml").querySelector("parsererror")
                  ?.textContent,
              xml,
            );
          }
        }
        results.push(result);
        continue;
      }
      assert.equal(build.status, 0, build.stdout + build.stderr);
      for (const tag of taxonomy)
        assert.ok(await readFile(join(fixture, "dist/tags", tag, "index.html"), "utf8"));
      assert.ok(
        await readFile(
          join(
            fixture,
            "dist/notes",
            slug.replace(/\?/g, "%3F").replace(/#/g, "%23"),
            "index.html",
          ),
          "utf8",
        ),
      );
      for (const file of ["rss.xml", "sitemap.xml"]) {
        const result = { adapter, slug, file, pass: false };
        try {
          const xml = await readFile(join(fixture, "dist", file), "utf8");
          const parsed = await page.evaluate((xml) => {
            const document = new DOMParser().parseFromString(xml, "application/xml");
            return {
              error: document.querySelector("parsererror")?.textContent,
              links: [...document.querySelectorAll("item > link, item > guid, url > loc")].map(
                (element) => element.textContent,
              ),
              title: document.querySelector("item > title")?.textContent,
              description: document.querySelector("item > description")?.textContent,
            };
          }, xml);
          assert.equal(parsed.error, undefined, "Generated XML must parse without errors");
          const url = origin + "/notes/" + slug + "/";
          if (file === "rss.xml") {
            assert.deepEqual(parsed.links, [url, url], "RSS must preserve link and GUID identity");
            assert.equal(parsed.title, title);
            assert.equal(parsed.description, description);
          } else {
            assert.ok(
              parsed.links.includes(origin + "/notes/" + encodeURIComponent(slug) + "/"),
              "Sitemap must encode the note ID as URL path data",
            );
            assert.deepEqual(
              parsed.links.filter((link) => link.startsWith(origin + "/tags/")).sort(),
              taxonomy.map((tag) => origin + "/tags/" + tag + "/").sort(),
              "Sitemap must list every generated category/tag route exactly once",
            );
          }
          result.pass = true;
        } catch (error) {
          result.error = error.message;
        }
        results.push(result);
      }
    }
  }
  assert.equal(
    await page.evaluate(
      () =>
        new DOMParser()
          .parseFromString("<title>&#1;</title>", "application/xml")
          .querySelector("parsererror") !== null,
    ),
    true,
    "An illegal XML character cannot be repaired with a numeric reference",
  );
  console.log(JSON.stringify(results, null, 2));
  assert.ok(
    results.every((result) => result.pass),
    "Publication XML regressions failed",
  );
} finally {
  await browser?.close();
  await rm(temporary, { recursive: true, force: true });
}

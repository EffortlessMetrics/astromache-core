import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
const results = [];
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  for (const adapter of ["starters/publication", "recipes/search-offline"]) {
    const fixture = join(temporary, adapter);
    await mkdir(join(fixture, "src/pages/notes"), { recursive: true });
    await mkdir(join(fixture, "src/content/notes"), { recursive: true });
    await symlink(
      join(root, "node_modules"),
      join(fixture, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await writeFile(join(fixture, "package.json"), JSON.stringify({ type: "module" }));
    await writeFile(
      join(fixture, "astro.config.mjs"),
      `export default {site:${JSON.stringify(origin)},output:'static',trailingSlash:'always'};`,
    );
    for (const file of [
      "content.config.ts",
      "publication-content.ts",
      "pages/rss.xml.ts",
      "pages/sitemap.xml.ts",
    ])
      await cp(join(source, adapter, "src", file), join(fixture, "src", file));
    await writeFile(
      join(fixture, "src/pages/notes/[slug].astro"),
      `---
import {notes} from '../../publication-content';
export async function getStaticPaths(){return(await notes()).map(note=>({params:{slug:note.id},props:{note}}));}
const {note}=Astro.props;
---
<html><head><meta charset="utf-8"/></head><body><h1>{note.data.title}</h1></body></html>`,
    );
    for (const slug of ["café-🛰️", "café&notes", "café&amp;notes"]) {
      await writeFile(
        join(fixture, "src/content/notes/fixture.md"),
        `---\ntitle: ${JSON.stringify(title)}\nslug: ${JSON.stringify(slug)}\ndescription: ${JSON.stringify(description)}\npublished: 2026-10-20\ncategory: Practice\ntags: [Practice]\n---\n\nNeutral content.\n`,
      );
      execFileSync(process.execPath, [cli, "build"], { cwd: fixture, stdio: "pipe" });
      assert.ok(await readFile(join(fixture, "dist/notes", slug, "index.html"), "utf8"));
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
          } else assert.ok(parsed.links.includes(url), "Sitemap must preserve URL identity");
          result.pass = true;
        } catch (error) {
          result.error = error.message;
        }
        results.push(result);
      }
    }
  }
  console.log(JSON.stringify(results, null, 2));
  assert.ok(
    results.every((result) => result.pass),
    "Publication XML regressions failed",
  );
} finally {
  await browser?.close();
  await rm(temporary, { recursive: true, force: true });
}

import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve("astro/package.json")), "bin/astro.mjs");
const temporary = await mkdtemp(join(tmpdir(), "astromache-taxonomy-"));
const content = (category, tags) =>
  `---\ntitle: Taxonomy regression\ndescription: Neutral taxonomy fixture.\npublished: 2026-10-09\ncategory: ${JSON.stringify(category)}\ntags: ${JSON.stringify(tags)}\n---\n\nNeutral fixture.\n`;
try {
  for (const adapter of ["starters/publication", "recipes/search-offline"]) {
    const fixture = join(temporary, adapter);
    await mkdir(join(fixture, "src/pages/tags"), { recursive: true });
    await mkdir(join(fixture, "src/pages/notes"), { recursive: true });
    await mkdir(join(fixture, "src/layouts"), { recursive: true });
    await mkdir(join(fixture, "src/content/notes"), { recursive: true });
    await symlink(
      join(root, "node_modules"),
      join(fixture, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await writeFile(join(fixture, "package.json"), JSON.stringify({ type: "module" }));
    await writeFile(
      join(fixture, "astro.config.mjs"),
      "export default {output:'static',trailingSlash:'always'};",
    );
    await cp(join(root, adapter, "src/content.config.ts"), join(fixture, "src/content.config.ts"));
    await cp(
      join(root, adapter, "src/publication-content.ts"),
      join(fixture, "src/publication-content.ts"),
    );
    await cp(join(root, "packages/astromache/src"), join(fixture, "src/components"), {
      recursive: true,
    });
    const route = await readFile(join(root, adapter, "src/pages/tags/[tag].astro"), "utf8");
    await writeFile(
      join(fixture, "src/pages/tags/[tag].astro"),
      route.replace(/(['"])astromache\/post-list\1/, "'../../components/PostList.astro'"),
    );
    await writeFile(
      join(fixture, "src/layouts/Publication.astro"),
      "---\nconst {title}=Astro.props;\n---\n<html><head><title>{title}</title></head><body><slot/></body></html>",
    );
    await writeFile(
      join(fixture, "src/pages/index.astro"),
      "---\nimport {notes,tagSlug} from '../publication-content';const entries=await notes();\n---\n<html><body>{entries.map(note=><a href={'/tags/'+tagSlug(note.data.category)+'/'}>{note.data.category}</a>)}</body></html>",
    );
    await writeFile(
      join(fixture, "src/pages/notes/[slug].astro"),
      "---\nimport {notes,tagSlug} from '../../publication-content';export async function getStaticPaths(){return (await notes()).map(note=>({params:{slug:note.id},props:{note}}));}const {note}=Astro.props;\n---\n<html><body><a href={'/tags/'+tagSlug(note.data.category)+'/'}>{note.data.category}</a></body></html>",
    );
    const note = join(fixture, "src/content/notes/taxonomy-regression.md");
    const build = () =>
      spawnSync(process.execPath, [cli, "build"], { cwd: fixture, encoding: "utf8" });
    await writeFile(note, content("Category Alone", ["Distinct Tag"]));
    let result = build();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const page of ["index.html", "notes/taxonomy-regression/index.html"]) {
      assert.ok(
        (await readFile(join(fixture, "dist", page), "utf8")).includes("/tags/category-alone/"),
        `${adapter}: ${page} category link`,
      );
    }
    assert.ok(
      (await readFile(join(fixture, "dist/tags/category-alone/index.html"), "utf8")).includes(
        "Taxonomy regression",
      ),
    );
    assert.ok(
      (await readFile(join(fixture, "dist/tags/distinct-tag/index.html"), "utf8")).includes(
        "Taxonomy regression",
      ),
    );
    for (const [category, tags] of [
      ["C++", ["C#"]],
      ["Practice", ["practice"]],
      ["Café", ["Cafè"]],
      ["中文", []],
    ]) {
      await writeFile(note, content(category, tags));
      result = build();
      assert.notEqual(result.status, 0, `${adapter}: ambiguous/empty labels must reject build`);
      assert.match(
        result.stdout + result.stderr,
        /Taxonomy (slug collision|label has no URL slug)/,
      );
    }
    console.log(
      `PASS ${adapter}: category and tag destinations, home/article links, punctuation/case/Unicode collision and empty slug rejection`,
    );
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}

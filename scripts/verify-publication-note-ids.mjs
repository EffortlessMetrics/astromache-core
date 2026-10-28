import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const producer = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve("astro/package.json")), "bin/astro.mjs");
const temporary = await mkdtemp(join(tmpdir(), "astromache-note-ids-"));
const failures = [];
const content = (title, slug) =>
  "---\n" +
  Object.entries({
    title,
    description: `${title} description`,
    ...(slug === undefined ? {} : { slug }),
    published: "2026-01-01",
    category: "Identity",
    tags: ["Identity"],
  })
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n") +
  `\n---\n\n${title} body.\n`;

try {
  for (const adapter of ["starters/publication", "recipes/search-offline"]) {
    const recipe = adapter.startsWith("recipes/");
    const root = join(temporary, recipe ? "recipe" : "publication");
    const source = join(producer, adapter, "src");
    await mkdir(join(root, "src/pages/notes"), { recursive: true });
    await symlink(
      join(producer, "node_modules"),
      join(root, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await writeFile(join(root, "package.json"), JSON.stringify({ type: "module" }));
    await writeFile(
      join(root, "astro.config.mjs"),
      'export default {site:"https://publication.example",output:"static",trailingSlash:"always"};',
    );
    // Use each product's real collection, loader and content helpers. Copy adjacent
    // modules as well so endpoint helpers travel with their owning product.
    for (const file of await readdir(source, { withFileTypes: true })) {
      if (file.isFile()) await cp(join(source, file.name), join(root, "src", file.name));
    }
    await cp(join(source, "pages/rss.xml.ts"), join(root, "src/pages/rss.xml.ts"));
    if (recipe) {
      await cp(
        join(source, "pages/search-index.json.ts"),
        join(root, "src/pages/search-index.json.ts"),
      );
    }
    // The loader is the subject. A small native route independently observes its
    // entries without substituting product data or requiring component fixtures.
    await writeFile(
      join(root, "src/pages/notes/[slug].astro"),
      "---\n" +
        "import {notes} from '../../publication-content';\n" +
        "export async function getStaticPaths(){return (await notes()).map(note=>({params:{slug:note.id},props:{note}}));}\n" +
        "const {note}=Astro.props;\n---\n" +
        "<html><head><title>{note.data.title}</title></head><body>{note.body}</body></html>\n",
    );
    const noteDirectory = join(root, "src/content/notes");
    const writeNote = (name, title, slug) =>
      writeFile(join(noteDirectory, name), content(title, slug));
    const resetNotes = async () => {
      await rm(noteDirectory, { recursive: true, force: true });
      await rm(join(root, ".astro"), { recursive: true, force: true });
      await mkdir(noteDirectory, { recursive: true });
    };
    const build = () =>
      spawnSync(process.execPath, [cli, "build"], {
        cwd: root,
        encoding: "utf8",
        timeout: 90_000,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          ...process.env,
          ASTRO_TELEMETRY_DISABLED: "1",
          XDG_CONFIG_HOME: join(temporary, "config"),
        },
      });
    const accepted = (result) => {
      assert.equal(result.error, undefined, `Build execution failed: ${result.error}`);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    };
    const rejected = (result, id, files) => {
      assert.equal(result.error, undefined, `Build execution failed: ${result.error}`);
      assert.notEqual(result.status, 0, "Duplicate note IDs must fail content sync");
      const output = result.stdout + result.stderr;
      assert.match(output, /Duplicate note ID/);
      assert.ok(output.includes(id), `Diagnostic must identify ${id}: ${output}`);
      for (const file of files) {
        assert.ok(output.includes(file), `Diagnostic must identify ${file}: ${output}`);
      }
      assert.doesNotMatch(output, /generating static routes/);
    };
    const check = async (name, run) => {
      try {
        await resetNotes();
        await run();
        console.log(`PASS ${adapter}: ${name}`);
      } catch (error) {
        failures.push(`${adapter}: ${name}: ${error.message}`);
        console.error(`FAIL ${failures.at(-1)}`);
      }
    };

    await check("unique IDs retain both routes, RSS items and search documents", async () => {
      await writeNote("one.md", "First note", "one");
      await writeNote("two.md", "Second note", "two");
      accepted(build());
      const routes = (await readdir(join(root, "dist/notes"), { recursive: true })).filter((file) =>
        file.endsWith(".html"),
      );
      assert.equal(routes.length, 2);
      for (const [id, title] of [
        ["one", "First note"],
        ["two", "Second note"],
      ]) {
        const html = await readFile(join(root, "dist/notes", id, "index.html"), "utf8");
        assert.ok(html.includes(`<title>${title}</title>`));
        assert.ok(html.includes(`${title} body.`));
      }
      const rss = await readFile(join(root, "dist/rss.xml"), "utf8");
      assert.equal((rss.match(/<item>/g) ?? []).length, 2);
      assert.ok(rss.includes("<title>First note</title>"));
      assert.ok(rss.includes("<title>Second note</title>"));
      if (recipe) {
        const search = JSON.parse(await readFile(join(root, "dist/search-index.json"), "utf8"));
        assert.equal(search.data.length, 2);
        assert.deepEqual(
          new Set(search.data.map((note) => note.url)),
          new Set(["/notes/one/", "/notes/two/"]),
        );
        assert.deepEqual(
          new Set(search.data.map((note) => note.title)),
          new Set(["First note", "Second note"]),
        );
      }
    });
    await check("distinct notes sharing an explicit ID are rejected", async () => {
      await writeNote("one.md", "First note", "same");
      await writeNote("two.md", "Second note", "same");
      rejected(build(), "same", ["one.md", "two.md"]);
    });
    await check(
      "identical notes cannot bypass duplicate validation through digest reuse",
      async () => {
        await writeNote("one.md", "Identical note", "same");
        await writeNote("two.md", "Identical note", "same");
        rejected(build(), "same", ["one.md", "two.md"]);
      },
    );
    await check("native filename normalization cannot overwrite a note", async () => {
      await writeNote("Hello World.md", "First note");
      await writeNote("hello-world.md", "Second note");
      rejected(build(), "hello-world", ["Hello World.md", "hello-world.md"]);
    });
    await check("a duplicate added after a cached build is rejected", async () => {
      await writeNote("one.md", "Identical note", "same");
      await writeNote("control.md", "Control note", "control");
      accepted(build());
      await writeNote("two.md", "Identical note", "same");
      rejected(build(), "same", ["one.md", "two.md"]);
    });
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
assert.equal(failures.length, 0, failures.join("\n"));

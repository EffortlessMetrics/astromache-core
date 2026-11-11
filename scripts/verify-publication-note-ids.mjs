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
    await cp(join(source, "pages/sitemap.xml.ts"), join(root, "src/pages/sitemap.xml.ts"));
    if (recipe) {
      await cp(
        join(source, "pages/search-index.json.ts"),
        join(root, "src/pages/search-index.json.ts"),
      );
    }
    // The loader is the subject. A small native route independently observes its
    // entries without substituting product data or requiring component fixtures.
    await writeFile(
      join(root, "src/pages/notes/[...slug].astro"),
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
      await rm(join(root, "dist"), { recursive: true, force: true });
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
    await check("distinct escaped, Unicode and nested routes retain every note", async () => {
      const controls = [
        { id: "topic?", artifact: "topic%3F", path: "/notes/topic%253F/" },
        { id: "topic#", artifact: "topic%23", path: "/notes/topic%2523/" },
        { id: "other%3F", artifact: "other%3F", path: "/notes/other%253F/" },
        { id: "café", artifact: "café", path: "/notes/caf%C3%A9/" },
        { id: "cafe", artifact: "cafe", path: "/notes/cafe/" },
        { id: "nested/café", artifact: "nested/café", path: "/notes/nested/caf%C3%A9/" },
        { id: "UniqueCase", artifact: "UniqueCase", path: "/notes/UniqueCase/" },
      ];
      for (const [index, { id }] of controls.entries())
        await writeNote(`control-${index}.md`, `Distinct note ${index}`, id);
      accepted(build());
      const rss = await readFile(join(root, "dist/rss.xml"), "utf8");
      const sitemap = await readFile(join(root, "dist/sitemap.xml"), "utf8");
      const guids = [...rss.matchAll(/<guid>(.*?)<\/guid>/g)].map((match) => match[1]);
      assert.equal(guids.length, controls.length);
      assert.equal(new Set(guids).size, controls.length);
      for (const [index, { artifact, path }] of controls.entries()) {
        const html = await readFile(join(root, "dist/notes", artifact, "index.html"), "utf8");
        assert.ok(html.includes(`<title>Distinct note ${index}</title>`));
        const url = `https://publication.example${path}`;
        assert.ok(rss.includes(`<link>${url}</link><guid>${url}</guid>`));
        assert.ok(sitemap.includes(`<loc>${url}</loc>`));
      }
      if (recipe) {
        const search = JSON.parse(await readFile(join(root, "dist/search-index.json"), "utf8"));
        assert.deepEqual(
          new Set(search.data.map((note) => note.url)),
          new Set(controls.map((note) => note.path)),
        );
      }
    });
    for (const [name, ids, route] of [
      ["reserved query escape", ["topic?", "topic%3F"], "/notes/topic%253F/"],
      ["reserved fragment escape", ["topic#", "topic%23"], "/notes/topic%2523/"],
      ["NFC normalization", ["café", "cafe\u0301"], "/notes/caf%C3%A9/"],
      ["reserved escape case", ["topic?", "topic%3f"], "/notes/topic%253f/"],
      ["ASCII filename case", ["Alpha", "alpha"], "/notes/alpha/"],
      ["Unicode filename case", ["É", "é"], "/notes/%C3%A9/"],
      ["nested reserved escape", ["nested/topic?", "nested/topic%3F"], "/notes/nested/topic%253F/"],
    ]) {
      await check(`${name} route collision rejects before pages and feeds`, async () => {
        await writeNote("one.md", "First note", ids[0]);
        await writeNote("two.md", "Second note", ids[1]);
        const result = build();
        assert.equal(result.error, undefined, `Build execution failed: ${result.error}`);
        const output = result.stdout + result.stderr;
        assert.notEqual(
          result.status,
          0,
          `Derived-route collision must fail content sync: ${output}`,
        );
        assert.match(output, /Duplicate note route/);
        for (const value of [route, ...ids.map((id) => JSON.stringify(id)), "one.md", "two.md"])
          assert.ok(output.includes(value), `Diagnostic must identify ${value}: ${output}`);
        assert.doesNotMatch(output, /generating static routes/);
        for (const file of ["rss.xml", "sitemap.xml"])
          await assert.rejects(readFile(join(root, "dist", file)), { code: "ENOENT" });
      });
    }
    for (const [id, sibling, diagnostic] of [
      ["branch/../leaf", "leaf", /Invalid note ID/],
      ["branch//leaf", "branch/leaf", /Invalid note ID/],
      ["trailing/", "trailing", /Invalid note ID/],
      ["topic%253F", "topic?", /Unsupported note ID/],
      ["bad%escape", "control", /Unsupported note ID/],
    ]) {
      await check(`ambiguous ID ${JSON.stringify(id)} rejects before output`, async () => {
        await writeNote("one.md", "First note", id);
        await writeNote("two.md", "Second note", sibling);
        const result = build();
        assert.equal(result.error, undefined);
        assert.notEqual(result.status, 0, result.stdout + result.stderr);
        const output = result.stdout + result.stderr;
        assert.match(output, diagnostic);
        assert.ok(output.includes(JSON.stringify(id)));
        assert.ok(output.includes("one.md"));
        assert.doesNotMatch(output, /generating static routes/);
        for (const file of ["rss.xml", "sitemap.xml"])
          await assert.rejects(readFile(join(root, "dist", file)), { code: "ENOENT" });
      });
    }
    await check("three NFC aliases identify a deterministic first source pair", async () => {
      await writeNote("z-last.md", "Last note", "café");
      await writeNote("a-first.md", "First note", "cafe\u0301");
      await writeNote("m-middle.md", "Middle note", "cafe\u0341");
      const diagnostics = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = build();
        assert.equal(result.error, undefined);
        assert.notEqual(result.status, 0, result.stdout + result.stderr);
        const output = result.stdout + result.stderr;
        const diagnostic = output.match(/Duplicate note route[^\n]+/)?.[0];
        assert.ok(diagnostic);
        assert.ok(diagnostic.includes("a-first.md"));
        assert.ok(diagnostic.includes("m-middle.md"));
        assert.ok(!diagnostic.includes("z-last.md"));
        assert.doesNotMatch(output, /generating static routes/);
        diagnostics.push(diagnostic);
      }
      assert.equal(diagnostics[0], diagnostics[1]);
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

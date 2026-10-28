import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const source = fileURLToPath(new URL("../", import.meta.url));

for (const adapter of ["starters/publication", "recipes/search-offline"])
  test(`${adapter}: watchers preserve the accepted collection after rejection and full sync`, async () => {
    const { createWatcherWrapper } = await import(
      pathToFileURL(join(source, "node_modules/astro/dist/content/watcher.js"))
    );
    const code = stripTypeScriptTypes(
      await readFile(join(source, adapter, "src/note-loader.ts"), "utf8"),
    ).replace(
      '"astro/loaders"',
      JSON.stringify(
        pathToFileURL(join(source, "node_modules/astro/dist/content/loaders/glob.js")).href,
      ),
    );
    const { noteLoader } = await import(
      "data:text/javascript;base64," + Buffer.from(code).toString("base64")
    );
    const root = await mkdtemp(join(tmpdir(), "astromache-note-watcher-"));
    const emitter = new EventEmitter();
    emitter.add = () => {};
    try {
      const directory = join(root, "src/content/notes");
      await mkdir(directory, { recursive: true });
      const file = join(directory, "one.md");
      const duplicate = join(directory, "two.md");
      const extra = join(directory, "extra.md");
      await writeFile(file, JSON.stringify({ slug: "before" }));
      const watcher = createWatcherWrapper(emitter);
      const data = new Map();
      const errors = [];
      const store = {
        get: (id) => data.get(id),
        has: (id) => data.has(id),
        keys: () => [...data.keys()],
        values: () => [...data.values()],
        entries: () => [...data.entries()],
        set: (entry) => {
          data.set(entry.id, entry);
          return true;
        },
        delete: (id) => data.delete(id),
        clear: () => data.clear(),
        addModuleImport: () => {},
      };
      const context = {
        config: { root: pathToFileURL(root + "/"), srcDir: pathToFileURL(join(root, "src/")) },
        collection: "notes",
        store,
        watcher,
        logger: { error: (message) => errors.push(message), warn: () => {}, info: () => {} },
        parseData: async ({ data }) => data,
        generateDigest: (text) => text,
        // Use the installed native glob; isolate the entry parser/store so this
        // test exercises listener lifecycle and atomic validation without a server.
        entryTypes: new Map([
          [
            ".md",
            { getEntryInfo: async ({ contents }) => ({ body: "", data: JSON.parse(contents) }) },
          ],
        ]),
      };
      const waitFor = async (condition) => {
        for (let attempt = 0; attempt < 100 && !condition(); attempt++)
          await new Promise((resolve) => setTimeout(resolve, 10));
        assert.ok(condition(), "Watcher refresh must finish within one second");
      };
      const loader = noteLoader();
      await loader.load(context);
      assert.deepEqual(store.keys(), ["before"]);
      watcher.removeAllTrackedListeners();
      await loader.load(context);
      for (const event of ["add", "change", "unlink"])
        assert.equal(emitter.listenerCount(event), 1);
      await writeFile(file, JSON.stringify({ slug: "after" }));
      emitter.emit("change", file);
      await waitFor(() => data.has("after"));
      assert.deepEqual(store.keys(), ["after"]);
      await writeFile(duplicate, JSON.stringify({ slug: "after" }));
      emitter.emit("add", duplicate);
      await waitFor(() => errors.length === 1);
      assert.match(errors[0], /Duplicate note ID/);
      assert.deepEqual(store.keys(), ["after"]);
      watcher.removeAllTrackedListeners();
      await assert.rejects(loader.load(context), /Duplicate note ID/);
      assert.deepEqual(store.keys(), ["after"]);
      for (const event of ["add", "change", "unlink"])
        assert.equal(emitter.listenerCount(event), 1);
      await rm(duplicate);
      emitter.emit("unlink", duplicate);
      await writeFile(file, JSON.stringify({ slug: "recovered" }));
      emitter.emit("change", file);
      await waitFor(() => data.has("recovered"));
      await writeFile(extra, JSON.stringify({ slug: "extra" }));
      emitter.emit("add", extra);
      await waitFor(() => data.has("extra"));
      await rm(extra);
      emitter.emit("unlink", extra);
      await waitFor(() => !data.has("extra"));
      await loader.load(context);
      assert.deepEqual(store.keys(), ["recovered"]);
      for (const event of ["add", "change", "unlink"])
        assert.equal(emitter.listenerCount(event), 1);
    } finally {
      emitter.removeAllListeners();
      await rm(root, { recursive: true, force: true });
    }
  });

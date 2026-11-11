import { fileURLToPath } from "node:url";
import { relative, sep } from "node:path";
import { glob, type DataStore, type Loader, type LoaderContext } from "astro/loaders";
import { noteLink } from "./note-route";

export const noteLoader = (): Loader => {
  const base = "./src/content/notes";
  const loader = glob({ pattern: "**/*.md", base });
  let previousWatcher: LoaderContext["watcher"];
  let previousRefresh: ((file: string) => void) | undefined;
  let pending = Promise.resolve();

  const sync = async (context: LoaderContext) => {
    const entries = new Map<string, ReturnType<DataStore["values"]>[number]>();
    const files = new Map<string, string>();
    const store: DataStore = {
      // Every input file must be checked, including identical duplicate files
      // which the native loader's digest cache would otherwise skip.
      get: () => undefined,
      has: (id) => entries.has(id),
      keys: () => [...entries.keys()],
      values: () => [...entries.values()],
      entries: () => [...entries.entries()],
      clear: () => entries.clear(),
      delete: (id) => {
        entries.delete(id);
      },
      addModuleImport: () => {},
      set: (entry) => {
        const previous = files.get(entry.id);
        const file = entry.filePath ?? entry.id;
        if (previous !== undefined) {
          throw new Error(
            `Duplicate note ID ${JSON.stringify(entry.id)}: ${JSON.stringify(previous)} and ${JSON.stringify(file)}. Rename one note or slug.`,
          );
        }
        files.set(entry.id, file);
        entries.set(entry.id, entry);
        return true;
      },
    };
    // Stage the native loader's entries before updating Astro's real collection.
    // This preserves its ID generation and schema parsing without allowing a
    // duplicate ID to overwrite an entry, even when file loads run concurrently.
    await loader.load({ ...context, store, watcher: undefined });
    // The glob reads concurrently. Validate derived routes in source-file order
    // so the first conflicting pair and its diagnostic are reproducible.
    const ordered = [...entries.values()].sort((a, b) => {
      const left = a.filePath ?? a.id;
      const right = b.filePath ?? b.id;
      return left < right ? -1 : left > right ? 1 : 0;
    });
    const routes = new Map<string, { id: string; file: string; route: string }>();
    for (const entry of ordered) {
      const file = entry.filePath ?? entry.id;
      let route: string;
      try {
        route = noteLink(entry.id);
      } catch (error) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)} Source: ${JSON.stringify(file)}.`,
        );
      }
      // Compare actual artifact names conservatively for case-insensitive hosts;
      // the original IDs and emitted URL casing remain unchanged.
      const key = decodeURIComponent(route).toLowerCase();
      const previousRoute = routes.get(key);
      if (previousRoute !== undefined) {
        throw new Error(
          `Duplicate note route: ${JSON.stringify(previousRoute.id)} from ${JSON.stringify(previousRoute.file)} (${JSON.stringify(previousRoute.route)}) and ${JSON.stringify(entry.id)} from ${JSON.stringify(file)} (${JSON.stringify(route)}) collide at portable output path ${JSON.stringify(key)}. Rename one note or slug.`,
        );
      }
      routes.set(key, { id: entry.id, file, route });
    }
    for (const id of context.store.keys()) {
      if (!entries.has(id)) context.store.delete(id);
    }
    for (const entry of entries.values()) context.store.set(entry);
  };

  return {
    name: "validated-note-glob",
    load: async (context) => {
      // Astro removes tracked listeners before a full sync and reuses loaders.
      // Reattach for the current context, without retaining stale callbacks.
      if (previousWatcher && previousRefresh) {
        for (const event of ["add", "change", "unlink"] as const) {
          previousWatcher.off(event, previousRefresh);
        }
      }
      previousWatcher = undefined;
      previousRefresh = undefined;
      await pending;
      try {
        await sync(context);
      } finally {
        // Keep recovery listeners even when a full content sync is rejected.
        const watcher = context.watcher;
        if (watcher) {
          const directory = fileURLToPath(new URL(base, context.config.root));
          watcher.add(directory);
          const refresh = (file: string) => {
            const path = relative(directory, file);
            if (path.startsWith(".." + sep) || path === ".." || !path.endsWith(".md")) return;
            // Revalidate the complete collection on edits, additions and removals.
            // A rejected change leaves the previously accepted collection intact.
            pending = pending
              .then(() => sync(context))
              .catch((error) => {
                context.logger.error(error instanceof Error ? error.message : String(error));
              });
          };
          for (const event of ["add", "change", "unlink"] as const) watcher.on(event, refresh);
          previousWatcher = watcher;
          previousRefresh = refresh;
        }
      }
    },
  };
};

import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { readdir, copyFile, mkdir } from "node:fs/promises";
import { generateOfflineWorker } from "@effortlessmetrics/astro-offline/integration";
/** Canonical static directory pages; site-owned redirects must be excluded. */
export default function staticOffline({ excludedPages = [], ...options }) {
  return {
    name: "astromache-static-offline",
    hooks: {
      "astro:build:done": async ({ dir }) => {
        const root = fileURLToPath(dir);
        try {
          await mkdir(join(root, "404"), { recursive: true });
          await copyFile(join(root, "404.html"), join(root, "404/index.html"));
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        const pages = (await readdir(root, { recursive: true }))
          .filter((path) => path === "index.html" || /[\\/]index\.html$/.test(path))
          .map(
            (path) =>
              "/" + path.replaceAll(String.fromCharCode(92), "/").replace(/index\.html$/, ""),
          )
          .filter((path) => !excludedPages.includes(path))
          .sort();
        await generateOfflineWorker(root, {
          ...options,
          pages,
          globIgnores: [...(options.globIgnores ?? []), "**/*.html"],
          worker: {
            ...options.worker,
            navigationFallback: options.worker?.navigationFallback?.replace(/index\.html$/, ""),
          },
          receiptFile: "offline-receipt.json",
        });
      },
    },
  };
}

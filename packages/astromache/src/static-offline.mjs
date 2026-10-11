import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { readdir, copyFile, mkdir } from "node:fs/promises";
import { generateOfflineWorker } from "@effortlessmetrics/astro-offline/integration";
/** Canonical static directory pages; site-owned redirects must be excluded. */
export default function staticOffline({ excludedPages = [], ...options }) {
  const receiptFile = options.receiptFile ?? "offline-receipt.json";
  return {
    name: "astromache-static-offline",
    hooks: {
      "astro:config:done": ({ config }) => {
        if (config.base !== "/") {
          throw new Error(
            'astromache/static-offline requires base: "/"; subpath deployments are not supported by the canonical directory preset.',
          );
        }
        if (config.build.format !== "directory") {
          throw new Error(
            'astromache/static-offline requires build.format: "directory"; file output cannot supply canonical directory cache URLs.',
          );
        }
        if (
          !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(receiptFile) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(receiptFile)
        ) {
          throw new Error(
            "astromache/static-offline receiptFile must be a portable root .json filename using letters, digits, dots, underscores or hyphens, starting with a letter or digit; paths, glob characters and reserved device names are unsupported.",
          );
        }
      },
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
          receiptFile,
        });
      },
    },
  };
}

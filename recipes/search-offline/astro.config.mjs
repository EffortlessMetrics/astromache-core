import { defineConfig } from "astro/config";
import astroOffline from "@effortlessmetrics/astro-offline/integration";
export default defineConfig({
  site: "https://publication.example",
  prefetch: { prefetchAll: false },
  integrations: [
    astroOffline({
      cachePrefix: "astromache-recipe-reading-",
      workerFile: "reading-worker.js",
      globPatterns: ["**/*.{html,js,css,json,svg,woff2}"],
      maxResources: 100,
      maxBytes: 5 * 1024 * 1024,
      maxFileBytes: 2 * 1024 * 1024,
      maxHtmlBytes: 256 * 1024,
      worker: {
        navigationStrategy: "network-first",
        stripQuery: false,
        excludedPrefixes: ["/api/"],
        navigationFallback: "/offline/index.html",
      },
    }),
  ],
});

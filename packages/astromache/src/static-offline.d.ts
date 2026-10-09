import type { AstroIntegration } from "astro";
import type { OfflineOptions } from "@effortlessmetrics/astro-offline/integration";
export default function staticOffline(
  options: Omit<OfflineOptions, "pages"> & { excludedPages?: string[] },
): AstroIntegration;

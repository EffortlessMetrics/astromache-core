import type { AstroIntegration } from "astro";
import type { OfflineOptions } from "@effortlessmetrics/astro-offline/integration";
/** Root-mounted directory output only; receiptFile is a portable root JSON filename (default offline-receipt.json). */
export default function staticOffline(
  options: Omit<OfflineOptions, "pages"> & { excludedPages?: string[] },
): AstroIntegration;

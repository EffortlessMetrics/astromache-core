import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export async function runTemporaryConsumerVerifier(worker, prefix) {
  const temp = await mkdtemp(join(tmpdir(), prefix));
  try {
    // Astro preview can load native modules from an installed consumer. Windows
    // holds those DLLs until process exit, even after the preview server stops.
    const result = spawnSync(process.execPath, [fileURLToPath(worker), temp], {
      stdio: "inherit",
      timeout: 600_000,
    });
    if (result.error) throw result.error;
    if (result.signal) console.error(`Consumer verifier terminated by ${result.signal}`);
    return result.status ?? 1;
  } finally {
    // spawnSync has returned, so the child no longer holds its native modules.
    // Retry transient filesystem contention, but report any cleanup failure.
    await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

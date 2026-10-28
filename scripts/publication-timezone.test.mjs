import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const pnpm = join(root, "node_modules/pnpm/bin/pnpm.cjs");

test(
  "exported consumers build stable publication dates across timezones",
  { timeout: 300000 },
  async () => {
    const tmp = await mkdtemp(join(tmpdir(), "publication-timezone-"));
    try {
      for (const product of ["publication", "search-offline"]) {
        const dir = join(tmp, product);
        execFileSync(process.execPath, [join(root, "scripts/create-starter.mjs"), product, dir]);
        const env = { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" };
        execFileSync(process.execPath, [pnpm, "install", "--frozen-lockfile", "--ignore-scripts"], {
          cwd: dir,
          env,
          stdio: "pipe",
        });
        const note = join(dir, "src/content/notes/a-quiet-system.md");
        const original = await readFile(note, "utf8");
        for (const [value, expected] of [
          ["2026-10-02T00:30:00", "Fri, 02 Oct 2026 00:30:00 GMT"],
          ["2026-10-02t00:30:00", "Fri, 02 Oct 2026 00:30:00 GMT"],
          ["2026-10-02T00:30:00+09:00", "Thu, 01 Oct 2026 15:30:00 GMT"],
        ]) {
          await writeFile(note, original.replace("published: 2026-10-02", `published: "${value}"`));
          for (const TZ of ["UTC", "Pacific/Honolulu", "Asia/Tokyo"]) {
            await rm(join(dir, "node_modules/.astro"), { recursive: true, force: true });
            await rm(join(dir, ".astro"), { recursive: true, force: true });
            execFileSync(process.execPath, [pnpm, "build"], {
              cwd: dir,
              env: { ...env, TZ },
              stdio: "pipe",
            });
            const rss = await readFile(join(dir, "dist/rss.xml"), "utf8");
            assert.ok(rss.includes(`<pubDate>${expected}</pubDate>`), `${product} ${value} ${TZ}`);
            const html = await readFile(join(dir, "dist/notes/a-quiet-system/index.html"), "utf8");
            assert.ok(
              html.includes(`datetime="${new Date(expected).toISOString()}"`),
              `${product} article ${value} ${TZ}`,
            );
          }
        }
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  },
);

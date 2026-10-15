import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { capturePublicationPreservation } from "./verify-publication-upgrade.mjs";
import { customizePublicationConsumer } from "./publication-consumer-fixture.mjs";

const producer = fileURLToPath(new URL("../", import.meta.url));
for (const project of ["publication", "search-offline"]) {
  test(project + " upgraded consumer preservation and destructive controls", async () => {
    const root = await mkdtemp(join(tmpdir(), "publication-preservation-"));
    const directory = join(root, "consumer");
    execFileSync(process.execPath, [
      join(producer, "scripts/create-starter.mjs"),
      project,
      directory,
    ]);
    await customizePublicationConsumer(directory);
    const candidate = { archive: "astromache-preservation-control.tgz" };
    const verify = await capturePublicationPreservation(directory, candidate, {
      recipe: project === "search-offline",
    });
    const manifestPath = join(directory, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.dependencies.astromache = "file:vendor/" + candidate.archive;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    // These are guard controls, not installation evidence. Delivery validation
    // remains the real upgrade's separate responsibility.
    await writeFile(join(directory, "vendor", candidate.archive), "candidate delivery control");
    await verify();
    const files = [
      "src/content/notes/a-quiet-system.md",
      "src/styles/publication.css",
      "public/consumer-owned.bin",
      "CONSUMER-CONTENT-NOTICE.txt",
      "licenses/template/LICENSE",
      "licenses/template/LICENSE-MIT",
      "licenses/template/LICENSE-APACHE",
      "licenses/template/README.md",
    ];
    for (const file of files) {
      const path = join(directory, file);
      const original = await readFile(path);
      try {
        await writeFile(path, "overwritten during upgrade");
        await assert.rejects(verify(), /must remain identical/, file + " overwrite");
        await unlink(path);
        await assert.rejects(verify(), /must remain identical/, file + " removal");
      } finally {
        await writeFile(path, original);
      }
      await verify();
    }
    for (const field of ["license", "description", "private"]) {
      const original = await readFile(manifestPath);
      try {
        await writeFile(manifestPath, JSON.stringify({ ...manifest, [field]: "changed" }));
        await assert.rejects(verify(), /Only dependency pin/, field);
      } finally {
        await writeFile(manifestPath, original);
      }
    }
    const added = join(directory, "LICENSE");
    try {
      await writeFile(added, "Accidental blanket application license");
      await assert.rejects(verify(), /must remain identical/);
    } finally {
      await unlink(added);
    }
    await verify();
    console.log(
      project + ": allowed delivery accepted; 20 destructive mutations rejected; " + directory,
    );
  });
}

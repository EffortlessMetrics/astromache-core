import assert from "node:assert/strict";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Customize existing content as well as adding files. These changes must survive
// the real packed dependency upgrade, without affecting browser route contracts.
export async function customizePublicationConsumer(directory) {
  const path = join(directory, "package.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  assert.equal(manifest.license, "UNLICENSED");
  const application = {};
  for (const [key, value] of Object.entries(manifest)) {
    if (key === "license")
      application.description = "Consumer-owned publication; preserve my application terms";
    application[key] = value;
  }
  await writeFile(path, JSON.stringify(application, null, 2) + "\n");
  await appendFile(
    join(directory, "src/content/notes/a-quiet-system.md"),
    "\nConsumer-owned replacement paragraph: café, 東京, and upgrade preservation.\n",
  );
  await appendFile(
    join(directory, "src/styles/publication.css"),
    "\n/* Consumer-owned styling decision. */\n",
  );
  await writeFile(join(directory, "public/consumer-owned.bin"), Buffer.from([0, 255, 13, 10, 128]));
  await writeFile(
    join(directory, "CONSUMER-CONTENT-NOTICE.txt"),
    "Replacement writing and assets remain consumer-controlled.\n",
  );
}

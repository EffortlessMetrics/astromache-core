import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { runTemporaryConsumerVerifier } from "./temporary-consumer-verifier.mjs";

for (const [name, body, expected] of [
  ["success", 'console.log("Consumer lifecycle success control");', 0],
  ["assertion failure", 'assert.fail("Deliberate consumer assertion failure");', 1],
  ["explicit nonzero exit", "process.exitCode = 37;", 37],
]) {
  test(`temporary consumer cleanup waits for child exit after ${name}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "consumer-lifecycle-"));
    const before = Object.fromEntries(
      ["TMPDIR", "TMP", "TEMP"].map((key) => [key, process.env[key]]),
    );
    try {
      for (const key of Object.keys(before)) process.env[key] = root;
      const record = join(root, "child.json");
      const worker = join(root, "worker.mjs");
      await writeFile(
        worker,
        `import assert from "node:assert/strict";
import { existsSync, openSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const directory = process.argv[2];
const held = join(directory, "held-file.txt");
openSync(held, "w");
writeFileSync(${JSON.stringify(record)}, JSON.stringify({ directory, pid: process.pid }));
process.on("exit", () => assert.ok(existsSync(held), "Fixture must survive until child exit"));
${body}
`,
      );
      assert.equal(await runTemporaryConsumerVerifier(pathToFileURL(worker), "owned-"), expected);
      const { directory, pid } = JSON.parse(await readFile(record, "utf8"));
      assert.notEqual(pid, process.pid, "Verifier must execute in a separate process");
      await assert.rejects(readFile(join(directory, "held-file.txt")), { code: "ENOENT" });
      assert.deepEqual(
        (await readdir(root)).filter((file) => file.startsWith("owned-")),
        [],
      );
    } finally {
      for (const [key, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(root, { recursive: true, force: true });
    }
  });
}

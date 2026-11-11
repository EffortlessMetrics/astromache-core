import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runTemporaryConsumerVerifier } from "./temporary-consumer-verifier.mjs";

execFileSync(
  process.execPath,
  ["--test", fileURLToPath(new URL("./temporary-consumer-verifier.test.mjs", import.meta.url))],
  { stdio: "inherit" },
);

const status = await runTemporaryConsumerVerifier(
  new URL("./verify-note-canonical-routes-worker.mjs", import.meta.url),
  "note-canonical-",
);
if (status !== 0) process.exit(status);

import { runTemporaryConsumerVerifier } from "./temporary-consumer-verifier.mjs";

const status = await runTemporaryConsumerVerifier(
  new URL("./verify-rss-http-worker.mjs", import.meta.url),
  "rss-http-",
);
if (status !== 0) process.exit(status);

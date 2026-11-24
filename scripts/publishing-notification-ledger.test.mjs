import assert from "node:assert/strict";
import { test } from "node:test";
import {
  beginNotificationBatch,
  createNotificationLedger,
  discoveryManifestSha256,
  observeNotificationDeployment,
  recoverNotificationBatch,
  resetRejectedNotifications,
  settleNotificationBatch,
} from "../packages/astromache/src/publishing/index.mjs";

const origin = "https://publication.example";
const url = (path) => origin + "/" + path + "/";
const page = (path, digit = "a") => ({ url: url(path), contentSha256: digit.repeat(64) });
const deployment = (id, pages) => {
  const manifest = {
    schemaVersion: 1,
    fingerprintVersion: 2,
    origin,
    sitemap: origin + "/sitemap.xml",
    pages,
  };
  return {
    environment: "production",
    deploymentId: id,
    sourceSha: "a".repeat(40),
    manifestSha256: discoveryManifestSha256(manifest),
    hostedReceiptSha256: "b".repeat(64),
    manifest,
  };
};
const bootstrap = (pages, retired = []) =>
  observeNotificationDeployment(createNotificationLedger(origin, retired), deployment("A", pages));
const roundTrip = (state) => JSON.parse(JSON.stringify(state));
const submit = (ledger, status = 200, now = 1000, limit = 10000, retryAfter) => {
  const begun = beginNotificationBatch(ledger, { now, limit });
  assert.ok(begun.intent);
  return settleNotificationBatch(roundTrip(begun.ledger), {
    attemptId: begun.intent.attemptId,
    status,
    now,
    retryAfter,
  });
};

test("initial delivery, partial acknowledgement and identical redeployment", () => {
  let state = bootstrap([page("a"), page("b")]);
  assert.equal(state.pending.length, 2);
  state = submit(state, 200, 1000, 1).ledger;
  assert.deepEqual(
    state.acknowledged.map((row) => row.url),
    [url("a")],
  );
  assert.deepEqual(
    state.pending.map((row) => row.url),
    [url("b")],
  );
  state = submit(state).ledger;
  assert.equal(state.pending.length, 0);
  const next = observeNotificationDeployment(state, deployment("B", [page("b"), page("a")]));
  assert.equal(next.pending.length, 0);
  assert.equal(beginNotificationBatch(next, { now: 2000 }).intent, null);
  assert.deepEqual(
    observeNotificationDeployment(next, deployment("B", [page("a"), page("b")])),
    next,
  );
});

test("rename, removal, intermediate failed change and rollback preserve latest desired state", () => {
  const original = deployment("A", [page("a"), page("old")]);
  let state = submit(
    observeNotificationDeployment(createNotificationLedger(origin), original),
  ).ledger;
  state = observeNotificationDeployment(state, deployment("B", [page("a", "b"), page("new")]));
  assert.deepEqual(
    state.pending.map((row) => [row.url, row.state === null]),
    [
      [url("a"), false],
      [url("new"), false],
      [url("old"), true],
    ],
  );
  const attempt = beginNotificationBatch(state, { now: 2000 });
  const rollback = observeNotificationDeployment(attempt.ledger, original);
  assert.deepEqual(
    rollback.pending.map((row) => [row.url, row.state === null]),
    [
      [url("a"), false],
      [url("new"), true],
      [url("old"), false],
    ],
  );
  assert.throws(
    () =>
      settleNotificationBatch(rollback, {
        attemptId: attempt.intent.attemptId,
        status: 200,
        now: 3000,
      }),
    /Stale/,
  );
  state = submit(rollback, 200, 3000).ledger;
  assert.equal(state.pending.length, 0);
  assert.equal(state.acknowledged.find((row) => row.url === url("new")).state, null);
});

test("pending key, rate limiting, interruption and permanent rejection", () => {
  let state = bootstrap([page("a")]);
  const pending = submit(state, 202, 1000);
  assert.equal(pending.receipt.outcome, "key-pending");
  state = pending.ledger;
  assert.equal(state.acknowledged.length, 0);
  assert.equal(beginNotificationBatch(state, { now: 600999 }).intent, null);
  const rate = submit(state, 429, 601000, 10000, "7200");
  assert.equal(rate.ledger.pending[0].notBefore, 7801000);
  assert.equal(rate.receipt.retryAfter, "7200");
  const begun = beginNotificationBatch(rate.ledger, { now: 7801000 });
  assert.ok(begun.intent);
  const recovered = recoverNotificationBatch(roundTrip(begun.ledger), 7801001);
  assert.equal(recovered.receipt.status, null);
  assert.equal(recovered.ledger.pending[0].status, "retryable");
  assert.equal(recovered.ledger.acknowledged.length, 0);
  const rejected = submit(recovered.ledger, 403, recovered.ledger.pending[0].notBefore);
  assert.equal(rejected.ledger.pending[0].status, "rejected");
  assert.equal(beginNotificationBatch(rejected.ledger, { now: 999999999 }).intent, null);
  const reset = resetRejectedNotifications(rejected.ledger, [url("a")]);
  assert.equal(submit(reset, 200, 999999999).ledger.pending.length, 0);
});

test("seed historical migration URLs and reject cross-origin or mismatched acceptance", () => {
  let state = bootstrap([page("new")], [url("legacy")]);
  assert.deepEqual(
    state.pending.map((row) => [row.url, row.state === null]),
    [
      [url("legacy"), true],
      [url("new"), false],
    ],
  );
  state = submit(state).ledger;
  assert.equal(state.acknowledged.length, 2);
  assert.throws(() => createNotificationLedger("https://preview.pages.dev"), /production/);
  assert.throws(
    () => createNotificationLedger(origin, ["https://elsewhere.example/"]),
    /same-origin/,
  );
  const accepted = deployment("B", [page("new")]);
  for (const altered of [
    { ...accepted, environment: "preview" },
    { ...accepted, manifestSha256: "0".repeat(64) },
    { ...accepted, sourceSha: "short" },
  ])
    assert.throws(() => observeNotificationDeployment(state, altered));
  assert.throws(
    () => observeNotificationDeployment(state, deployment("A", [page("other")])),
    /reused/,
  );
});

test("durable state rejects duplicate rows and stale or mismatched intents", () => {
  const state = bootstrap([page("a")]);
  assert.throws(
    () =>
      beginNotificationBatch(
        { ...state, pending: [...state.pending, ...state.pending] },
        { now: 1000 },
      ),
    /Duplicate/,
  );
  const begun = beginNotificationBatch(state, { now: 1000 });
  assert.throws(() => beginNotificationBatch(begun.ledger, { now: 1000 }), /Recover or settle/);
  assert.throws(
    () => settleNotificationBatch(begun.ledger, { attemptId: "bad", status: 200, now: 1000 }),
    /Stale/,
  );
  assert.throws(
    () =>
      settleNotificationBatch(begun.ledger, {
        attemptId: begun.intent.attemptId,
        status: 200,
        now: 999,
      }),
    /predates/,
  );
  const next = submit(recoverNotificationBatch(roundTrip(begun.ledger), 2000).ledger, 200, 62000);
  assert.equal(next.ledger.pending.length, 0);
});

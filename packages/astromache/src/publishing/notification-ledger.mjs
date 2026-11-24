import { createHash } from "node:crypto";
import { createDiscoveryManifest } from "./discovery.mjs";
import { httpURL } from "./metadata.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const hex = (value, length) => typeof value === "string" && new RegExp("^[0-9a-f]{" + length + "}$").test(value);
const byUrl = (a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0);
const statuses = ["ready", "retryable", "key-pending", "rejected"];

function originOf(value) {
  const url = httpURL(value, "Notification origin");
  if (url.protocol !== "https:" || url.href !== url.origin + "/" || url.hostname.endsWith(".pages.dev"))
    throw new Error("Notification ledger requires an exact production HTTPS origin");
  return url.origin;
}

function canonical(value, origin) {
  const url = httpURL(value, "Notification URL");
  if (url.origin !== origin || url.href !== value || url.search || url.hash)
    throw new Error("Notification URL must be an exact same-origin canonical: " + value);
  return value;
}

function nowValue(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000)
    throw new Error("Notification time must be an explicit epoch millisecond value");
  return value;
}

function pageState(page) {
  if (page === null) return null;
  if (!page || !hex(page.contentSha256, 64)) throw new Error("Invalid notification page fingerprint");
  const result = { contentSha256: page.contentSha256 };
  if (page.lastmod !== undefined) {
    if (typeof page.lastmod !== "string" || new Date(page.lastmod).toISOString() !== page.lastmod)
      throw new Error("Invalid notification lastmod");
    result.lastmod = page.lastmod;
  }
  return result;
}

const equal = (a, b) => JSON.stringify(pageState(a)) === JSON.stringify(pageState(b));

function normalizeManifest(manifest, origin) {
  if (manifest?.schemaVersion !== 1 || manifest.fingerprintVersion !== 2)
    throw new Error("Notification requires a supported discovery manifest and fingerprint version");
  const result = createDiscoveryManifest(manifest);
  if (result.origin !== origin) throw new Error("Notification manifest origin mismatch");
  return result;
}

export function discoveryManifestSha256(input) {
  const manifest = normalizeManifest(input, originOf(input.origin));
  return hash(JSON.stringify(manifest, null, 2) + "\n");
}

function deploymentOf(input, origin) {
  if (
    input?.environment !== "production" ||
    typeof input.deploymentId !== "string" ||
    !input.deploymentId.trim() ||
    input.deploymentId.length > 256 ||
    !hex(input.sourceSha, 40) ||
    !hex(input.manifestSha256, 64) ||
    !hex(input.hostedReceiptSha256, 64)
  )
    throw new Error("Notification requires a production acceptance receipt with exact source and artifact identities");
  const manifest = normalizeManifest(input.manifest, origin);
  if (input.manifestSha256 !== discoveryManifestSha256(manifest))
    throw new Error("Accepted deployment manifest hash mismatch");
  return {
    environment: "production",
    deploymentId: input.deploymentId,
    sourceSha: input.sourceSha,
    manifestSha256: input.manifestSha256,
    hostedReceiptSha256: input.hostedReceiptSha256,
    manifest,
  };
}

function rowsMap(rows, origin, pending = false) {
  if (!Array.isArray(rows)) throw new Error("Invalid notification ledger rows");
  const map = new Map();
  for (const row of rows) {
    const url = canonical(row.url, origin);
    if (map.has(url)) throw new Error("Duplicate notification ledger URL: " + url);
    const state = pageState(row.state);
    if (pending) {
      if (!statuses.includes(row.status) || !Number.isSafeInteger(row.attempts) || row.attempts < 0)
        throw new Error("Invalid notification pending state: " + url);
      if (row.notBefore !== null) nowValue(row.notBefore);
      if (row.lastStatus !== null && (!Number.isInteger(row.lastStatus) || row.lastStatus < 100 || row.lastStatus > 599))
        throw new Error("Invalid notification response status: " + url);
    }
    map.set(url, { ...row, url, state });
  }
  return map;
}

function verifyLedger(ledger) {
  if (ledger?.schemaVersion !== 1 || !Number.isSafeInteger(ledger.revision) || ledger.revision < 0)
    throw new Error("Invalid notification ledger version or revision");
  const origin = originOf(ledger.origin);
  if (origin !== ledger.origin) throw new Error("Noncanonical notification ledger origin");
  const acknowledged = rowsMap(ledger.acknowledged, origin);
  const pending = rowsMap(ledger.pending, origin, true);
  const deployed = ledger.deployed === null ? null : deploymentOf(ledger.deployed, origin);
  if (ledger.inFlight !== null) {
    const intent = ledger.inFlight;
    if (
      !deployed ||
      !hex(intent.attemptId, 64) ||
      intent.deploymentId !== deployed.deploymentId ||
      intent.manifestSha256 !== deployed.manifestSha256 ||
      !Array.isArray(intent.rows) ||
      intent.rows.length < 1 ||
      intent.rows.length > 10000
    )
      throw new Error("Notification intent does not match accepted deployment");
    nowValue(intent.startedAt);
    const rows = rowsMap(intent.rows, origin);
    for (const [url, row] of rows) {
      if (!pending.has(url) || !equal(row.state, pending.get(url).state))
        throw new Error("Notification intent no longer matches pending state: " + url);
    }
  }
  return { origin, acknowledged, pending, deployed };
}

const fresh = (url, state) => ({
  url,
  state,
  status: "ready",
  attempts: 0,
  notBefore: null,
  lastStatus: null,
});

export function createNotificationLedger(origin, retiredUrls = []) {
  origin = originOf(origin);
  const pending = retiredUrls.map((url) => fresh(canonical(url, origin), null)).sort(byUrl);
  rowsMap(pending, origin, true);
  return {
    schemaVersion: 1,
    origin,
    revision: 0,
    deployed: null,
    acknowledged: [],
    pending,
    inFlight: null,
  };
}

/** Pure state transition; the caller must establish the actual hosted acceptance receipt. */
export function observeNotificationDeployment(ledger, acceptance) {
  const { origin, acknowledged, pending, deployed } = verifyLedger(ledger);
  const current = deploymentOf(acceptance, origin);
  if (deployed?.deploymentId === current.deploymentId) {
    if (deployed.sourceSha !== current.sourceSha || deployed.manifestSha256 !== current.manifestSha256)
      throw new Error("Deployment identity reused with different source or manifest");
    return ledger;
  }
  const desired = new Map(current.manifest.pages.map((page) => [page.url, pageState(page)]));
  const known = new Set([
    ...desired.keys(),
    ...(deployed?.manifest.pages ?? []).map((page) => page.url),
    ...acknowledged.keys(),
    ...pending.keys(),
  ]);
  const next = [];
  for (const url of known) {
    const target = desired.get(url) ?? null;
    const prior = pending.get(url);
    const ack = acknowledged.get(url);
    // A pending prior attempt might have reached the server before a crash.
    // Even a rollback to the acknowledged state needs a fresh notification.
    if (prior && equal(prior.state, target)) next.push(prior);
    else if (prior || !ack || !equal(ack.state, target)) next.push(fresh(url, target));
  }
  return {
    ...ledger,
    revision: ledger.revision + 1,
    deployed: current,
    pending: next.sort(byUrl),
    inFlight: null,
  };
}

/** Persist the returned ledger atomically before issuing the external request. */
export function beginNotificationBatch(ledger, { now, limit = 10000 }) {
  const { deployed } = verifyLedger(ledger);
  nowValue(now);
  if (!deployed) throw new Error("No accepted production deployment");
  if (ledger.inFlight) throw new Error("Recover or settle the existing notification intent first");
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000)
    throw new Error("Notification batch limit must be between 1 and 10000");
  const rows = ledger.pending
    .filter((row) => row.status !== "rejected" && (row.notBefore === null || row.notBefore <= now))
    .sort(byUrl)
    .slice(0, limit)
    .map(({ url, state }) => ({ url, state }));
  if (!rows.length) return { ledger, intent: null };
  const revision = ledger.revision + 1;
  const intent = {
    attemptId: hash(JSON.stringify([revision, deployed.deploymentId, deployed.manifestSha256, now, rows])),
    deploymentId: deployed.deploymentId,
    manifestSha256: deployed.manifestSha256,
    startedAt: now,
    rows,
  };
  return { ledger: { ...ledger, revision, inFlight: intent }, intent };
}

function retryTime(now, status, attempts, retryAfter) {
  const delay = Math.min(3600000, 60000 * 2 ** Math.min(attempts - 1, 6));
  let target = now + Math.max(delay, status === 202 ? 600000 : 0);
  if (typeof retryAfter === "string" && retryAfter.trim()) {
    const value = retryAfter.trim();
    const advertised = /^\d+$/.test(value) ? now + Number(value) * 1000 : Date.parse(value);
    if (Number.isSafeInteger(advertised)) target = Math.max(target, advertised);
  }
  return nowValue(target);
}

/** A receipt applies only to the persisted exact intent, never to a newer deployment. */
export function settleNotificationBatch(ledger, { attemptId, status, retryAfter, now }) {
  const { acknowledged, pending } = verifyLedger(ledger);
  const intent = ledger.inFlight;
  nowValue(now);
  if (!intent || intent.attemptId !== attemptId) throw new Error("Stale or unknown notification attempt");
  if (now < intent.startedAt) throw new Error("Notification response predates intent");
  if (status !== null && (!Number.isInteger(status) || status < 100 || status > 599))
    throw new Error("Invalid notification response status");
  const outcome =
    status === 200 ? "acknowledged" :
    status === 202 ? "key-pending" :
    status === null || status === 429 || status >= 500 ? "retryable" : "rejected";
  for (const row of intent.rows) {
    const prior = pending.get(row.url);
    if (outcome === "acknowledged") {
      acknowledged.set(row.url, { url: row.url, state: row.state });
      pending.delete(row.url);
    } else {
      const attempts = prior.attempts + 1;
      pending.set(row.url, {
        ...prior,
        attempts,
        status: outcome,
        lastStatus: status,
        notBefore: outcome === "rejected" ? null : retryTime(now, status, attempts, retryAfter),
      });
    }
  }
  const receipt = {
    attemptId,
    deploymentId: intent.deploymentId,
    manifestSha256: intent.manifestSha256,
    startedAt: intent.startedAt,
    finishedAt: now,
    status,
    outcome,
    ...(typeof retryAfter === "string" && retryAfter ? { retryAfter } : {}),
    urls: intent.rows.map((row) => row.url),
  };
  return {
    ledger: {
      ...ledger,
      revision: ledger.revision + 1,
      acknowledged: [...acknowledged.values()].sort(byUrl),
      pending: [...pending.values()].sort(byUrl),
      inFlight: null,
    },
    receipt,
  };
}

/** Interrupted delivery is ambiguous; retry rather than inventing an acknowledgement. */
export function recoverNotificationBatch(ledger, now) {
  verifyLedger(ledger);
  if (!ledger.inFlight) return { ledger, receipt: null };
  return settleNotificationBatch(ledger, {
    attemptId: ledger.inFlight.attemptId,
    status: null,
    now,
  });
}

export function resetRejectedNotifications(ledger, urls) {
  const { origin, pending } = verifyLedger(ledger);
  if (ledger.inFlight) throw new Error("Cannot reset notifications with an in-flight intent");
  for (const value of urls) {
    const url = canonical(value, origin);
    const row = pending.get(url);
    if (row?.status !== "rejected") throw new Error("URL does not have a rejected notification: " + url);
    pending.set(url, fresh(url, row.state));
  }
  return { ...ledger, revision: ledger.revision + 1, pending: [...pending.values()].sort(byUrl) };
}

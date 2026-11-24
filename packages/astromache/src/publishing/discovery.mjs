import { createHash } from "node:crypto";
import { SaxesParser } from "saxes";
import { httpURL } from "./metadata.mjs";
import { discoveryContent, discoveryMedia, readDocument } from "./rendered.mjs";

const namespace = "http://www.sitemaps.org/schemas/sitemap/0.9";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function siteOrigin(value) {
  const url = httpURL(value, "Discovery origin");
  if (url.href !== url.origin + "/") throw new Error("Discovery requires a root origin");
  return url.origin;
}

function canonical(value, origin) {
  const url = httpURL(value, "Discovery URL");
  if (url.origin !== origin || url.search || url.hash || url.href !== String(value))
    throw new Error("Discovery URL must be an exact same-origin canonical: " + value);
  return url.href;
}

function date(value) {
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)
  )
    throw new Error("Discovery date must be a date or timezone-qualified timestamp: " + value);
  const day = new Date(value.slice(0, 10));
  const parsed = new Date(value);
  if (
    !Number.isFinite(day.getTime()) ||
    day.toISOString().slice(0, 10) !== value.slice(0, 10) ||
    !Number.isFinite(parsed.getTime())
  )
    throw new Error("Invalid discovery date: " + value);
  return parsed.toISOString();
}

export function sitemapLastmod(published, modified) {
  const first = published == null ? undefined : date(published);
  const last = modified == null ? undefined : date(modified);
  if (first && last && last < first) throw new Error("Modification precedes publication");
  return last ?? first;
}

function sitemapEntries(xml) {
  const parser = new SaxesParser({ xmlns: true });
  const stack = [];
  const rows = [];
  let root, row, field;
  parser.on("doctype", () => {
    throw new Error("Discovery XML must not contain a doctype");
  });
  parser.on("opentag", (node) => {
    stack.push(node);
    if (stack.length === 1) {
      if (node.uri !== namespace || !["urlset", "sitemapindex"].includes(node.local))
        throw new Error("Invalid sitemap root or namespace");
      root = node.local;
    }
    if (field) throw new Error("Sitemap field must contain text only");
    if (stack.length === 2) {
      if (node.uri !== namespace || node.local !== (root === "urlset" ? "url" : "sitemap"))
        throw new Error("Invalid sitemap entry");
      row = {};
    }
    if (
      stack.length === 3 &&
      row &&
      node.uri === namespace &&
      ["loc", "lastmod"].includes(node.local)
    ) {
      if (Object.hasOwn(row, node.local)) throw new Error("Duplicate sitemap field");
      field = node.local;
      row[field] = "";
    }
  });
  const append = (value) => {
    if (field) row[field] += value;
  };
  parser.on("text", append);
  parser.on("cdata", append);
  parser.on("closetag", () => {
    if (stack.length === 3) field = undefined;
    if (stack.length === 2 && row) {
      if (!row.loc?.trim()) throw new Error("Sitemap entry requires a location");
      rows.push({
        url: row.loc.trim(),
        lastmod: row.lastmod === undefined ? undefined : date(row.lastmod.trim()),
      });
      row = undefined;
    }
    stack.pop();
  });
  parser.write(xml).close();
  return { root, rows };
}

export async function readDiscoverySitemap(origin, sitemap, read) {
  origin = siteOrigin(origin);
  const visited = new Set();
  const rows = new Map();
  const visit = async (url) => {
    canonical(url, origin);
    if (visited.has(url)) throw new Error("Duplicate or cyclic discovery sitemap: " + url);
    visited.add(url);
    const parsed = sitemapEntries(await read(url));
    if (parsed.root === "sitemapindex") {
      for (const child of parsed.rows) await visit(child.url);
    } else {
      for (const entry of parsed.rows) {
        canonical(entry.url, origin);
        if (rows.has(entry.url)) throw new Error("Duplicate sitemap URL: " + entry.url);
        rows.set(entry.url, entry.lastmod);
      }
    }
  };
  await visit(canonical(sitemap, origin));
  return rows;
}

/** Deliberately bounded public-site profile, not a general robots exclusion parser. */
export function verifyDiscoveryRobots(text, sitemap) {
  let wildcard = false;
  let advertised = false;
  for (const line of text.split(/\r?\n/)) {
    const match = /^([^:]+):\s*(.*?)\s*$/.exec(line.split("#", 1)[0].trim());
    if (!match) continue;
    const name = match[1].trim().toLowerCase();
    const value = match[2];
    if (name === "user-agent" && value === "*") wildcard = true;
    if (name === "disallow" && value)
      throw new Error(
        "Discovery public-site profile requires unrestricted crawling; review robots rules",
      );
    if (name === "sitemap" && value === sitemap) advertised = true;
  }
  if (!wildcard || !advertised)
    throw new Error("robots.txt must declare wildcard access and the canonical sitemap");
}

export async function discoveryPage(document, readMedia) {
  if (!document.canonical || document.noindex)
    throw new Error("Discovery page must be an indexable canonical");
  const content = discoveryContent(document);
  const media = [];
  for (const url of discoveryMedia(document)) {
    const hash = await readMedia(url);
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("Invalid media digest: " + url);
    media.push({ url, sha256: hash });
  }
  return {
    url: document.canonical.href,
    lastmod: sitemapLastmod(document.published, document.modified),
    contentSha256: sha(JSON.stringify({ content, media })),
  };
}

export function createDiscoveryManifest({ origin, sitemap, pages }) {
  origin = siteOrigin(origin);
  canonical(sitemap, origin);
  const seen = new Set();
  const sorted = pages
    .map((page) => {
      const url = canonical(page.url, origin);
      if (seen.has(url)) throw new Error("Duplicate discovery page: " + url);
      seen.add(url);
      if (!/^[0-9a-f]{64}$/.test(page.contentSha256))
        throw new Error("Invalid content hash: " + url);
      const lastmod = page.lastmod === undefined ? undefined : date(page.lastmod);
      return {
        url,
        ...(lastmod === undefined ? {} : { lastmod }),
        contentSha256: page.contentSha256,
      };
    })
    .sort((a, b) => order(a.url, b.url));
  return { schemaVersion: 1, fingerprintVersion: 2, origin, sitemap, pages: sorted };
}

export function assertDiscoverySitemap(manifest, rows) {
  const expected = new Map(manifest.pages.map((page) => [page.url, page.lastmod]));
  for (const [url, lastmod] of rows) {
    if (!expected.has(url)) throw new Error("Unexpected sitemap URL: " + url);
    if (expected.get(url) !== lastmod) throw new Error("Sitemap lastmod mismatch: " + url);
  }
  for (const url of expected.keys())
    if (!rows.has(url)) throw new Error("Missing sitemap URL: " + url);
}

export function diffDiscoveryManifests(previous, current) {
  if (current?.schemaVersion !== 1 || (previous !== null && previous?.schemaVersion !== 1))
    throw new Error("Discovery requires versioned manifests (null for explicit bootstrap)");
  if (current.fingerprintVersion !== 2 || (previous && previous.fingerprintVersion !== 2))
    throw new Error(
      "Discovery fingerprint version changed; require an explicit baseline migration",
    );
  const next = createDiscoveryManifest(current);
  const old = previous === null ? null : createDiscoveryManifest(previous);
  if (old && old.origin !== next.origin) throw new Error("Discovery origins differ");
  const before = new Map((old?.pages ?? []).map((page) => [page.url, page]));
  const added = [],
    modified = [],
    removed = [],
    dateWarnings = [];
  for (const page of next.pages) {
    const prior = before.get(page.url);
    if (!prior) added.push(page.url);
    else {
      const changed = page.contentSha256 !== prior.contentSha256;
      if (changed || page.lastmod !== prior.lastmod) modified.push(page.url);
      if (
        changed &&
        (prior.lastmod !== undefined || page.lastmod !== undefined) &&
        (!page.lastmod || (prior.lastmod && page.lastmod <= prior.lastmod))
      )
        dateWarnings.push(page.url);
    }
    before.delete(page.url);
  }
  removed.push(...before.keys());
  return { added, modified, removed, dateWarnings };
}

async function get(fetcher, url) {
  return fetcher(url, {
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
}

async function body(fetcher, url, types) {
  const response = await get(fetcher, url);
  const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (response.status !== 200 || !types.includes(mime))
    throw new Error("Hosted discovery response mismatch: " + url + " (" + response.status + ")");
  if (
    /\b(?:noindex|none)\b/i.test(response.headers.get("x-robots-tag") ?? "") &&
    mime === "text/html"
  )
    throw new Error("Hosted canonical is noindex: " + url);
  return response.text();
}

/** Read-only production check. Fetch is injectable for deterministic qualification. */
export async function verifyHostedDiscovery(input, fetcher = fetch) {
  if (input?.schemaVersion !== 1 || input.fingerprintVersion !== 2)
    throw new Error("Unsupported discovery manifest or fingerprint version");
  const manifest = createDiscoveryManifest(input);
  const read = (url) => body(fetcher, url, ["application/xml", "text/xml"]);
  const robots = await body(fetcher, manifest.origin + "/robots.txt", ["text/plain"]);
  verifyDiscoveryRobots(robots, manifest.sitemap);
  assertDiscoverySitemap(
    manifest,
    await readDiscoverySitemap(manifest.origin, manifest.sitemap, read),
  );
  const media = new Map();
  const readMedia = (url) => {
    if (!media.has(url)) {
      media.set(
        url,
        (async () => {
          const response = await get(fetcher, url);
          if (response.status !== 200 || !response.body)
            throw new Error("Hosted discovery media unavailable: " + url);
          const hash = createHash("sha256");
          for await (const chunk of response.body) hash.update(chunk);
          return hash.digest("hex");
        })(),
      );
    }
    return media.get(url);
  };
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, manifest.pages.length) }, async () => {
      while (cursor < manifest.pages.length) {
        const page = manifest.pages[cursor++];
        const actual = await discoveryPage(
          readDocument(await body(fetcher, page.url, ["text/html"])),
          readMedia,
        );
        if (
          actual.url !== page.url ||
          actual.lastmod !== page.lastmod ||
          actual.contentSha256 !== page.contentSha256
        )
          throw new Error("Hosted discovery document differs from qualified manifest: " + page.url);
      }
    }),
  );
  return { origin: manifest.origin, pages: manifest.pages.length, sitemap: manifest.sitemap };
}

/** Explicit post-deployment operation. Does not persist/advance the caller's baseline. */
export async function submitIndexNow({ previous, current, key }, fetcher = fetch) {
  const delta = diffDiscoveryManifests(previous, current);
  const manifest = createDiscoveryManifest(current);
  const urls = [...delta.added, ...delta.modified, ...delta.removed].sort(order);
  if (!urls.length) return { ...delta, complete: true, batches: [] };
  if (!/^[A-Za-z0-9-]{8,128}$/.test(key ?? "")) throw new Error("Invalid IndexNow key");
  if (
    !manifest.origin.startsWith("https://") ||
    new URL(manifest.origin).hostname.endsWith(".pages.dev")
  )
    throw new Error("IndexNow requires a production HTTPS origin, not a Pages preview");
  await verifyHostedDiscovery(manifest, fetcher);
  for (const url of delta.removed) {
    const response = await get(fetcher, url);
    if ([404, 410].includes(response.status)) continue;
    if ([301, 308].includes(response.status) && response.headers.has("location")) {
      const target = new URL(response.headers.get("location"), url).href;
      // Only follow targets already accepted in this manifest. Cross-origin
      // migration targets require a separate deployment acceptance contract.
      if (target !== url && manifest.pages.some((page) => page.url === target)) continue;
      throw new Error("Removed URL has an unaccepted redirect destination: " + url);
    }
    if (response.status === 200) {
      const header = response.headers.get("x-robots-tag") ?? "";
      if (/\b(?:noindex|none)\b/i.test(header) || readDocument(await response.text()).noindex)
        continue;
    }
    throw new Error("Removed URL has not been retired in production: " + url);
  }
  const keyLocation = manifest.origin + "/" + key + ".txt";
  if ((await body(fetcher, keyLocation, ["text/plain"])).trim() !== key)
    throw new Error("IndexNow production key verification failed");
  const batches = [];
  for (let offset = 0; offset < urls.length; offset += 10000) {
    const urlList = urls.slice(offset, offset + 10000);
    let response;
    try {
      response = await fetcher("https://api.indexnow.org/indexnow", {
        method: "POST",
        redirect: "error",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ host: new URL(manifest.origin).host, key, keyLocation, urlList }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      batches.push({ urls: urlList, status: null, outcome: "retryable" });
      return { ...delta, complete: false, batches };
    }
    const status = response.status;
    const outcome =
      status === 200
        ? "acknowledged"
        : status === 202
          ? "key-pending"
          : status === 429 || status >= 500
            ? "retryable"
            : "rejected";
    const retryAfter = response.headers.get("retry-after");
    batches.push({ urls: urlList, status, outcome, ...(retryAfter ? { retryAfter } : {}) });
    if (outcome !== "acknowledged") return { ...delta, complete: false, batches };
  }
  return { ...delta, complete: true, batches };
}

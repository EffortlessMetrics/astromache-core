import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditPublication,
  buildPublication,
  diffDiscoveryManifests,
  sitemapLastmod,
  submitIndexNow,
  verifyHostedDiscovery,
} from "../packages/astromache/src/publishing/index.mjs";

const origin = "https://example.test";
const url = origin + "/article/";
const sitemap = origin + "/sitemap.xml";
const lastmod = "2026-11-01T00:00:00.000Z";
const robots = "User-agent: *\nAllow: /\nSitemap: " + sitemap + "\n";
const html = (content = "Exact text", date = lastmod, css = "a") =>
  '<html><head><title>Article</title><meta name="description" content="Exact">' +
  '<link rel="canonical" href="' +
  url +
  '"><meta property="article:published_time" content="' +
  date +
  '"><link rel="stylesheet" href="/' +
  css +
  '.css"></head><body><main>' +
  '<article data-article-body><p class="' +
  css +
  '">' +
  content +
  "</p></article></main></body></html>";
const xml = (date = lastmod) =>
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>' +
  url +
  "</loc>" +
  (date ? "<lastmod>" + date + "</lastmod>" : "") +
  "</url></urlset>";
const opts = {
  origin,
  sitemap: "sitemap.xml",
  markdown: false,
  discovery: { expectedRoutes: ["/article/"] },
};

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "discovery-"));
  try {
    await mkdir(join(root, "article"));
    await writeFile(join(root, "article/index.html"), html());
    await writeFile(join(root, "robots.txt"), robots);
    await writeFile(join(root, "sitemap.xml"), xml());
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("authored dates are normalized; invalid or reversed dates fail", () => {
  assert.equal(sitemapLastmod("2026-11-01"), lastmod);
  assert.equal(sitemapLastmod(undefined, undefined), undefined);
  assert.equal(
    sitemapLastmod("2026-11-01", "2026-11-02T00:00:00+00:00"),
    "2026-11-02T00:00:00.000Z",
  );
  for (const invalid of ["2026-02-30", "2026-11-01T12:00", "nonsense"])
    assert.throws(() => sitemapLastmod(invalid));
  assert.throws(() => sitemapLastmod("2026-11-02", "2026-11-01"));
});

test("build receipt reconciles sitemap membership, dates and robots", async () => {
  await fixture(async (root) => {
    const initial = (await auditPublication(root, opts)).discovery;
    assert.equal(initial.pages.length, 1);
    await writeFile(join(root, "article/index.html"), html("Exact text", lastmod, "b"));
    const restyled = (await auditPublication(root, opts)).discovery;
    assert.deepEqual(restyled, initial);
    await writeFile(join(root, "article/index.html"), html("Changed text"));
    const changed = (await auditPublication(root, opts)).discovery;
    assert.deepEqual(diffDiscoveryManifests(initial, changed), {
      added: [],
      modified: [url],
      removed: [],
      dateWarnings: [url],
    });
    await writeFile(join(root, "sitemap.xml"), xml(""));
    await assert.rejects(auditPublication(root, opts), /lastmod mismatch/);
    await writeFile(
      join(root, "sitemap.xml"),
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>',
    );
    await assert.rejects(auditPublication(root, opts), /Missing sitemap URL/);
    await writeFile(
      join(root, "article/index.html"),
      html().replace(/<link rel="canonical"[^>]+>/, ""),
    );
    await assert.rejects(auditPublication(root, opts), /Missing expected indexable canonical/);
    await writeFile(join(root, "article/index.html"), html("Changed text"));
    await writeFile(join(root, "sitemap.xml"), xml());
    await writeFile(join(root, "robots.txt"), robots + "Disallow: /article/\n");
    await assert.rejects(auditPublication(root, opts), /unrestricted crawling/);
    await writeFile(join(root, "robots.txt"), robots);
    const report = await buildPublication(root, opts);
    assert.deepEqual(report.discovery, changed);
    assert.deepEqual(JSON.parse(await readFile(join(root, "_meta/discovery.json"), "utf8")), changed);
  });
});

test("production notifications are gated on exact hosted content and key", async () => {
  await fixture(async (root) => {
    const current = (await auditPublication(root, opts)).discovery;
    let post = 0;
    let hosted = html();
    let apiStatus = 200;
    const response = (body, type, status = 200) =>
      new Response(body, { status, headers: { "content-type": type } });
    const fetcher = async (target, options) => {
      if (target === sitemap) return response(xml(), "application/xml");
      if (target === url) return response(hosted, "text/html");
      if (target === origin + "/robots.txt") return response(robots, "text/plain");
      if (target === origin + "/abcdef12.txt") return response("abcdef12", "text/plain");
      if (target === "https://api.indexnow.org/indexnow") {
        post++;
        assert.deepEqual(JSON.parse(options.body).urlList, [url]);
        if (apiStatus === 0) throw new Error("network failure");
        return new Response("", { status: apiStatus, headers: { "retry-after": "30" } });
      }
      throw new Error("Unexpected request: " + target);
    };
    assert.equal((await verifyHostedDiscovery(current, fetcher)).pages, 1);
    hosted = html("stale");
    await assert.rejects(
      submitIndexNow({ previous: null, current, key: "abcdef12" }, fetcher),
      /differs/,
    );
    assert.equal(post, 0);
    hosted = html();
    const input = { previous: null, current, key: "abcdef12" };
    assert.equal((await submitIndexNow(input, fetcher)).complete, true);
    apiStatus = 202;
    const pending = await submitIndexNow(input, fetcher);
    assert.equal(pending.complete, false);
    assert.equal(pending.batches[0].outcome, "key-pending");
    apiStatus = 429;
    const retry = await submitIndexNow(input, fetcher);
    assert.equal(retry.complete, false);
    assert.equal(retry.batches[0].outcome, "retryable");
    assert.equal(retry.batches[0].retryAfter, "30");
    apiStatus = 0;
    const interrupted = await submitIndexNow(input, fetcher);
    assert.equal(interrupted.complete, false);
    assert.equal(interrupted.batches[0].status, null);
    const noop = await submitIndexNow({ ...input, previous: current }, fetcher);
    assert.deepEqual(noop.batches, []);
    assert.equal(post, 4);
  });
});

test("discovery rejects malformed namespace and nested sitemap fields", async () => {
  await fixture(async (root) => {
    await writeFile(join(root, "sitemap.xml"), xml().replace("<url>", '<url xmlns="urn:wrong">'));
    await assert.rejects(auditPublication(root, opts), /Invalid sitemap entry/);
    await writeFile(
      join(root, "sitemap.xml"),
      xml().replace("<loc>", "<loc><nested>").replace("</loc>", "</nested></loc>"),
    );
    await assert.rejects(auditPublication(root, opts), /Sitemap field must contain text only/);
  });
});

test("discovery requires exact, independent and disjoint route policy", async () => {
  await fixture(async (root) => {
    for (const expectedRoutes of [
      undefined,
      ["/article/", "/article/"],
      ["/article/?q=1"],
      ["//other.example/article/"],
    ])
      await assert.rejects(
        auditPublication(root, { ...opts, discovery: { expectedRoutes } }),
        /requires exactly one|requires an array|Invalid or duplicate/,
      );
    await assert.rejects(
      auditPublication(root, {
        ...opts,
        discovery: { expectedRoutes: ["/article/"], excludePaths: ["/article/"] },
      }),
      /also excluded/,
    );
    await assert.rejects(
      auditPublication(root, { ...opts, discovery: { expectedRoutes: ["/missing/"] } }),
      /Unexpected indexable canonical/,
    );
  });
});

test("stable primary and responsive media bytes affect the fingerprint, not presentation", async () => {
  await fixture(async (root) => {
    const asset = "<img src='/figure.png' srcset='/figure.png 1x, /figure2.png 2x' alt='Diagram'>";
    await writeFile(join(root, "figure.png"), "first");
    await writeFile(join(root, "figure2.png"), "first responsive");
    await writeFile(join(root, "article/index.html"), html("Exact text" + asset));
    const before = (await auditPublication(root, opts)).discovery;
    await writeFile(join(root, "article/index.html"), html("<span class='highlight'>Exact</span> text" + asset));
    assert.deepEqual((await auditPublication(root, opts)).discovery, before);
    await writeFile(join(root, "figure2.png"), "revised responsive");
    const after = (await auditPublication(root, opts)).discovery;
    assert.deepEqual(diffDiscoveryManifests(before, after).modified, [url]);
    const fetcher = async (target) => {
      if (target === sitemap) return new Response(xml(), { headers: { "content-type": "application/xml" } });
      if (target === origin + "/robots.txt") return new Response(robots, { headers: { "content-type": "text/plain" } });
      if (target === url) return new Response(html("Exact text" + asset), { headers: { "content-type": "text/html" } });
      if (target === origin + "/figure.png") return new Response("first");
      if (target === origin + "/figure2.png") return new Response("revised responsive");
      throw new Error("Unexpected fetch: " + target);
    };
    await verifyHostedDiscovery(after, fetcher);
    await assert.rejects(verifyHostedDiscovery(before, fetcher), /differs/);
    await assert.rejects(auditPublication(root, { ...opts, discovery: { expectedRoutes: ["/article/"], expectedRoutesFile: "routes.json" } }), /exactly one/);
    await writeFile(join(root, "routes.json"), JSON.stringify(["/article/"]));
    assert.deepEqual((await auditPublication(root, { ...opts, discovery: { expectedRoutesFile: "routes.json" } })).discovery, after);
    await writeFile(join(root, "article/index.html"), html("<img src='/missing.png' alt='Missing'>"));
    await assert.rejects(auditPublication(root, opts), /Missing discovery media/);
    assert.throws(() => diffDiscoveryManifests({ ...before, fingerprintVersion: 1 }, after), /baseline migration/);
  });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
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
  '<link rel="canonical" href="' + url + '"><meta property="article:published_time" content="' +
  date + '"><link rel="stylesheet" href="/' + css + '.css"></head><body><main>' +
  '<article data-article-body><p class="' + css + '">' + content +
  "</p></article></main></body></html>";
const xml = (date = lastmod) =>
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>' +
  url + "</loc>" + (date ? "<lastmod>" + date + "</lastmod>" : "") + "</url></urlset>";
const opts = { origin, sitemap: "sitemap.xml", markdown: false, discovery: {} };

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
  assert.equal(sitemapLastmod("2026-11-01", "2026-11-02T00:00:00+00:00"), "2026-11-02T00:00:00.000Z");
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
      added: [], modified: [url], removed: [], dateWarnings: [url],
    });
    await writeFile(join(root, "sitemap.xml"), xml(""));
    await assert.rejects(auditPublication(root, opts), /lastmod mismatch/);
    await writeFile(join(root, "sitemap.xml"), '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>');
    await assert.rejects(auditPublication(root, opts), /Missing sitemap URL/);
    await writeFile(join(root, "sitemap.xml"), xml());
    await writeFile(join(root, "robots.txt"), robots + "Disallow: /article/\n");
    await assert.rejects(auditPublication(root, opts), /unrestricted crawling/);
    await writeFile(join(root, "robots.txt"), robots);
    const report = await buildPublication(root, opts);
    assert.deepEqual(report.discovery, changed);
  });
});

test("production notifications are gated on exact hosted content and key", async () => {
  await fixture(async (root) => {
    const current = (await auditPublication(root, opts)).discovery;
    let post = 0;
    let hosted = html();
    let apiStatus = 202;
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
        return response("", "text/plain", apiStatus);
      }
      throw new Error("Unexpected request: " + target);
    };
    assert.equal((await verifyHostedDiscovery(current, fetcher)).pages, 1);
    hosted = html("stale");
    await assert.rejects(submitIndexNow({ previous: null, current, key: "abcdef12" }, fetcher), /differs/);
    assert.equal(post, 0);
    hosted = html();
    const input = { previous: null, current, key: "abcdef12" };
    assert.equal((await submitIndexNow(input, fetcher)).complete, true);
    apiStatus = 429;
    assert.equal((await submitIndexNow(input, fetcher)).complete, false);
    const noop = await submitIndexNow({ ...input, previous: current }, fetcher);
    assert.deepEqual(noop.batches, []);
    assert.equal(post, 2);
  });
});

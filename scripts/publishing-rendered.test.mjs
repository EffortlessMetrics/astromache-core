import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  readDocument,
  renderedPublication,
  publicationText,
} from "../packages/astromache/src/publishing/rendered.mjs";
import staticPublication, {
  buildPublication,
  auditPublication,
} from "../packages/astromache/src/publishing/index.mjs";
const origin = "https://example.test";
const page = (body = "<p>Published &amp; precise.</p>", extra = "", alternate = true) =>
  `<!doctype html><html><head><title>Article</title><meta name="description" content="Description"><link rel="canonical" href="${origin}/article/"><meta property="og:type" content="article"><meta property="og:title" content="Article"><meta property="og:description" content="Description"><meta property="og:url" content="${origin}/article/">${alternate ? `<link rel="alternate" type="text/markdown" href="${origin}/_markdown/article.md">` : ""}${extra}</head><body><nav>CHROME</nav><h1>Article</h1><p data-publication-source>Original source.</p><article data-article-body>${body}</article></body></html>`;
const render = (body, extra) => renderedPublication(readDocument(page(body, extra))).markdown;

test("real HTML parser/converter preserves text, GFM tables, code, images and absolute links", () => {
  const md = render(
    '<h2 id="section">Section</h2><p>Exact <em>words</em> &amp; <strong>weight</strong>. <a href="../other/">Other</a></p><img src="/image.png" alt="A figure"><pre><code class="language-js">if (a &lt; b) {\n  run();\n}</code></pre><table><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody><tr><td>A</td><td>B</td></tr></tbody></table>',
  );
  assert.match(md, /## Section/);
  assert.match(md, /Exact \*words\* & \*\*weight\*\*/);
  assert.match(md, /https:\/\/example\.test\/other\//);
  assert.match(md, /!\[A figure\]\(https:\/\/example\.test\/image.png\)/);
  assert.match(md, /```js\nif \(a < b\)/);
  assert.match(md, /\| Key\s*\| Value/);
  assert.match(md, /Original source/);
  assert.doesNotMatch(md, /CHROME/);
});
for (const hidden of [
  "hidden",
  'aria-hidden="true"',
  'style="display:none"',
  "data-publication-exclude",
]) {
  test(`exclude ${hidden}, comments, scripts and template source`, () => {
    const html = page(
      `<p>Visible</p><aside ${hidden}>SECRET</aside><!-- SECRET --><script>SECRET</script><template>SECRET</template>`,
    );
    const document = readDocument(html);
    assert.doesNotMatch(renderedPublication(document).markdown, /SECRET/);
    assert.doesNotMatch(publicationText(document), /SECRET/);
    assert.throws(
      () =>
        renderedPublication(
          readDocument(
            html.replace("<article data-article-body>", `<article data-article-body ${hidden}>`),
          ),
        ),
      /visible publication body/,
    );
  });
}
test("hidden ancestor source is excluded, not unwrapped", () => {
  const html = page().replace(
    "<p data-publication-source>Original source.</p>",
    "<div hidden><p data-publication-source>SECRET</p></div>",
  );
  assert.doesNotMatch(renderedPublication(readDocument(html)).markdown, /SECRET/);
});
test("unsupported rich media requires an explicit textual representation", () => {
  assert.throws(() => render("<canvas>not a complete representation</canvas>"), /alternative/);
  assert.match(
    render('<canvas data-publication-text="Measured result">ignored</canvas>'),
    /Measured result/,
  );
  assert.match(
    render('<iframe src="https://video.example/watch" title="Talk recording"></iframe>'),
    /\[Talk recording\]/,
  );
  assert.throws(
    () => render('<iframe src="https://video.example/watch"></iframe>'),
    /accessible title/,
  );
});
test("metadata contradictions and dangerous links reject conversion", () => {
  assert.throws(() => render('<a href="javascript:alert(1)">bad</a>'), /protocol/);
  assert.throws(() => render('<img src="/image.png">'), /alt text/);
  assert.throws(() => render(undefined, '<meta name="robots" content="noindex">'), /noindex/);
  assert.throws(
    () => render(undefined, '<link rel="canonical" href="https://example.test/other/">'),
    /canonical/,
  );
  assert.throws(() => render(undefined, '<base href="https://other.test/">'), /base/);
});
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "publishing-test-"));
  try {
    await mkdir(join(root, "article"));
    await writeFile(join(root, "article/index.html"), page());
    await writeFile(
      join(root, "sitemap.xml"),
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/article/</loc></url></urlset>`,
    );
    await writeFile(
      join(root, "rss.xml"),
      `<rss version="2.0"><channel><item><link>${origin}/article/</link></item></channel></rss>`,
    );
    await writeFile(
      join(root, "search-index.json"),
      JSON.stringify({
        version: "old",
        data: [{ title: "Article", url: "/article/", text: "SOURCE COMMENT SECRET" }],
      }),
    );
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const options = {
  origin,
  sitemap: "sitemap.xml",
  feed: "rss.xml",
  searchIndex: "search-index.json",
  renderedSearch: true,
};
test("real output reconciliation writes Markdown/search without touching HTML", () =>
  fixture(async (root) => {
    const before = await readFile(join(root, "article/index.html"));
    const report = await buildPublication(root, options);
    assert.deepEqual(await readFile(join(root, "article/index.html")), before);
    assert.equal(report.documents.length, 1);
    const md = await readFile(join(root, "_markdown/article.md"), "utf8");
    assert.match(md, /Published & precise/);
    assert.equal(report.documents[0].sha256, createHash("sha256").update(md).digest("hex"));
    const search = await readFile(join(root, "search-index.json"), "utf8");
    assert.doesNotMatch(search, /SECRET/);
    assert.match(search, /Published & precise/);
    assert.notEqual(JSON.parse(search).version, "old");
    await assert.rejects(auditPublication(root, options), /collision|Stale/);
  }));
for (const [name, change, error] of [
  [
    "sitemap",
    async (root) =>
      writeFile(
        join(root, "sitemap.xml"),
        `<urlset><url><loc>${origin}/missing/</loc></url></urlset>`,
      ),
    /Sitemap URL/,
  ],
  [
    "RSS",
    async (root) =>
      writeFile(
        join(root, "rss.xml"),
        `<rss><channel><item><link>${origin}/missing/</link></item></channel></rss>`,
      ),
    /RSS URL/,
  ],
  [
    "search",
    async (root) => writeFile(join(root, "search-index.json"), '[{"url":"/missing/"}]'),
    /Search URL/,
  ],
  [
    "asset",
    async (root) =>
      writeFile(join(root, "article/index.html"), page('<img src="/missing.png" alt="Missing">')),
    /Missing publication asset/,
  ],
  [
    "orphan body",
    async (root) => writeFile(join(root, "article/index.html"), page(undefined, "", false)),
    /no Markdown alternate/,
  ],
])
  test(`reject ${name} before generating files`, () =>
    fixture(async (root) => {
      await change(root);
      await assert.rejects(buildPublication(root, options), error);
      await assert.rejects(readFile(join(root, "_markdown/article.md")), { code: "ENOENT" });
    }));
test("disabling Markdown permits HTML-only rich content and produces no alternates", () =>
  fixture(async (root) => {
    await writeFile(
      join(root, "article/index.html"),
      page("<canvas>Canvas fallback</canvas>", "", false),
    );
    const report = await buildPublication(root, { ...options, markdown: false });
    assert.equal(report.documents.length, 0);
    await assert.rejects(readFile(join(root, "_markdown/article.md")), { code: "ENOENT" });
  }));
test("symlinked output refuses escape", () =>
  fixture(async (root) => {
    await symlink(tmpdir(), join(root, "_markdown"), "dir");
    await assert.rejects(buildPublication(root, options), /symlink/i);
  }));
test("integration rejects hashing before publication and nonstatic mounting", () => {
  const hook = staticPublication({ origin }).hooks["astro:config:done"];
  const config = {
    output: "static",
    base: "/",
    site: origin,
    integrations: [
      { name: "astromache-static-publication" },
      { name: "astromache-static-offline" },
    ],
  };
  hook({ config });
  assert.throws(
    () => hook({ config: { ...config, integrations: [...config.integrations].reverse() } }),
    /before offline/,
  );
  assert.throws(() => hook({ config: { ...config, output: "server" } }), /static output/);
});

test("body links and fragments are checked against actual output", () =>
  fixture(async (root) => {
    await writeFile(
      join(root, "article/index.html"),
      page(
        '<h2 id="part">Part</h2><a href="#part">Good</a><a href="https://elsewhere.example/">External</a>',
      ),
    );
    await auditPublication(root, options);
    await writeFile(join(root, "article/index.html"), page('<a href="#missing">Bad fragment</a>'));
    await assert.rejects(auditPublication(root, options), /Missing publication fragment/);
    await writeFile(
      join(root, "article/index.html"),
      page('<a href="/unpublished/">Bad route</a>'),
    );
    await assert.rejects(auditPublication(root, options), /Missing publication link target/);
  }));

test("non-publication HTML does not require publication fields", () =>
  fixture(async (root) => {
    await writeFile(
      join(root, "verification.html"),
      "<html><head></head><body>Verification</body></html>",
    );
    await writeFile(
      join(root, "embed.html"),
      '<html><head><title>One</title><title>Two</title><meta name="description" content="One"><meta name="description" content="Two"></head><body>Embed</body></html>',
    );
    const report = await buildPublication(root, options);
    assert.equal(report.documents.length, 1);
    assert.equal(
      await readFile(join(root, "verification.html"), "utf8"),
      "<html><head></head><body>Verification</body></html>",
    );
  }));

test("an alternate without a canonical still rejects non-publication HTML", () =>
  fixture(async (root) => {
    await writeFile(
      join(root, "verification.html"),
      '<html><head><link rel="alternate" type="text/markdown" href="' +
        origin +
        '/_markdown/verification.md"></head><body>Verification</body></html>',
    );
    await assert.rejects(auditPublication(root, options), /alternate has no canonical/);
  }));

test("noindex redirect aliases preserve the indexable target canonical", () =>
  fixture(async (root) => {
    await mkdir(join(root, "old"));
    const redirect =
      '<html><head><title>Redirect</title><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=/article/"><link rel="canonical" href="' +
      origin +
      '/article/"></head><body><a href="/article/">Redirect</a></body></html>';
    await writeFile(join(root, "old/index.html"), redirect);
    const report = await buildPublication(root, options);
    assert.equal(report.documents.length, 1);
    assert.equal(report.html.length, 2);
    assert.equal(await readFile(join(root, "old/index.html"), "utf8"), redirect);
  }));

test("noindex-only canonicals are not discovery targets or Markdown publications", () =>
  fixture(async (root) => {
    await writeFile(
      join(root, "article/index.html"),
      page(undefined, '<meta name="robots" content="noindex">', false),
    );
    await assert.rejects(auditPublication(root, options), /noindex/);
    await writeFile(
      join(root, "article/index.html"),
      page(undefined, '<meta name="robots" content="noindex">'),
    );
    await assert.rejects(auditPublication(root, { origin }), /noindex/);
  }));

test("an indexable alias cannot advertise a noindex canonical destination", () =>
  fixture(async (root) => {
    await writeFile(
      join(root, "article/index.html"),
      page(undefined, '<meta name="robots" content="noindex">', false),
    );
    await mkdir(join(root, "alias"));
    await writeFile(join(root, "alias/index.html"), page(undefined, "", false));
    await assert.rejects(auditPublication(root, { ...options, markdown: false }), /noindex/);
  }));

test("canonical identity must belong to the actual served target", () =>
  fixture(async (root) => {
    await mkdir(join(root, "alias"));
    await writeFile(join(root, "alias/index.html"), page(undefined, "", false));
    for (const target of [
      '<html><head><meta name="robots" content="noindex"></head><body>Hidden target</body></html>',
      page(undefined, "", false).replace(
        'href="' + origin + '/article/"',
        'href="' + origin + '/alias/"',
      ),
    ]) {
      await writeFile(join(root, "article/index.html"), target);
      await assert.rejects(
        auditPublication(root, { ...options, markdown: false }),
        /Canonical target/,
      );
    }
  }));

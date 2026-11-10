import assert from "node:assert/strict";
import { test } from "node:test";
import { readDocument, renderedPublication, publicationText } from "../packages/astromache/src/publishing/rendered.mjs";
function document(body) {
  return readDocument(`<!doctype html><html><head><title>Article</title><meta name="description" content="Description"><link rel="canonical" href="https://example.test/article/"><meta property="og:type" content="article"><meta property="og:title" content="Article"><meta property="og:description" content="Description"><meta property="og:url" content="https://example.test/article/"><link rel="alternate" type="text/markdown" href="https://example.test/_markdown/article.md"></head><body><h1>Article</h1><article data-article-body>${body}</article></body></html>`);
}
test("Astro/Shiki code language on pre survives real conversion", () => {
  const md = renderedPublication(document('<pre class="astro-code github-dark" data-language="js"><code><span class="line"><span>if (a &lt; b) run();</span></span></code></pre>')).markdown;
  assert.match(md, /```js\nif \(a < b\) run\(\);/);
  assert.throws(() => renderedPublication(document('<pre data-language="js"><code class="language-rust">code</code></pre>')), /Conflicting code/);
});
test("complex tables do not silently lose row/column relationships", () => {
  assert.throws(() => renderedPublication(document('<table><tr><th colspan="2">Combined</th></tr><tr><td>A</td><td>B</td></tr></table>')), /Spanning table/);
});
test("search preserves words split by inline markup and separates blocks", () => {
  assert.equal(publicationText(document('<p>inter<em>nal</em> and <code>code</code>.</p><p>Next</p>')), "internal and code. Next");
});

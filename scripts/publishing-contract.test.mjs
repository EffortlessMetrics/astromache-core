import assert from "node:assert/strict";
import { test } from "node:test";
import {
  publicationHead,
  markdownURL,
  jsonForHTML,
} from "../packages/astromache/src/publishing/metadata.mjs";
import {
  prefersMarkdown,
  negotiateMarkdown,
} from "../packages/astromache/src/publishing/negotiation.mjs";
const input = {
  title: "A <title>",
  description: "Exact words",
  canonical: new URL("https://example.test/notes/a/"),
};

test("metadata preserves authored values and adds no invented identity", () => {
  const m = publicationHead(input);
  assert.equal(m.title, input.title);
  assert.equal(m.description, input.description);
  assert.equal(m.type, "website");
  assert.equal(m.author, undefined);
  assert.equal(m.structured, undefined);
  assert.equal(m.alternate, undefined);
});
test("article metadata and alternate derive from the same canonical", () => {
  const m = publicationHead({
    ...input,
    markdown: true,
    type: "article",
    author: { name: "Editor" },
    published: "2026-01-01T00:00:00Z",
  });
  assert.equal(m.alternate, "https://example.test/_markdown/notes/a.md");
  assert.equal(m.structured.url, input.canonical.href);
  assert.equal(m.structured.author.name, "Editor");
});
for (const canonical of [
  "javascript:alert(1)",
  "https://u:p@example.test/",
  "https://example.test/a?q=1",
  "https://example.test/a#",
  "/a",
]) {
  test(`reject unsafe canonical ${canonical}`, () =>
    assert.throws(() => publicationHead({ ...input, canonical })));
}
for (const field of ["title", "description"])
  for (const bad of [null, 3, "", " \n", "hello\u0000"]) {
    test(`reject ${field} ${JSON.stringify(bad)}`, () =>
      assert.throws(() => publicationHead({ ...input, [field]: bad })));
  }
test("dates, image requirements and JSON embedding", () => {
  assert.throws(() => publicationHead({ ...input, published: "not-a-date" }));
  assert.throws(() => publicationHead({ ...input, published: 0 }));
  assert.throws(() =>
    publicationHead({ ...input, published: "2026-01-02", modified: "2026-01-01" }),
  );
  assert.throws(() =>
    publicationHead({
      ...input,
      image: { url: "https://example.test/image.png", alt: "test", width: -1 },
    }),
  );
  assert.equal(JSON.parse(jsonForHTML({ x: "</script>\u2028" })).x, "</script>\u2028");
  assert.ok(!jsonForHTML({ x: "</script>" }).includes("<"));
  assert.equal(
    markdownURL("https://example.test/").href,
    "https://example.test/_markdown/index.md",
  );
});
for (const [header, expected] of [
  ["", false],
  ["*/*", false],
  ["text/html", false],
  ["text/markdown", true],
  ["text/markdown, text/html", false],
  ["text/markdown;q=0, */*;q=1", false],
  ["text/markdown;q=1,text/html;q=.5", false],
  ["text/markdown;q=0.8,text/html;q=0.2", true],
  ["text/markdown;q=0.5,text/*;q=0.8", false],
  ["text/markdown;q=2", false],
  ["text/markdown;q=NaN", false],
  ["text/markdown;q=0.001,text/html;q=0", true],
])
  test(`Accept ${header}`, () => assert.equal(prefersMarkdown(header), expected));

test("missing/error/wrong-type Markdown returns honest HTML, not fake Markdown", async () => {
  for (const mode of ["throw", "missing", "html"]) {
    let calls = 0;
    const response = await negotiateMarkdown(
      new Request("https://example.test/a/", { headers: { accept: "text/markdown" } }),
      async (request) => {
        calls++;
        if (new URL(request.url).pathname.startsWith("/_markdown/")) {
          if (mode === "throw") throw new Error("unavailable");
          return new Response("not markdown", {
            status: mode === "missing" ? 404 : 200,
            headers: { "content-type": "text/html" },
          });
        }
        return new Response("original HTML", {
          headers: { "content-type": "text/html", vary: "Accept-Encoding" },
        });
      },
    );
    assert.equal(calls, 2);
    assert.equal(await response.text(), "original HTML");
    assert.equal(response.headers.get("content-type"), "text/html");
    assert.equal(response.headers.get("vary"), "Accept-Encoding, Accept");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});
test("Markdown strips incompatible validators and HEAD has no body", async () => {
  const request = new Request("https://example.test/a/", {
    method: "HEAD",
    headers: { accept: "text/markdown", "if-none-match": "html-etag", range: "bytes=1-2" },
  });
  const response = await negotiateMarkdown(request, async (next) => {
    assert.equal(new URL(next.url).pathname, "/_markdown/a.md");
    assert.equal(next.headers.has("if-none-match"), false);
    assert.equal(next.headers.has("range"), false);
    return new Response(null, { headers: { "content-type": "text/markdown" } });
  });
  assert.equal(response.body, null);
});
test("authentication and non-read requests never take a fail-open alternate path", async () => {
  for (const options of [
    { method: "POST" },
    { headers: { authorization: "Bearer test" } },
    { headers: { cookie: "session=test" } },
  ]) {
    const headers = { accept: "text/markdown", ...options.headers };
    const response = await negotiateMarkdown(
      new Request("https://example.test/a", { ...options, headers }),
      async (request) => {
        assert.equal(new URL(request.url).pathname, "/a");
        return new Response("baseline");
      },
    );
    assert.equal(await response.text(), "baseline");
  }
});

test("HTML requests carry the same variant boundary as negotiated Markdown", async () => {
  let count = 0;
  const response = await negotiateMarkdown(
    new Request("https://example.test/a/", { headers: { accept: "text/html" } }),
    async (request) => {
      count++;
      assert.equal(new URL(request.url).pathname, "/a/");
      return new Response("HTML", {
        headers: { "content-type": "text/html", "cache-control": "public, max-age=3600" },
      });
    },
  );
  assert.equal(count, 1);
  assert.equal(response.headers.get("vary"), "Accept");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

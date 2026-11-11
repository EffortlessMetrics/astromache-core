# Static publication output

The publishing exports are part of `0.3.0`. Before registry publication is verified,
install the exact qualified archive and retain its SHA-256 receipt. This guide
does not authorize or establish consumer deployment.

## Enable the feature

```js
import { defineConfig } from "astro/config";
import publication from "astromache/static-publication";
import offline from "astromache/static-offline";

export default defineConfig({
  site: "https://publication.example",
  output: "static",
  integrations: [
    publication({
      origin: "https://publication.example",
      markdown: true,
      sitemap: "sitemap-index.xml",
      feed: "rss.xml",
      searchIndex: "search-index.json",
      renderedSearch: true,
    }),
    offline(/* retain the existing site-owned offline options */),
  ],
});
```

Omit `sitemap`, `feed` or `searchIndex` when the site does not produce that output.
The integration requires root-mounted static output and runs before offline
hashing. It does not add a server adapter, Worker, tracking, accounts or API.

Use `astromache/publication-head` inside your document's `head` slot. Existing
`astromache/document` still owns the HTML title, description, language and canonical;
replace manual social fields with this component rather than duplicating them.

```astro
---
import Document from "astromache/document";
import Head from "astromache/publication-head";
const canonical = new URL("/notes/example/", Astro.site);
const metadata = { title: "Example", description: "An example publication", canonical };
---
<Document {...metadata} language="en">
  <Head slot="head" {...metadata} type="article" markdown={true}
    author={{ name: "The publication's actual author" }}
    published={new Date("2026-01-01T00:00:00Z")} />
  <h1>Example</h1>
  <p data-publication-source>Actual source attribution, when applicable.</p>
  <article data-publication-body><p>Published content.</p></article>
</Document>
```

The existing `astromache/article` already marks its body with `data-article-body`.
A custom renderer can use `data-publication-body`. For a homepage or listing,
`Head body="main"` explicitly selects the document's single visible `main` region
and avoids duplicating its page heading. The default is `body="marked"`.
Exactly one visible body is
required for each advertised Markdown alternate. Structured talks, glossary
entries and other formats must include all intended public material inside that
body or an explicit `data-publication-source` attribution region. The library
cannot infer omitted application fields from private source files.

`Head` accepts optional `image: { url, alt, width?, height? }`, `modified`, and an
author URL. URLs must be absolute HTTP(S). It emits social metadata, the alternate
link, and an Article JSON-LD record when an actual author and publication date are
supplied. It does not invent a person, publisher, image, license or content-use grant.

## Generated files and fidelity

A page at `/notes/example/` advertises `/_markdown/notes/example.md`. The namespace
is reserved for generated output. `/` maps to `/_markdown/index.md`; conflicting
canonical paths are rejected instead of overwriting files. The Markdown contains
a title, canonical source link, supplied author/dates, attribution and rendered
body. Conversion is deterministic structural conversion, not model-generated prose.

The converter uses the actual compiled HTML and mature HAST/MDAST parsers. It
preserves basic Markdown structures, GFM tables, code text and Astro/Shiki language
labels. Relative links and image sources resolve against the canonical URL.
Same-origin images must exist in the build. Comments, scripts, templates, explicit
excluded regions and supported hidden attributes/inline styles are not exported.
A source frontmatter dump is never published.

This is not a browser CSS engine. Do not rely on stylesheet classes to keep
private information out of an alternate representation. Use the publication
selector to exclude private documents and `data-publication-exclude` for marked
non-publication UI. Material already emitted in HTML is not made private by
excluding it from Markdown. Do not use that attribute to conceal substantive
public evidence from the alternate format.

Spanning table cells, SVG, MathML, canvas, object and embed content need an explicit
`data-publication-text` alternative on their containing element, or a custom
publication-body adapter. Embedded video/audio/frame content requires a source
and accessible title and is represented as a link, not a transcript. Unsupported
content fails the build instead of silently inventing or discarding meaning.

## Output reconciliation

The build validates canonical targets; configured sitemap references and cycles;
RSS item links; search document URLs; alternate targets; output collisions; local
image references; internal body links and fragment targets; and integration order.
Host-served non-file routes can be declared explicitly in `externalRoutes`; no
route is exempt by default. It does not claim a universal SEO audit,
external-link availability check, CSS visibility analysis or accessibility certification.

`renderedSearch: true` replaces each search row's `text` with text from that row's
rendered body. Supported shapes are an array or `{ version, data: rows }`, where
rows have a canonical `url`. For the latter, the version is recomputed from the
updated rows. Other application-specific search schemas require an adapter; the
library does not reinterpret `body`, ranking or other fields.

`_meta/astromache-publication.json` records generated Markdown hashes and the HTML
hashes observed before offline hashing. HTML files are never rewritten by this
integration. The source selector remains the authority for drafts and publication
times; use the same selector for routes, listings, feeds, search and sitemaps.

Start with a clean build directory. Existing reserved output, symlinks and path
collisions are rejected without deleting consumer-owned files. A failed build
must not replace the last qualified deployment. The final directory and offline
worker are one deployment unit; do not mutate HTML after hashing.

## Disable without a runtime dependency

Set both the integration's `markdown` option and the matching `Head` props to
`false`; the starter ties these to one policy value. A clean build removes the
Markdown files and discovery links. Markdown-specific fidelity checks no longer
block HTML-only content. Other publication/discovery checks still apply.

Direct Markdown files and HTML are static assets. On Cloudflare Pages, retain the
site's HTML `no-transform` rules and add:

```text
/_markdown/*
  Content-Type: text/markdown; charset=utf-8
  X-Content-Type-Options: nosniff
```

The integration does not change the account's bot rules, usage permissions,
security controls or Function routing. Other hosts need equivalent MIME handling.
Do not enable generic catch-all rewrites to paths that were never generated.

## Optional same-URL negotiation

`astromache/markdown-negotiation` exports `prefersMarkdown(accept)` and
`negotiateMarkdown(request, fetchAsset)`. This adapter helper is separate from the
static integration and is not installed automatically. Mount it only on public
static content, and pass a direct static-asset fetcher, not a recursive request to
the same public Worker route. Never use it to replace authentication middleware.

An explicit higher Markdown preference requests the static alternate. Missing,
failed or wrongly typed alternate responses fall back to the ordinary page with
its actual content type. HTML and Markdown responses through the helper use
`Vary: Accept` and `private, no-store`; host-specific variant caching is not
assumed. Direct static URLs retain their ordinary caching policy. Authorization,
cookie, non-read and explicit Markdown-asset requests are delegated unchanged.

A JavaScript catch cannot handle quota exhaustion before code starts. Provider
quota bypass/fail-open therefore belongs in the host's routing configuration and
must be qualified there. Do not enable project-wide fail-open where Functions
enforce access control. Without that proof, serve the direct static alternatives
and keep HTML outside the optional runtime path.

## Qualification

`pnpm verify:publication:static` uses real parser libraries and negative fixtures.
`pnpm verify:publication:packed` installs the archive outside the repository,
compiles the actual Astro metadata component and content renderer, checks output
fidelity/exclusions/HTML hashes/offline inventory, and rebuilds with Markdown off.
Existing core qualification, packed-file allowlists and consumer-preservation
checks remain mandatory. A successful test is scoped to its recorded commit and
runtime; it does not prove the hosting configuration or authorize release.

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

## Opt-in search discovery

Set `discovery: { expectedRoutes: ["/", "/notes/example/"], excludePaths: ["/search/", "/offline/"] }`
alongside an existing `sitemap` option. The independent, consumer-owned expected
route inventory is required and must be derived before inspecting rendered HTML
or the sitemap. This prevents simultaneous omission from both outputs from
passing qualification. For dynamically selected content, alternatively set
`expectedRoutesFile: "routes.json"` to a build-emitted JSON array from the same
content selectors used by the routes (not a scan of sitemap or HTML output).
The two inventory inputs are mutually exclusive. Exclusions are consumer policy, not inferred SEO advice.
All other self-canonical HTML must be present, with no duplicate, foreign, redirected
or noindex destination. Supply an exact exclusion for utility pages that retain
indexable HTML intentionally; use noindex separately if they should not be indexed.
The initial robots profile is deliberately restricted to an unrestricted public
site with a wildcard user agent and its canonical Sitemap directive; restricted
crawl policies need a future policy adapter, not a silently incomplete parser.

Use `sitemapLastmod(entry.data.published, entry.data.modified)` to generate per-page
lastmod values. Existing consumers may pass their own field names. Emit the same
authored dates through the page's article:published_time and article:modified_time
metadata (including non-article dated content). Omit lastmod for undated pages.
Dates must carry a timezone or be date-only. Deployment time is not content time.

The receipt gains an optional `discovery` object, also emitted as `_meta/discovery.json`, containing the origin, sitemap and
sorted URL/date/content hash records. The fingerprint covers the marked rendered
body (or single main), headings, description, explicit attribution, social image
URL and JSON-LD excluding publication/modification dates. It omits styles and scripts
outside structured metadata. It is a bounded structural change detector, not a
semantic judgment: presentation markup can still change a fingerprint. Styling-only
inline wrappers and media dimensions/loading hints are normalized; code text,
authored links and semantic structure remain. Fingerprint version 2 includes
same-origin media bytes from primary source URLs, responsive sources, posters and
the social image. External assets are referenced but not fetched. Media served
through host-only transforms or non-file routes requires a separate adapter.
Build and hosted verification deduplicate reads of shared media. No private source
files are read. A changed fingerprint version requires explicit baseline migration.

After qualification, retain the discovery object from the exact artifact as the
candidate. Compare it against the last fully notified production manifest using
`diffDiscoveryManifests(previous, current)`; review `dateWarnings` before promotion.
These warnings do not mutate editorial dates. Pass null only for an intentional
first submission. Retain the previous manifest until notification is complete.

Call `verifyHostedDiscovery(current)` to verify public robots, XML, canonical HTML,
metadata and fingerprints. This is read-only and intentionally requires the
actual origin, not a preview alias. The separate `submitIndexNow({ previous, current,
key })` operation rechecks that production state, verifies retired URLs and the
root key file, and submits only deltas to the shared IndexNow endpoint in batches.
It never runs from the Astro build hook. HTTP 200 is acknowledged; HTTP 202 is
key-validation pending, 429/5xx or transport failure are retryable, and other
responses are rejected. Only fully acknowledged batches complete the operation.
Retry-After is retained if supplied. Receipt is not indexing. A retired URL may
redirect directly to another accepted same-origin canonical; unaccepted targets
(including cross-origin migrations) require a future release-acceptance adapter.
The release operator must retain receipts and retry without advancing the baseline
for unacknowledged URLs.
Do not enable a production notification trigger until the site's actual deployment
identity and durable baseline storage are configured. No Worker or account setting
is installed by this package.

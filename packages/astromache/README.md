# astromache 0.4.0-profile.2 — unpublished candidate

Reusable publication components and static publishing for Astro. Source: https://github.com/EffortlessMetrics/astromache-core. The small editable starter is https://github.com/EffortlessMetrics/astromache; real sites consume the libraries independently.

This version includes the publication foundation, the optional canonical offline preset, and `astromache/publication-head`, `astromache/static-publication` and `astromache/markdown-negotiation`. The [static publishing guide](STATIC-PUBLICATION.md) covers rendered-content Markdown, social metadata, output reconciliation and the optional host adapter. Static HTML remains independent of request-time compute, and the integration never rewrites emitted HTML.

The 0.4 candidate adds `astromache/profile`, a personal landing-page composition
using the existing publication style. It does not replace the publication
homepage or change any existing component, stylesheet or export.

The original npm 0.1.0 release and earlier unpublished archives remain immutable. A source version is not proof of registry publication; verify the release receipt before using a registry pin.

The foundation supplies real publication typography, responsive navigation, article presentation, cards, taxonomy lists, theme initialization/toggle, reading progress, focus mode, copy-link feedback, and gallery mechanics. The complete neutral starter and optional search/offline recipe consume these same exports. Content collection schemas, routes, dates, related-content selection, metadata policy, branding, font assets, privacy/share behavior, and search ranking remain consumer-owned.

## Added exports

- `astromache/publication`: document composition; metadata props match `document`; optional htmlAttributes, themeStorageKey (theme), themeToggleId (theme-toggle); head/header/footer/body-end/default slots.
- `astromache/profile`: page content for an identity/About, optional speaking, and follow-link landing page; title, links[{label,href,rel?}], speakingLabel (Speaking), followLabel (Follow me); portrait/default/speaking slots.
- `astromache/header`: brand, brandHref, links[{label,href,current?}], navigationLabel, itemsId, overlaySelector; menu-icon/close-icon/controls slots. One header per document.
- `astromache/footer`: label; social/default slots.
- `astromache/article`: title, published{datetime,label}, readingTime, lens/tags/related/previous/next links, backHref/backLabel, returnStorageKey, backId/topButtonId; source/actions/reading-tools/back-icon/date-icon/default slots. Consumers derive records; no collection dependency.
- `astromache/post-list`: items[{title,href,description}], headingLevel (2 or 3), optional pagination{current,total,previous,next}, returnStorageKey.
- `astromache/taxonomy-section`: label, href, id, items, itemHeadingLevel (2 or 3).
- `astromache/tag-list`: items[{label,href}], optional class (tag-list).
- `astromache/reading-progress`: wordsPerMinute (200), contentSelector (.post-content), indicatorId (reading-time), barId (myBar).
- `astromache/focus-mode`: toggleId (focus-mode-toggle), storageKey (focus-mode), bodyClass (focus-mode). Custom body classes need consumer styling.
- `astromache/copy-link`: url, text, class, resetMs (2000), copiedText, failedText.
- `astromache/reading-time`: readingTime(text, wordsPerMinute=200), formatReadingTime(minutes).
- `astromache/publication.css`: actual shared publication design; consumer font overrides are --publication-font-sans and --publication-font-mono. Consumers supply brand tokens, font files, and assets.
- `astromache/search.css`: generic search tokens/presentation; consumer Tailwind build directives and source paths remain consumer-owned.

Reading controls and theme/header controllers assume a single publication instance per document. Source exports compile with ordinary Astro 7.3.5 on Node >=24.19.0 <25; no compiler patch or Vite override is required. The publishing integration uses the parser/converter dependencies declared in package.json. It introduces no hosted service, private site content or automatic deployment.

## Document, navigation and gallery foundation

The original document, metadata, navigation, font and gallery exports remain supported alongside the publication and publishing additions. Site identity, routes, content policy, brand tokens, deployment and specialist integrations remain consumer-owned.

`astromache/portfolio` preserves the reusable photography presentation concept: a large-title hero, responsive gallery, image descriptions, and a keyboard-accessible native lightbox. Consumers supply images and their rights. The neutral example uses an original geometric SVG fixture under the owner code license; this package contains no personal photographs. One gallery instance per page is currently supported.

Owner-authored machinery is available under **MIT OR Apache-2.0**, at your option. Dependencies retain their own licenses.

Public templates may opt into `astromache/fonts.css` for unmodified IBM Plex Sans and IBM Plex Mono regular faces. Choose the families in consumer CSS. The package retains IBM's OFL notice and source hashes in `fonts/`; the neutral packed consumer exercises this import. The personal publication's fonts and identity remain consumer-owned.

## Publication and lifecycle contract

`document` accepts required title, description, absolute HTTP(S) canonical URL and BCP47 language, plus optional `htmlAttributes`. It renders `head`, `header`, default/main and `footer` slots. The document supplies semantic markup and skip navigation; consumers own CSS, identity, content, scripts and hosting. The document itself adds no client router, prefetch, tracking or worker.

```astro
---
import Document from "astromache/document";
---
<Document title="Example" description="Consumer-owned publication" canonical={new URL("https://example.com/")} language="en">
  <link slot="head" rel="stylesheet" href="/publication.css" />
  <nav slot="header">Consumer navigation</nav>
  <h1>Consumer content</h1>
  <footer slot="footer">Consumer attribution</footer>
</Document>
```

`portfolio` accepts title, description and an array of source/alt/title/medium/intent items; tools are optional. One gallery per document is supported because the native dialog uses fixed internal IDs. Opening any item replaces all labels/tool chips. Enter, Escape, close button, backdrop and repeated selection preserve native dialog focus return. Broken images retain their alt and an operable close path. Consumer CSS may set `--portfolio-background`, `--portfolio-foreground`, `--portfolio-border` and `--portfolio-focus`; Canvas/CanvasText/currentColor/Highlight are defaults. Styling is standalone CSS with no Tailwind requirement. Multiple galleries are not promised.

## Bounded native navigation policy

`navigation` exports `backgroundDownloadsAllowed(connection?, online = true)` and `installNavigationPrefetch(prefetch, options)`. Consumers inject Astro's native `prefetch` function; the module does not implement a second fetch/cache stack. Options are `maxTargets` (default 6, allowed 0-12), `delayMs` (default 120, allowed 0-2000) and an additional `include(URL)` restriction. Only debounced hover/focus intent triggers same-origin document targets, with per-document deduplication. API/share, query/hash, downloads, file targets and external links are excluded. Static public contact HTML is eligible: native HTML prefetch does not execute its CAPTCHA scripts or submit its form. A consumer may restrict that route with `include`. Offline, Save-Data, 2G/3G, downlink below 1.5Mbps and RTT at least 500ms suppress background requests. Missing connection hints use the bounded normal policy.

Enable native Astro prefetch with `prefetchAll:false`. Call the installer once; it returns a disposer. A consumer with ClientRouter must dispose/reinstall on its navigation lifecycle; static consumers initialize on direct document load. Consumers own worker scope/cache names, route allowlist, static manifest, byte/file budgets, online-only contact and the registration lifecycle. Gate explicit bulk registration with the same connection predicate, but existing browser-managed worker update checks are not fully controllable by application code. No persistent preferences, new storage permission, provider or analytics is introduced.

## Installation and runtime boundary

This source package requires Astro ^7.3.5 and an Astro-compatible TypeScript compiler/bundler. The metadata and navigation entry points ship TypeScript source, not precompiled JavaScript; plain Node consumers need TypeScript loading support. Navigation imports are safe during SSR and installation becomes a no-op without browser globals. Astro components are compiled by the consumer. Only the documented package export map is supported; no root export is provided.

See the repository release checklist before proposing a public version.

## Profile landing page

Use `Profile` inside the existing `Publication` or `Document` layout. It supplies
one H1 in `#about`, an optional H2 section in `#speaking` when that slot exists,
and an optional H2 section in `#follow` when links are supplied. Omitted portrait,
speaking and link inputs do not leave empty wrappers or headings. One profile
instance per document is supported; `profile-title`, `profile-speaking-title`
and `profile-follow-title` are reserved heading IDs.

`portraitLayout="flow"` opts into biography text flowing around a left portrait.
The default `"grid"` retains the stacked mobile and side-by-side desktop layout.
The flow portrait is capped at 12rem, with 40% width on viewports up to 380px;
the consumer supplies the image and its alternative text.

```astro
---
import Publication from "astromache/publication";
import Profile from "astromache/profile";
import "astromache/publication.css";
---
<Publication title="Example author" description="About, talks and profile links" canonical={new URL("https://example.com/")} language="en">
  <Profile title="Example author" links={[{label: "Profile", href: "https://profiles.example/person/", rel: "me"}]}>
    <img slot="portrait" src="/portrait.jpg" alt="Example author" width="192" height="192" />
    <p>Consumer-authored biography.</p>
    <Fragment slot="speaking"><a href="/speaking/">Talks and recordings</a></Fragment>
  </Profile>
</Publication>
```

`title`, labels and link text must contain non-whitespace text. Runtime validation
rejects malformed link records and ambiguous destinations. Links accept explicit
HTTP(S) URLs without credentials, root-relative paths and fragments; schemes such
as `javascript:`, protocol-relative URLs, backslashes and control characters are
rejected. `rel` is optional and supplied by the consumer: the library does not
infer identity, add `me`, or open new tabs. Authored strings and valid URLs are
preserved rather than rewritten. Contact forms or other destinations can be
composed in the consumer-owned About or speaking slots.

The component adds only scoped layout CSS. Existing publication typography,
colors, fonts, theme controls and navigation remain in the selected layout.
The portrait stacks above the biography below 640px; wider layouts use a bounded
12rem portrait column. Page metadata, Person schema, content collections, records,
profile links and image rights remain consumer-owned. The component emits no
JavaScript, tracker, storage, worker or publication/article discovery surface.

## Install and supported toolchain

This 0.4 prerelease is an unpublished candidate: install its exact reviewed archive and retain its SHA-256 receipt. Use a registry pin only after the corresponding publication has been independently verified. Node >=24.19.0 <25 is the supported build runtime; Astro 7.3.5 is the qualified peer version. The broader declared Astro ^7.3.5 range is not exhaustively tested. Ordinary Astro compilation does not require this repository's native-TS7 qualification patch or Vite+ override.

Do not import private paths. Preserve the prior archive and lockfile for consumer rollback. Release candidates are identified by commit and archive SHA-256.

## Canonical static offline preset

The optional export astromache/static-offline returns an Astro build integration. Supply offline library options (cache prefix, resource and byte budgets, worker navigation/query/exclusion policy), plus optional excludedPages listing canonical directory URLs redirected by your host. It generates canonical directory precache URLs, preserves root 404.html and emits the same bytes at /404/, excludes raw HTML redirect URLs, and writes offline-receipt.json by default. Set receiptFile to use a custom receipt filename; the specialist generator excludes that receipt and the configured worker from subsequent corpus scans. Receipt names must be root .json filenames of at most 255 ASCII bytes, starting with a letter or digit and containing only letters, digits, dots, underscores or hyphens. Paths, glob characters and Windows device names fail during configuration. Public asset filename collisions also fail during configuration, including case aliases and custom public directories. Before writing a worker or copying 404 output, the preset refuses any existing receipt destination unless it is a regular, unlinked receipt whose schema, revision and ordered URLs match its regular, unlinked generated worker. This preserves unrelated output on collision while allowing legitimate retained receipts to rebuild after content or policy changes. Existing worker destinations must be regular and unlinked even when the receipt is new. Changing workerFile or receiptFile on retained output requires removing the prior generated files or using a clean output directory. Preflight scans all root JavaScript workers for the backend signature independently of receipt filenames, including orphaned workers; another generated worker or a matching extra receipt is rejected before any preset writes. A copy of a genuine matching receipt is ambiguous and requires cleanup. Unrelated JSON and JavaScript assets remain eligible for caching; nested subsite workers are outside this root artifact check. This keeps generated receipts separate from workers and HTML pages and gives portable literal-file exclusions on retained-output rebuilds. The specialist package still owns integrity, caching and lifecycle. This export requires the optional peer @effortlessmetrics/astro-offline >=0.1.4 <0.2.0. Existing exports/imports remain unchanged.

This preset requires Astro base: "/" and build.format: "directory" (the defaults). Non-root bases and other output formats fail during Astro configuration, before pages or a worker are emitted. The pinned offline backend resolves corpus URLs from the host root, and the preset discovers index.html directory pages; it does not promise subpath or file-output support. Keep existing site routing and hosting decisions deliberately when adopting this optional preset.

The optional offline peer is independently owned and released. Use its exact qualified archive until its registry availability is verified; installing astromache alone does not install the optional peer. Selected HTML must be served without rewriting or redirects; no-transform headers alone are not deployed verification. Consumer hosting acceptance and deployment remain separate from this library release.

For a fallback present in the generated directory corpus, `/offline`, `/offline/` and `/offline/index.html` resolve to the same `/offline/` cache entry. Other fallback values remain literal, including filenames such as `/myindex.html`, external URLs and query-bearing values. This preset does not expand the specialist worker's fallback/query or exclusion policy.

Canonical page discovery uses the host filesystem separator. On POSIX, directory names containing a literal backslash are rejected before preset writes because browsers normalize backslashes in URLs. Rename those directories before building. A file named `asset\index.html` on POSIX is an ordinary file, not a directory page. Native Windows nested directories continue to use canonical slash-separated URLs.

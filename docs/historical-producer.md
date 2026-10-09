# Historical producer documentation

This records the preceding branded producer and its unchanged fixture/archive identities. Current ownership and candidate versions are in the root README.

# AstroMache publication system

For a small independent project without copying the producer development tree, see [standalone starter delivery](docs/starter-delivery.md). Run `node scripts/create-starter.mjs publication ../my-publication` or choose `search-offline` for the optional recipe; no producer installation is required.

The current source expands the genuine reusable publication foundation and complete neutral starter: article/list/taxonomy typography and composition, responsive menu/theme, reading progress/focus/copy controls, and the existing native gallery/navigation machinery. The private personal site and neutral products are sibling consumers of the same exports. Content models, corpus, routes, ranking, metadata policy, fonts, assets, privacy-specific sharing and brand tokens remain adapters.

This working **unpublished astromache 0.2.0 candidate** is distinct from immutable published npm 0.1.0. Its exact package source is 0504061d9292252f65336c9b90b1a63a04816d33 and archive SHA-256 is 53bf0fa41d2371c5941fa1422ae83563002744bd684e45c7b048b548d2182874. Never replace the registry version with these different bytes. See packages/astromache/README.md for the expanded API and release distinction.

starters/publication is a complete independently installed neutral publication: two original articles, index, taxonomy, responsive theme/navigation, gallery, 404, RSS, robots and sitemap. recipes/search-offline adds shared static-search lifecycle and bounded Workbox offline support while preserving consumer-owned renderer, schema, engine and corpus policy. Neither real site depends on a starter artifact.

Qualification includes compiler/packed allowlist/native-gallery checks, both offline claim policies and client disposal contracts, and clean frozen independent starter/recipe builds with real keyboard/article/reading/gallery and online/fresh offline search/navigation checks. These tests do not publish packages or deploy websites.

## Original published snapshot reference

The following documents the narrower original release. Candidate APIs and complete product scope above supersede its preparation descriptions.

# AstroMache

AstroMache is intended to become a reusable publication template product. This 0.1.0 npm candidate supplies its extracted Astro publication machinery; the small initial starter lives separately in `starters/publication`. Site identity, routes, content, styling, deployment and independently versioned integrations belong to consumers.

`astromache/portfolio` preserves the reusable photography presentation concept: a large-title hero, responsive gallery, image descriptions, and a keyboard-accessible native lightbox. Consumers supply images and their rights. The neutral example uses an original geometric SVG fixture under the owner code license; this package contains no personal photographs. One gallery instance per page is currently supported.

The original narrower 0.1.0 is published and immutable. This expanded 0.2.0 working candidate is unpublished and must be installed by exact archive. The neutral fixture proves component integration; the separate complete `starters/publication` uses the same foundation as sibling publications.

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

## Install and supported toolchain

After registry publication, install with `pnpm add astromache@0.1.0 astro@^7.3.5`. Before publication, install the reviewed archive path instead. Node >=24.19.0 <25 is the supported build runtime; Astro 7.3.5 is the qualified peer version. The broader declared Astro ^7.3.5 range is not exhaustively tested. Ordinary Astro compilation does not require this repository's native-TS7 qualification patch or Vite+ override.

Do not import private paths. Preserve the prior archive and lockfile for consumer rollback. Release candidates are identified by commit and archive SHA-256.

For a new independent consumer, copy the reviewed `astromache-0.2.0.tgz` into the `vendor` directory of that consumer project. From that consumer project directory, run `pnpm add ./vendor/astromache-0.2.0.tgz astro@7.3.5`. In either provided starter/recipe directory, use its existing exact pin with `pnpm install --frozen-lockfile`. The repository workflow runs on pull requests and pushes to main, checking the actual event SHA; it never publishes packages or deploys websites. Final candidate source commits use no CI skip marker.

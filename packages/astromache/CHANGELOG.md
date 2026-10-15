# 0.2.11 (unpublished)

Resolve slashless navigation fallbacks against the generated directory corpus. Preserve literal filenames ending in `index.html` unless the final path segment is exactly `index.html`. Add focused generated-worker route recovery controls without modifying preserved archives or consumer content.

# 0.2.10 (unpublished)

Detect retained generated workers independently of the newly configured filenames before any preset writes. Renaming workerFile, receiptFile or both requires removing prior generated files or using clean output; orphaned workers and extra matching receipts cannot silently enter the corpus. Same-pair retained rebuilds still allow content, cache-prefix and policy changes, and unrelated receipt-shaped JSON and JavaScript assets remain eligible. Preserve the prior 0.2.9 archive as superseded evidence of the rename bypass.

# 0.2.9 (unpublished, superseded)

Reject receipt filenames longer than 255 ASCII bytes during configuration. Detect public asset collisions before output and preflight existing receipt destinations before any preset writes. Retained receipts must match their regular, unlinked generated worker's revision and ordered corpus; unrelated assets, case aliases and linked files are refused without changing output. Legitimate retained receipts still support changed content and worker policy. Existing worker destinations are checked even for new receipts; changing workerFile on retained output requires a clean output directory. The prior 0.2.8 archive remains historical evidence and is superseded by this repair.

# 0.2.8 (unpublished, superseded)

Honor the public static-offline receiptFile override while keeping offline-receipt.json as the default. Require portable root JSON receipt names so receipts cannot overwrite workers or HTML pages or act as ignore globs. Reject non-root Astro base paths and non-directory build formats during configuration, before rendering or writing a worker. The canonical directory preset and its pinned specialist backend support root-mounted directory URLs; unsupported output must not silently yield an unusable offline corpus. Independent packed Astro consumers cover all three configuration contracts, rejected receipt names, retained-output rebuilds and unchanged default policy.

# 0.2.7 (unpublished)

Align article actions by their text baselines so direct and nested native buttons retain equal intrinsic heights. Preserve existing control styling, responsive wrapping and adjacent-post navigation. Compiled desktop, mobile and forced-wrap geometry regressions cover actual Article/CopyLink components and keyboard Back-to-top behavior.

# 0.2.6 (unpublished)

Check every matching overlay before the navigation menu handles Escape or Tab. A later active dialog keeps keyboard ownership when an earlier mounted dialog is closed. Ten compiled interaction/theme browser regressions cover the final runtime candidate.

# 0.2.5 (unpublished)

Synchronize native control color schemes with the selected publication theme, including saved theme and toggles. Neutral producer adapters route categories alongside tags and reject empty or colliding URL slugs. Nine compiled interaction/theme browser cases and real taxonomy builds guard these repairs. Generated applications remain UNLICENSED; upstream template code retains MIT OR Apache-2.0 notices.

# 0.2.4 (unpublished)

Count empty/whitespace-only reading content as zero words; preserve normal progress behavior. Correct supported export documentation. Seven compiled interaction/progress browser regressions cover this release.

# 0.2.3 (unpublished)

Preserve listing query parameters in Article return navigation. Let mounted closed overlays release mobile menu Escape/Tab handling; active overlays retain keyboard ownership. Four compiled browser regressions verify these repairs.

# 0.2.2 (unpublished)

Move package ownership metadata to EffortlessMetrics/astromache-core. Preserve npm identity and existing runtime/API contracts.

# Local candidate 0.2.1

- Add canonical static offline setup through ./static-offline, delegating worker mechanics to the specialist library.
- Preserve existing exports, runtime, fonts and licensing.
- No registry publication or repository relocation has occurred.

## 0.2.0 — unpublished publication foundation candidate

Additive 0.2.0 candidate; immutable published 0.1.0 is preserved. Adds the actual shared publication layout/theme, responsive header/footer, article/list/taxonomy/tag presentation, portable typography/search CSS, reading progress, focus mode, copy-link controls, and generic reading-time helper. Consumers own content schemas, routes, dates, metadata, ranking, privacy-specific sharing, font files and branding. The candidate has a new minor-version identity; no registry publication is part of this change.

# Changelog

## 0.1.0 — first release candidate

- Semantic Astro document shell with validated publication metadata.
- Bounded native Astro navigation-prefetch helpers; browser installation is safe to call during SSR.
- Single-gallery portfolio with native accessible lightbox and consumer-supplied images.
- Optional unmodified IBM Plex Sans and Mono regular fonts with OFL provenance.
- Five explicit source subpath exports, MIT OR Apache-2.0 owner-code licensing, and shipped API/toolchain documentation.

This candidate is prepared for review and is not yet published. It is the component-machinery package within the intended AstroMache publication-template product; the complete starter is not shipped in this version.

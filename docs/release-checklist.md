# Preserved producer regression variant

The archive pins and product paths below describe retained historical regression fixtures. Current package ownership/version is in the root README; the branded astromache repository is the small default starter with offline and intent prefetch enabled. These historical archives are not the current relocation candidate.

# Release candidate procedure

The next archive is prepared for npm review. Preparation and dry-run checks do not authorize registry publication.

## Supported contract

The immutable published 0.1.0 snapshot exports document, metadata, navigation, fonts.css and portfolio. The unpublished 0.2.0 candidate has 18 subpaths: those five plus publication, header, footer, article, post-list, taxonomy-section, tag-list, reading-progress, focus-mode, copy-link, reading-time, publication.css and search.css. Astro components and TypeScript modules remain source for the consumer compiler/bundler. No root export or precompiled JavaScript entry is promised. Astro ^7.3.5 is the peer range; exact 7.3.5 is qualified. Node 24.19.x is the qualified build runtime. The shared foundation owns actual publication structure, typography and reading mechanics. Consumers own site identity, routes, brand/font tokens, content models, metadata policy, deployment, search ranking/presentation policy, contact and offline corpus policy. One gallery per page is supported.

## Immutable candidate

1. Run pnpm qualify and pnpm verify:packed on the final source. Inspect the exact archive file allowlist, license texts, font source hashes and shipped README/API agreement.
2. Record commit, archive filename, SHA-256 and npm dry-run inventory. Preserve the reviewed archive; do not repack after acceptance or publish different bytes under that version.
3. Execute npm publish <absolute-reviewed-tarball> --dry-run --access public --ignore-scripts. This checks package inventory locally; it does not publish or prove registry credentials.
4. Registry publication requires a separate explicit authorization. The corresponding release command is npm publish <absolute-reviewed-tarball> --access public --ignore-scripts. Run it only for the exact accepted archive after that authorization. No automatic publication workflow exists.

## Version and consumer lifecycle

Before 1.0, breaking public exports, props, behavior or peer requirements require a minor version and conspicuous breaking notes. Compatible fixes use a patch version. A substantial additive exported foundation uses a minor version to identify the enlarged API surface. A future 1.0 adopts ordinary semantic versioning. No stability promise is inferred for unexported paths or unqualified toolchains.

Each consumer upgrade records old/new commit and archive hashes, relevant interface changes and local acceptance. Preserve the old archive and lockfile. Restore those exact pins with frozen installation and repeat affected checks to demonstrate rollback. Production rollback remains the consumer's separate operation.

The independent starters/publication project supplies a complete neutral publication with article/index/taxonomy routes, responsive shared typography/theme/navigation/reading mechanics, gallery, 404, RSS, robots and sitemap. recipes/search-offline adds optional static search and offline reading by consuming sibling packages directly. Real sites remain direct sibling package consumers. The expanded unpublished candidate exports generic publication presentation and reading mechanics; feed generation, content schemas, branding and metadata policies remain consumer-owned. Universal publication diagnostics are not an implemented export.

## Actual source CI

The repository qualification workflow runs for pull requests to main and pushes to main. Checkout uses the exact PR head or push SHA. Keep existing Linux/Windows runners and read-only permissions. Final release-preparation source must not use CI skip markers. Record actual workflow links and results for the final PR source and landed main; local qualification does not substitute for this execution. No package publication or deployment step exists.

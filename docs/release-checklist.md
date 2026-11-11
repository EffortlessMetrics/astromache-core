# AstroMache release procedure

The core repository owns the public npm package `astromache`. The additive publication and static-publishing API is prepared as version `0.3.0`; the intended stable npm channel is `latest`. Preparation and dry runs do not establish registry publication. Previously published versions and historical candidate archives are immutable.

## Supported contract

Version 0.3.0 has 22 explicit source subpaths. Components and TypeScript modules remain source for the consumer compiler/bundler; no root export or precompiled JavaScript entry is promised. Astro ^7.3.5 is the peer range, with exact 7.3.5 qualified on Node 24.19.x. The optional offline peer is independently owned and released. The package does not include private content, starter branding, deployment configuration or automatic hosting changes. See the shipped README and static publishing guide for the supported contracts.

## Immutable release archive

1. Reconcile current ownership, applicable reviews and holds. Run `pnpm qualify`, `pnpm verify:packed` and the normal qualification workflow's browser, offline, installed static-publication and full-consumer checks on the final source. Preserve required checks and platform coverage.
2. Inspect the exact packed-file allowlist, both license texts, font provenance and the shipped README/API agreement. Freeze the reviewed archive. Record source commit/tree, filename, size, SHA-256, npm integrity and dry-run inventory in the release receipt. Do not repack after acceptance or publish different bytes under that version.
3. Run `npm publish <absolute-reviewed-tarball> --dry-run --access public --ignore-scripts --tag latest`. This checks inventory locally; it neither publishes nor proves authentication.
4. Registry publication requires explicit user authorization. Once authorized and qualified, verify the existing npm account/package access and that the version remains unpublished. Run `npm publish <absolute-reviewed-tarball> --access public --ignore-scripts --tag latest`. Preserve account security and complete any required user authentication separately. No automatic publication workflow exists.
5. Fetch the published version metadata and tarball independently. Verify the downloaded archive against the accepted SHA-256 and registry integrity, confirm `latest` points to the intended version, and exercise an exact registry install in an independent consumer before reporting publication complete.
6. Upgrade the branded starter independently with its exact archive/registry pin, lockfile, delivery provenance and retained rollback artifacts. Do not replace its routes, content, styles or specialist dependencies. Consumer production deployment remains a separate operation.

## Version and consumer lifecycle

Before 1.0, breaking public exports, props, behavior or peer requirements require a minor version and conspicuous breaking notes. Compatible fixes use a patch version. A substantial additive exported foundation uses a minor version to identify the enlarged API surface. A future 1.0 adopts ordinary semantic versioning. No stability promise is inferred for unexported paths or unqualified toolchains.

Each consumer upgrade records old/new commit and archive hashes, relevant interface changes and local acceptance. Preserve the old archive and lockfile. Restore those exact pins with frozen installation and repeat affected checks to demonstrate rollback. Production rollback remains the consumer's separate operation.

## Actual source CI

The repository qualification workflow runs for pull requests to main and pushes to main. Checkout uses the exact PR head or push SHA. Keep existing Linux/Windows runners and read-only permissions. Final release-preparation source must not use CI skip markers. Record actual workflow links and results for the final PR source and landed main; local qualification does not substitute for this execution. No package publication or deployment step exists.

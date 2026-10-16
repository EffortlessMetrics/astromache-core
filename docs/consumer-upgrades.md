# Upgrade an existing consumer

Keep your application's routes, content, configuration and license decisions. Upgrade its library dependencies; copying a new starter over an existing application is not required. The public core owns the `astromache` package identity. Historical exported fixtures retain their original pins and are not current release instructions.

## Choose verified bytes

As checked on 2026-10-10, npm exposes only `astromache@0.1.0`; the current `0.2.13` candidate is unpublished, and `@effortlessmetrics/astro-offline` is unavailable from the public registry. Obtain the exact accepted archives and receipts from the maintainer, verify their SHA-256 values, and retain the previous archives, manifest and lockfile. Never replace different bytes under an existing archive filename/version. A source checkout alone is not an accepted package receipt.

Use Node `>=24.19.0 <25`; Node 24.19.x and Astro **7.3.5** are qualified. The declared Astro `^7.3.5` peer range does not mean every version has been tested. Use your existing package manager; pnpm 10.28.0 is qualified for the supplied publication starter. Consumer builds do not require the producer's compiler patches or tooling overrides.

For a pnpm consumer, copy the accepted archive into its own `vendor/` directory, then run:

```sh
pnpm add ./vendor/astromache-0.2.13.tgz astro@7.3.5 --save-exact --ignore-scripts
pnpm install --frozen-lockfile --ignore-scripts
```

For an npm consumer, use:

```sh
npm install ./vendor/astromache-0.2.13.tgz astro@7.3.5 --save-exact --ignore-scripts
npm ci --ignore-scripts
```

The first command updates the dependency pin and lockfile. Review both together; keep active archives with the project so fresh installation resolves the same bytes. Run the consumer's type checks, build and affected browser checks after the frozen reinstall. Review any dependencies that require separately authorized installation scripts.

### Branded starter delivery metadata

The current [branded publication starter](https://github.com/EffortlessMetrics/astromache#upgrading-shared-libraries) also owns delivery inventories. Its `build` script runs `scripts/verify-licenses.mjs --emit-output`, which checks the active bundled path, archive hash and installed version against `STARTER-DELIVERY.json`. A successful dependency update and frozen reinstall alone can still leave the build failing with `astromache delivery pin` if that receipt names the previous archive.

For a bundled `astromache` upgrade in that starter, before qualification:

- Update `STARTER-DELIVERY.json`'s `archives.astromache` entry with the accepted archive's `file`, `version` and `sha256`, and its `sourceCommits["astromache-core"]` with the accepted source identity.
- Align the active version, hash and source provenance in `candidate-artifacts.json`; retain the previous entry and archive as the rollback choice. Update only the library being upgraded, leaving independent specialist receipts unchanged.
- Run `pnpm verify:licenses`, `pnpm test:licenses` and `pnpm qualify` after the frozen reinstall. Record acceptance only for checks actually run against the new delivery; prior acceptance fields do not qualify new bytes.

These files belong to the application, outside the core package. Ordinary consumers without these inventories do not need to create them. For a confirmed exact registry upgrade, follow the starter's registry instructions: its guard binds the exact pin to the installed name/version and leaves historical bundled receipts unchanged. Core historical export fixtures use different receipt schemas and are not replacement inventories for the branded starter.

The optional peer `@effortlessmetrics/astro-offline >=0.1.4 <0.2.0` is required when importing `astromache/static-offline`. Existing document, metadata, navigation, gallery and publication component imports do not require it. The canonical preset requires root-mounted Astro base: "/" and build.format: "directory"; incompatible settings now fail during configuration instead of emitting a broken worker. Preserve existing hosting and output decisions when selecting this optional preset. Its public receiptFile option is honored, with offline-receipt.json remaining the default. Use a root .json filename of at most 255 ASCII bytes starting with a letter or digit and containing only letters, digits, dots, underscores or hyphens; paths, glob characters and Windows device names are rejected during configuration. A public asset using that filename or a case alias is rejected before output; an existing output destination is reusable only when its receipt matches the paired generated worker. A rejected collision leaves the preset output untouched. Changing workerFile or receiptFile on retained output requires removing the prior generated files or using a clean output directory; same-filename workers can rebuild after content, cache-prefix or policy changes. Candidate 0.2.10 supersedes the preserved 0.2.8 and 0.2.9 archives: 0.2.8 could overwrite a JSON asset, and 0.2.9 could include a prior generated pair when both filenames changed. Root generated workers under another filename, orphaned generated workers and extra matching receipts require cleanup before rebuilding. For the preset, install the exact qualified archive with `pnpm add ./vendor/effortlessmetrics-astro-offline-0.1.5.tgz --ignore-scripts` or the equivalent `npm install` command, then repeat the frozen reinstall. Search and contact libraries keep separate versions and upgrade decisions.

Once registry publication is explicitly confirmed, verify the published archive identity against the accepted receipt before using exact registry pins such as `astromache@0.2.13`. Do not infer publication from a source tag, merged PR or passing CI.

## Compatibility and acceptance

The original 0.1.0 document, metadata, navigation, fonts and portfolio subpaths remain available. Expanded 0.2.x adds publication components/styles and the canonical static offline preset. Retain existing import paths; review the changelog for behavior repairs and test your actual adapters. No root export or unexported internal path compatibility is promised. A dependency change may change built bytes even when imports remain compatible.

Use an isolated copy to demonstrate an upgrade limited to dependency pins, lock entries and any matching application-owned delivery metadata. Keep routes, content, configuration and styling unchanged. The pnpm lockfile preservation check accepts LF or CRLF line endings on either side of the upgrade while still rejecting unrelated importer, package and snapshot changes. Only the root importer's production `astromache` dependency may change; other workspace importers and root development dependencies remain protected, including workspace paths containing spaces or non-ASCII characters. Run `pnpm verify:publication:preservation` for dependency-free preservation controls; it does not install packages or establish browser acceptance. Check content routes, listing query return, menu/overlay keyboard ownership, themes/native controls and any gallery/reading controls you use. For offline sites, rebuild the whole output and its worker together: The emitted output digest governs the worker revision; bundled dependency changes affect that revision when they change emitted bytes. A package-version-only or metadata-only change may leave the revision unchanged. Preserve site-owned cache prefixes, exclusions, budgets, scope and query policy unless deliberately changing them.

Test an already controlled browser updating naturally: the old worker may remain active while clients are open. Do not force activation merely to make a test pass. Verify eventual new control, offline navigation/assets, reconnect freshness, rejected-install preservation and unrelated-cache isolation. Selected HTML must retain the exact built bytes and qualified canonical routes on the target host; local builds do not establish hosted readiness.

## Rollback and notices

Restore the exact old manifest, lockfile, archives and matching delivery inventories when present, run a frozen install, rebuild, and repeat the affected checks. In the branded starter, restore both `STARTER-DELIVERY.json` and `candidate-artifacts.json` with the old bundled pin before running its delivery guard and qualification. Separately prove that the old worker/output can install and become active under the current host routing and integrity policy. An old archive may fail under changed HTML redirects or transformations. Restoring package pins or DNS does not revert workers already controlling browsers; qualify a compatible recovery artifact if the old worker cannot be adopted.

Retain upstream MIT OR Apache-2.0 notices, packaged font OFL notices and dependency notices. These grants do not license your replacement content, assets or application additions. Keep private source/history out of public core changes. Registry publication and production rollout each require their own authorization and acceptance evidence.

The unpublished 0.2.12 parent reconciliation retains later main metadata fixes, offline 0.1.5 and consumer-preservation qualification. Candidate 0.2.13 adds route-fallback recovery on that reconciled source. Preserved 0.2.10, 0.2.11 and 0.2.12 archives remain unchanged.

Candidate 0.2.13 also preserves literal fallback filenames such as `/myindex.html` and resolves slashless fallback values only when they identify a generated directory page. `/offline`, `/offline/` and `/offline/index.html` therefore select the same generated `/offline/` entry. Existing 0.2.10 archives remain immutable. Subpath deployments remain unsupported.

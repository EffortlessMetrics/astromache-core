# Upgrade an existing consumer

Keep your application's routes, content, configuration and license decisions. Upgrade its library dependencies; copying a new starter over an existing application is not required. The public core owns the `astromache` package identity. Historical exported fixtures retain their original pins and are not current release instructions.

## Choose verified bytes

As checked on 2026-10-10, npm exposes only `astromache@0.1.0`; the current `0.2.7` candidate is unpublished, and `@effortlessmetrics/astro-offline` is unavailable from the public registry. Obtain the exact accepted archives and receipts from the maintainer, verify their SHA-256 values, and retain the previous archives, manifest and lockfile. Never replace different bytes under an existing archive filename/version. A source checkout alone is not an accepted package receipt.

Use Node `>=24.19.0 <25`; Node 24.19.x and Astro **7.3.5** are qualified. The declared Astro `^7.3.5` peer range does not mean every version has been tested. Use your existing package manager; pnpm 10.28.0 is qualified for the supplied publication starter. Consumer builds do not require the producer's compiler patches or tooling overrides.

For a pnpm consumer, copy the accepted archive into its own `vendor/` directory, then run:

```sh
pnpm add ./vendor/astromache-0.2.7.tgz astro@7.3.5 --save-exact --ignore-scripts
pnpm install --frozen-lockfile --ignore-scripts
```

For an npm consumer, use:

```sh
npm install ./vendor/astromache-0.2.7.tgz astro@7.3.5 --save-exact --ignore-scripts
npm ci --ignore-scripts
```

The first command updates the dependency pin and lockfile. Review both together; keep active archives with the project so fresh installation resolves the same bytes. Run the consumer's type checks, build and affected browser checks after the frozen reinstall. Review any dependencies that require separately authorized installation scripts.

The optional peer `@effortlessmetrics/astro-offline >=0.1.4 <0.2.0` is required when importing `astromache/static-offline`. Existing document, metadata, navigation, gallery and publication component imports do not require it. For the preset, install the exact qualified archive with `pnpm add ./vendor/effortlessmetrics-astro-offline-0.1.4.tgz --ignore-scripts` or the equivalent `npm install` command, then repeat the frozen reinstall. Search and contact libraries keep separate versions and upgrade decisions.

Once registry publication is explicitly confirmed, verify the published archive identity against the accepted receipt before using exact registry pins such as `astromache@0.2.7`. Do not infer publication from a source tag, merged PR or passing CI.

## Compatibility and acceptance

The original 0.1.0 document, metadata, navigation, fonts and portfolio subpaths remain available. Expanded 0.2.x adds publication components/styles and the canonical static offline preset. Retain existing import paths; review the changelog for behavior repairs and test your actual adapters. No root export or unexported internal path compatibility is promised. A dependency change may change built bytes even when imports remain compatible.

Use an isolated copy to demonstrate a dependency-and-lock-only upgrade. Check content routes, listing query return, menu/overlay keyboard ownership, themes/native controls and any gallery/reading controls you use. For offline sites, rebuild the whole output and its worker together: The emitted output digest governs the worker revision; bundled dependency changes affect that revision when they change emitted bytes. A package-version-only or metadata-only change may leave the revision unchanged. Preserve site-owned cache prefixes, exclusions, budgets, scope and query policy unless deliberately changing them.

Test an already controlled browser updating naturally: the old worker may remain active while clients are open. Do not force activation merely to make a test pass. Verify eventual new control, offline navigation/assets, reconnect freshness, rejected-install preservation and unrelated-cache isolation. Selected HTML must retain the exact built bytes and qualified canonical routes on the target host; local builds do not establish hosted readiness.

## Rollback and notices

Restore the exact old manifest, lockfile and archives, run a frozen install, rebuild, and repeat the affected checks. Separately prove that the old worker/output can install and become active under the current host routing and integrity policy. An old archive may fail under changed HTML redirects or transformations. Restoring package pins or DNS does not revert workers already controlling browsers; qualify a compatible recovery artifact if the old worker cannot be adopted.

Retain upstream MIT OR Apache-2.0 notices, packaged font OFL notices and dependency notices. These grants do not license your replacement content, assets or application additions. Keep private source/history out of public core changes. Registry publication and production rollout each require their own authorization and acceptance evidence.

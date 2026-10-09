# Preserved producer regression variant

The archive pins and product paths below describe retained historical regression fixtures. Current package ownership/version is in the root README; the branded astromache repository is the small default starter with offline and intent prefetch enabled. These historical archives are not the current relocation candidate.

# Small standalone starter delivery

The foundation producer is not a GitHub template repository. A whole-repository copy would include library development, fixtures and qualification tooling. Use the export command to create a small independent consumer instead.

With Node24.19 within major24, clone this repository and run either:

```
node scripts/create-starter.mjs publication ../my-publication
node scripts/create-starter.mjs search-offline ../my-search-publication
```

No producer dependency installation is needed. The command refuses an existing destination and exports only tracked product files, its independent lockfile, licenses, and currently referenced vendor archives. Source files must resolve directly inside the checkout: symbolic links and linked parent directories are refused, so an outside asset cannot enter the delivery through a tracked path. A failed export removes only its newly created destination. Historical rollback archives stay in the producer. The delivery receipt records SHA256 for every active archive. In the exported directory, use pnpm10.28.0, run `pnpm install --frozen-lockfile`, `pnpm qualify`, then `pnpm dev`.

These are complete neutral starters, including sample articles and gallery, not packages for private sites to depend on. Private sites consume foundation/contact/search/offline libraries directly as siblings. Replace neutral origin, content, assets, fonts and identity in the consumer; search schema/engine/routes and offline coverage policy also belong to that consumer. No private personal source or assets are copied. Preserve MIT OR Apache-2.0 and the IBM Plex OFL notices.

Current active candidates: astromache0.2.0 `53bf0fa4`, static-search0.1.0 `01989cda`, offline0.1.4 `55d880bf` (independent EffortlessMetrics/astro-offline source). The recipe's consumer query/lifecycle source is saved on main; expanded npm releases remain unpublished. Published astromache0.1.0 is narrower and cannot replace0.2.0. Do not repack changed library bytes under an existing candidate version. Delivery does not merge a site, publish a package or deploy.

A true separate GitHub template repository is optional and requires an explicit repository/maintenance decision. Neither library producer is relabeled as a whole-repository template by this change. The small exported directory is suitable for initializing a consumer's own repository.

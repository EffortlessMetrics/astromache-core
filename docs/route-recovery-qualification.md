# PR6 generated route recovery qualification

Initial qualification target: PR6 source `b4d52ec010fdd90049e314650dee74d94aaeca93`; refreshed main `b112d6aea2e2b6d76fd6fbbc0af43f638621ecb0` on 2026-10-15. This follow-up is stacked on PR6 to preserve its ownership and avoid reverting later main work.

Historical status: the history at `219278c7b275755e1b69636c1f7b88466c0658e7` contains parent PR #6 merge `b6ac990f1d1ab802989b31082e11f40d584f8d9c`, followed by child PR #21 merge `3524078ed3fcfb827507db03f583a557401d4417`. The stack-order instructions below describe that completed phase and must not be replayed on resume. Existing evidence limits and authorization holds remain in force; this local history does not establish current remote status or authorize deployment, release, publication or permission changes.

## Repair and negative controls

The preset previously passed `/offline` unchanged to the worker, whose fallback lookup is exact, while the generated corpus contains `/offline/`. A real generated worker at the PR6 source failed an uncached offline navigation with `net::ERR_FAILED`; `/offline/` and `/offline/index.html` were passing controls. The old suffix replacement also rewrote `/myindex.html` to `/my`. The final fixture against the preserved PR6 module fails its literal-filename assertion, as expected.

The repair resolves slashless or final `/index.html` aliases only when their canonical directory URL is in the generated corpus. Empty/disabled, unknown, relative, external, query and fragment values remain literal. No vendor worker, historic archive, font, license or consumer-content file changes.

## Reproduce

Use Node 24.19.x and the repository's frozen dependencies and checkout-scoped Chromium, then run:

```sh
pnpm verify:route-recovery
pnpm verify:canonical-preset
```

The first script creates original neutral HTML/SVG fixtures and invokes the actual configuration/build hooks and bundled worker. It rejects `/docs` and `/docs/`, verifies exact generated corpus/404 bytes, preserves 13 literal fallback values, installs workers naturally and checks canonical/slashless navigation, relative assets, API document/resource exclusions, query-bearing resource refusal, HTTP 503 visibility and three offline fallback spellings. Positive documents must come from a service worker. Offline tests sever server transport as well as setting browser offline mode. Chromium cleanup and server teardown are bounded and isolated.

`ASTROMACHE_QUALIFICATION_ROOT` places fixtures on task storage. `ASTROMACHE_ROUTE_PRESET=astromache/static-offline` selects the installed public export for exact packed-consumer testing; a module URL can select preserved baseline source. Default execution selects the current checkout source.

## Evidence and limits

Windows execution uses Node 24.19.0, Playwright 1.58.2, Chromium 145.0.7632.6, offline archive 0.1.4 SHA-256 `55d880bfa3fc9dcd650df94a1354040db899130edfb471d8caf45b6fa96e257e` and Workbox 7.4.1. The new `astromache-0.2.11.tgz` is 144897 bytes, SHA-256 `ec6156c61a82c9bc19caf68130c8641bd89e224ecede282d648e49b344747633`. It is unpublished; old archives remain immutable.

Local results: the installed 0.2.11 public export passes all 18 groups (two base rejections, thirteen literal-policy controls and three complete browser variants), including clean browser shutdown. The canonical-preset regression and focused formatting/lint/whitespace checks pass. An initial source run exceeded a 20-second browser-close bound; it is retained as a harness failure, not a clean suite pass. The final fixture guarantees HTTP-server cleanup and allows Chromium its shutdown grace period. Production module SHA-256: `f0e8c3068db9cf5364732013d534b9417afbff008cebea31e6c0d3c432d24362`. Exact commit and final fixture rerun are recorded in the PR.

This focused fixture exercises actual preset hooks and real service workers, using neutral HTML rather than rebuilding a full Astro site. It establishes root-directory behavior, not subpath support. Actual Astro compiler/full-consumer and full Linux/Windows qualification are not rerun locally. Existing PR6 hosted evidence belongs to its original SHA. The pinned specialist worker permits query-bearing document navigation to reach its generic fallback; resource-query negatives do not establish document-query exclusion, and this repair does not change that policy.

The 0.2.13 candidate refreshes this repair onto reconciled parent `d3fe021d8f71e243eb29b0cb257fabf14854a240`, which combines PR6 with main `a227f88be90c5b9f2913fb8addd1a21fb4ea0b80`. The parent retains reviewed offline preflight unchanged, later main metadata repairs, offline 0.1.5 and the upgraded-consumer preservation controls. The product module and route fixture remain byte-identical to the initially qualified repair; current-root worker behavior requires separate qualification against offline 0.1.5. The retained local 0.2.11 archive above is historical evidence, not the current 0.2.13 delivery.

The non-release workflow supports main and the PR6 parent branch, preserves the Linux/Windows matrix and all existing gates, and records exact source/run identities in the PR. Parent integration precedes child retarget/integration. No deployment, release, publication or permission change is authorized.

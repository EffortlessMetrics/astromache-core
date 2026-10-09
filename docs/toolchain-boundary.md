# Toolchain and package boundary

| Piece                                         | Decision                     | Proof or constraint                                                                                                                                   |
| --------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test, lint and formatting runners             | Native replacement           | `vp test`, `vp lint`, `vp fmt`; test imports use `vite-plus/test`. No separate Vitest or Oxlint pin.                                                  |
| Application bundling                          | Required framework handling  | Astro 7 owns rendering and builds; its Vite dependency resolves to the pinned Vite+ core. `vp run build` orchestrates that framework task.            |
| Astro component packaging                     | Required adaptation          | Preserve `.astro` source for the consumer compiler; a pnpm archive is not the same operation as the tsdown-backed `vp pack` JavaScript library build. |
| Native Astro type checking                    | Required adaptation          | Exact TS7.1 content mapper and an exact-version Astro source patch. A negative prop test must still fail with TS2322.                                 |
| Document shell and metadata validation        | Reusable code                | Neutral identity is supplied by the consumer; workspace and independently installed archive output must match.                                        |
| Site route/content policy, assets and styling | Consumer responsibility      | Absent from this repository.                                                                                                                          |
| Search                                        | Independent library contract | Do not absorb a search implementation or its build into the publication package.                                                                      |
| Legacy PWA/worker/build workarounds           | Do not extract               | Desired offline/update behavior needs fresh qualification against the current framework. No service worker is included here.                          |

Sources: [Vite+ migration rules](https://viteplus.dev/guide/migrate-rules), [Vite+ library packaging](https://viteplus.dev/guide/pack), [Astro content mapper](https://github.com/withastro/astro/tree/main/packages/language-tools/ts-content-mapper).

The Astro patch fixes a union property access and supplies the actual generated font module map type. It adds no diagnostic suppression or component exclusion. Its upstream license is retained in `patches/ASTRO-LICENSE.txt`. Remove the patch only after an upstream release passes the same required native and packed-consumer checks.

This source is public; registry publication remains a separate decision. No deployment workflow, credentials or consumer identity is included.

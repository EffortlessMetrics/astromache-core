# Static publication implementation candidate

Owner request: 2026-11-09, investigate the missing modern publishing capabilities and build them properly. Base: a90a37b1556ecc51eae876b5e824c0722f5f1841.

This isolated branch prepares build-time rendered-content Markdown, complete metadata defaults, output reconciliation and an optional bounded negotiation helper. Static HTML remains independent of request-time compute. Existing held PRs, published archives, production settings and private consumer content are not changed. No merge, release or deployment is authorized.

The initial commit resolves the new dependency graph on a pinned hosted Node/pnpm runtime because the authoring sandbox cannot access npm. It is not an implementation-complete or qualified package: the declared publishing exports will arrive with the implementation commit. This one-purpose lock-resolution job has read-only repository permissions, disables lifecycle scripts, and only uploads a lockfile/diff receipt. The resolved lock must be reviewed and committed before frozen installation or full qualification is claimed. Existing qualification workflow remains unchanged.

Continuing owner: this ChatGPT working session. Next: read the dependency-resolution receipt, retain exact source and artifact identity, commit the resolved lock with the tested implementation, then execute actual converter/Astro/packed-consumer and negative controls. No source archive is released from this branch.

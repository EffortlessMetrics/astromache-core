# Static publication release preparation

The `0.3.0` source combines the reviewed static-publication implementation from PR #45 with the remaining scoped component and consumer-qualification repairs. It supplies build-time rendered-content Markdown, publication metadata, output reconciliation and an optional bounded negotiation helper. Static HTML remains independent of request-time compute. Consumer content, specialist offline/search ownership and deployment settings remain separate.

PR #45 landed as `417bc6992b0be06083ec358f6436b0751b44b35f`. Its exact source and landed main passed Linux and Windows qualification in runs [42992485605](https://github.com/EffortlessMetrics/astromache-core/actions/runs/42992485605) and [42994950001](https://github.com/EffortlessMetrics/astromache-core/actions/runs/42994950001). Those results retain their original candidate identity; the composed release candidate requires its own checks and archive receipt.

The existing release checklist governs archive review and registry publication. Source integration, registry publication and consumer deployment are distinct outcomes. Retain the final source/archive identities and current test results in the release PR and receipt. No registry publication is established by this document.

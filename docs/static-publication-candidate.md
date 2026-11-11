# Static publication implementation candidate

This branch implements build-time rendered-content Markdown, publication metadata, output reconciliation and an optional bounded negotiation helper as the unpublished `0.3.0-publishing.1` candidate. Static HTML remains independent of request-time compute. Existing document/article APIs, consumer content, specialist offline/search ownership and deployment settings are unchanged.

The publishing exports and resolved dependency lock are present. `pnpm qualify` runs the parser/converter contracts, and normal Linux/Windows qualification includes the independently installed static-publication consumer. Temporary dependency-preparation workflows have been removed.

Run 42754946337 qualified the preceding head's Linux product checks through the installed static-publication consumer and independent packed consumers, then failed the full-consumer upgrade lock-preservation guard. Windows qualification was cancelled. Repairs to that guard and current review findings require fresh qualification; no complete final-candidate pass, registry release or deployment is claimed here.

The existing release checklist governs archive review and registry publication. Source integration, registry publication and consumer deployment are distinct outcomes. Retain exact source/archive identities and current test results in the PR rather than treating this status document as a qualification receipt.

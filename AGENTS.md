# Working in astromache-core

This repository owns the reusable `astromache` package. Start with
[README.md](README.md) and [library ownership](docs/library-ownership.md).
Keep starter identity, private content, deployment, and independently owned
offline/search implementations with their existing owners.

- Reuse the working session, installed dependencies, build caches and scoped
  browser installation when compatible with the candidate. Check [.nvmrc](.nvmrc)
  and [package.json](package.json) before using them; use the pinned local pnpm
  executable when the ambient version differs. Install frozen dependencies when
  setup or changed inputs require it.
- Select local checks from `package.json` for the changed behavior and remaining
  uncertainty. Preserve full qualification obligations, required checks,
  approvals and current holds. The checked-in
  [qualification workflow](.github/workflows/qualification.yml) runs on PR heads
  and main pushes. Qualifying composed merge-queue candidates is the intended
  direction; it requires implementation and verification before replacing
  existing CI obligations. Local passes do not establish hosted readiness.
- Keep evidence with its commit/tree, relevant base or composed candidate,
  command, environment, result and observation time. Preserve valid earlier
  tests and reviews under their original identities; refresh affected evidence
  when inputs or assumptions change. Do not relabel old results as current runs.
- Use independent review when required or when it answers a concrete unresolved
  question. When another agent is needed, use a subagent inside the working
  session. Do not assume optional ub-review capacity or transfer the candidate
  to a separate reviewer environment. Preserve valid prior reviews and actual
  review requirements.
- Reconcile current ownership before editing shared files. Treat dated
  qualification reports and preserved producer/stack procedures as evidence
  for their named candidates. Before reset or handoff, update the existing task
  or PR record with checkout identity, changes, checks, remaining work, blockers
  and who continues. Include recovery pointers readable by that owner; preserve
  versioned evidence rather than creating a parallel registry.
- Local qualification does not authorize publishing or deployment. Preserve
  reviewed archives and published history; follow the existing
  [release boundaries](docs/release-checklist.md) when release work is in scope.

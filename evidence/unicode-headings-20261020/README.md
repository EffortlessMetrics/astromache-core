# Disposable Unicode heading investigation

First emoji-only or punctuation-only Markdown headings produce an empty ID under
the installed Astro renderer. Both main and held PR 28 append a permalink with
`href="#"`; activating it returns to the top without selecting that heading.
Repeated symbol-only headings receive `-1` and work. Explicit nonempty IDs also
work. This is supplemental evidence for issue 27, not a competing Article repair.
The coordinating owner retains follow-through and all existing holds.

The tested source was copied into disposable fixtures, never modified. No held
component, regression suite, shared worktree, RSS/sitemap endpoint or navigation
prefetch source was edited. This branch contains evidence only; it is not a
product-change candidate and is not proposed for integration.

## Exact sources and environment

- Repository: `https://github.com/EffortlessMetrics/astromache-core`.
- Main/base: `219278c7b275755e1b69636c1f7b88466c0658e7`, tree
  `cb18f41732102e2449dcd460409a1ff1c74a76fa`.
- Held PR 28: `967124eaec4247e6c7375e5d876a02d6639f0822`, tree
  `b241c708f17bb7918929eea8df7e384aabea103d`.
- Main Article SHA-256:
  `258c78dea308395d7c22305ce4696af72a89ef9f0a73be48529edff52067fe02`.
- PR 28 Article SHA-256:
  `7c1ff4245eb35a6a27cfc561ca0ae32d2da4c767481bd4ce81ee2c9dbff492cc`.
- Linux x64; Node 24.19.0; Astro 7.3.5 with the repository patch;
  `@astrojs/markdown-satteri` 0.4.2; `github-slugger` 2.0.0;
  Playwright 1.58.2; Chromium 145.0.7632.6.
- Lockfile SHA-256:
  `9180b7ee8129d0e69f4ee69c1d8babe6414fdaa6e7862c79ba7a9cfd52f9b47f`.
- Astro patch SHA-256:
  `d299c96b06e1caa7bb6c07d1989e373b4d1e87bd9c30547ce417b2469bcf64df`.
- Observed 2026-10-20 04:37 UTC; current main and PR 28 source/head/draft status
  were rechecked at 04:37:48 UTC. Other held drafts retained their observed heads.

## Results

One native Astro build generated eight pages from exact copied Article sources.
Each variant ran at 1440, 390 and 280 CSS px widths, with fresh-document keyboard
activation and independently loaded deep links.

- 150/150 nonempty-heading navigation cases passed. DOM IDs and Astro's
  `getHeadings()` inventory exactly matched all 26 expected Markdown heading IDs.
  The control covers Chinese, Japanese, Korean, Cyrillic, Arabic, Devanagari,
  Thai, Greek, Turkish case mapping, Latin combining marks, canonical mark order,
  precomposed/decomposed Hangul, h2–h6 and repeated-heading suffix collisions.
- 30/30 deliberate normalization controls behaved as expected. Native fragments
  retain exact code-point identity. Changing NFD `café` to NFC `café` selects the
  separate NFC heading. Changing decomposed `å` to `å` selects no heading when
  that normalized spelling is absent. Mark-order and Hangul controls distinguish
  equivalent appearance from exact target identity. No normalization repair is
  justified by these observations.
- All six mixed-document empty-ID observations reproduce `href="#"`, no
  `:target`, empty `location.hash`, and `scrollY === 0`.
- 36/36 causal boundary controls matched the expected observations: 12 failing
  destinations for first emoji/punctuation-only Markdown headings; 12 passing
  repeated-heading `-1` destinations; 12 passing explicit nonempty-ID destinations.
  "Control pass" means the observed result matched the stated expectation; the
  12 first-heading destinations remain defective.
- No browser page errors. Node syntax checking passed.

The empty-ID condition originates in the default Markdown heading-ID path:
`@astrojs/markdown-satteri` calls `github-slugger`, sets its empty first result as
the ID, and Article selects `[id]` even when the value is empty. The existing
PR 28 percent/directive encoding change preserves this pre-existing condition.
Any repair or policy decision remains with the held Article owner. An explicit
nonempty-ID fixture is a causal control, not a proposed product patch.

## Commands and resource limits

Actual final command (shell `time`, not `/usr/bin/time`):

```sh
PLAYWRIGHT_BROWSERS_PATH=/workspace/astromache-core/.qualification/browsers \
ASTRO_TELEMETRY_DISABLED=1 timeout --kill-after=10s 180s \
node /workspace/scratch/unicode-heading-evidence-20261020/verify-unicode.mjs \
/workspace/scratch/unicode-heading-controls-20261020
```

The wrapper bounds the whole experiment to 180 seconds. Its child Astro build is
bounded to 60 seconds; browser waits are bounded to 4 seconds. One build and one
browser ran sequentially, reusing installed dependencies with no installation or
full qualification. The final run took 10.834 seconds. This environment has a
16 GiB cgroup limit and four CPU quota; its session-wide observed memory peak was
661,708,800 bytes at 04:37:48 UTC, including the wrapper and child processes.
No separate repository admission command exists in this checkout.

To reproduce, copy `verify-unicode.mjs` and `Article-pr28.astro` together into a
disposable directory, provide a dependency-installed checkout of the stated main
source as the sole argument, and use the qualified Node and browser versions.
The script regenerates all fixture sources and pages and writes `results.json`.
It compares raw IDs without using CSS ID selectors or normalizing the targets.

Initial execution did not start because `/usr/bin/time` was absent. A shell-time
run reached all behavior but falsely rejected 78 subpixel geometry observations
between -1 and 0 CSS px; target IDs were correct. After correcting that fixture
assertion, 150/150 navigation cases passed in 9.479 seconds. The final 10.834-second
run added the focused emoji/punctuation/explicit-ID causal controls. These are
small fixture iterations, not repeated broad qualification.

## Artifacts and limits

`verify-unicode.mjs` is the complete generating harness. `Article-pr28.astro` is
an exact public source copy; main source is recoverable from the base commit.
`results.json` contains every final measurement, identity, expected and actual
target, and result. `final-run.log` contains the final build/test stdout and time.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| verify-unicode.mjs | 12961 | f4413fafa2a6d54555b0662a6eb1116e0feaa2b87136ef5471f911c3417a1b86 |
| results.json | 95192 | b41d09dd890fd5c2fa79c126bda7fffd08bfdea2f591366bc6d79c03c25760e3 |
| final-run.log | 1214 | 6436ac5df5b3a926f3c1a5ab24084fb809c0258a59091295861448951b447076 |

Evidence is exact copied-component execution for the two named commits, using
the stated warm installed renderer. It is not a frozen reinstall, installed
packed-export test, full historical consumer build, current PR CI run, independent
source review or formal approval. Firefox, WebKit, Windows, custom Markdown
plugins, authored duplicate explicit IDs and ClientRouter transitions were not
tested. Existing PR 28 review/CI results were read for ownership and context,
not carried forward as new execution evidence. No merge, release, deployment,
readiness transition, protection change or denied-route retry was performed.

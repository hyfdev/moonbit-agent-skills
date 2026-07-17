# Contributing

Contributions are welcome — with one hard rule: **nothing lands unverified.**

## The verification bar

Every knowledge change must ship with its proof:

| You are adding... | It must be proven by... |
| --- | --- |
| A language fact / example | An `mbt check` block in the relevant `skills/moonbit-language/references/*.mbt.md` (CI compiles and runs it on all pinned targets) |
| A "this is rejected / deprecated / a trap" claim | A fixture in `verification/fixtures/` with the expected diagnostic substring |
| A toolchain command or flag | The command line in a ```sh fence plus a `verification/commands/manifest.json` entry that actually executes it (CI enforces coverage) |
| A fact you cannot execute here (docs-only) | An explicit `documented` label plus the source URL in the text |

Run the full local check sequence from AGENTS.md before opening a PR. If a
change touches a skill `description`, also re-run the activation eval and
include the summary numbers in the PR description.

## Updating to a new MoonBit release

Use the repository's internal `moonbit-agent-skills-maintainer` skill so the workflow and gates below are loaded together.

1. Resolve the official release Markdown in `moonbitlang/website` to a full commit and path. Run `vp run snapshot-release ... --output verification/releases/<release>/source.json`; never summarize the web page directly into a hand-written checklist.
2. Create schema-v2 `coverage.json` beside the source inventory. Account for every generated source ID exactly once. For actionable decisions, enumerate each claim and link it to a unique evidence role owned by one product skill; otherwise give a concrete out-of-scope/not-actionable reason. Run `vp run verify-release-sources` and `vp run check-release-coverage`.
3. Close content gaps. New language forms need checked examples for every claimed behavior; deprecations need the old form caught with warnings denied plus a passing replacement; commands/configuration need manifest or fixture evidence; unexecutable facts need an explicit `Documented, not executed` label and direct source. A documented-only deprecation still needs separate old-form and replacement roles and an explicit reason it cannot execute.
4. Add or update deterministic content evals for changes that materially alter agent recommendations.
5. Only after coverage is closed, run `moon upgrade` (or install the new channel build), `vp run snapshot-toolchain --date $(date +%F)`, and the three verification runners. Fix drift exposed by the new toolchain.
6. Run `vp run run-fixtures --stamp --date $(date +%F)`, update the two product skills' frontmatter pins and compatibility lines, bump their `skill-version`, and run `vp run check-versions`.
7. Run the complete sequence in `AGENTS.md`, the targeted content evals, and the two release reviews required by the maintainer skill.

## Style

- English everywhere; plain language; no invented shorthand.
- SKILL.md files stay under 500 lines / ~5,000 tokens; push detail into
  references; every reference must be routed to from SKILL.md.
- Wrong/deprecated code appears only in `mbt nocheck` fences, labeled WRONG
  or DEPRECATED, with the diagnostic when the compiler rejects it.
- Skill frontmatter follows the Agent Skills spec (agentskills.io):
  lowercase hyphenated `name` equal to the directory, `description` ≤ 1024
  chars covering what + when + trigger keywords, versions under `metadata`. The single allowed client-extension field is
  `user-invocable` (`false` on product skills and `true` on the internal
  maintainer skill; kept out of the spec-view CI validation by a documented
  strip step); do not add others.

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

1. `moon upgrade` (or install the new channel build).
2. `vp run snapshot-toolchain --date $(date +%F)`
3. Run the three verification runners; fix any content the new toolchain
   invalidates (that is the point of this repository).
4. `vp run run-fixtures --stamp --date $(date +%F)`
5. Update both skills' frontmatter `metadata` pins and compatibility lines,
   bump their `skill-version`, and run `vp run check-versions`.
6. Record notable behavior changes in the relevant reference files with the
   version boundary ("changed in vX.Y").

## Style

- English everywhere; plain language; no invented shorthand.
- SKILL.md files stay under 500 lines / ~5,000 tokens; push detail into
  references; every reference must be routed to from SKILL.md.
- Wrong/deprecated code appears only in `mbt nocheck` fences, labeled WRONG
  or DEPRECATED, with the diagnostic when the compiler rejects it.
- Skill frontmatter follows the Agent Skills spec (agentskills.io):
  lowercase hyphenated `name` equal to the directory, `description` ≤ 1024
  chars covering what + when + trigger keywords, versions under `metadata`. The single allowed client-extension field is
  `user-invocable: false` (kept out of the spec-view CI validation by a
  documented strip step); do not add others.

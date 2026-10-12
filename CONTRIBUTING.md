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

The proof table checks accuracy. Completeness has a separate gate: `verification/language-surface/source.json` recursively inventories the pinned official root/nested toctrees, pinned glob expansions, included pages, and headings; each item has a section-body fingerprint. Its schema-v2 `coverage.json` routes every topic to exact product content or records a concrete boundary and the fingerprint that was reviewed. Official documentation is an input to investigate, not executable truth. Run an unsuppressed minimal POC with the relevant warnings enabled before recommending syntax.

Run the full local check sequence from AGENTS.md before opening a PR. If a
change touches a skill `description`, also re-run the activation eval and
include the summary numbers in the PR description.

## Updating to a new MoonBit release

Follow the repository's internal [moonbit-agent-skills-maintainer workflow](skills/moonbit-agent-skills-maintainer/SKILL.md). It starts from the official latest toolchain and documentation, imports release articles when available, and defines the required coverage decisions, executable evidence, evaluations, version updates, and independent reviews. Run the complete local check sequence in `AGENTS.md`.

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

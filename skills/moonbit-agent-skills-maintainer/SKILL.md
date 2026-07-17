---
name: moonbit-agent-skills-maintainer
description: Maintain hyfdev/moonbit-agent-skills across MoonBit releases and toolchain drift. Use whenever a user supplies MoonBit release notes, asks whether this repository covers a release, requests a re-pin or upgrade, mentions newly added, deprecated, removed, or changed MoonBit behavior, or asks to repair a coverage gap. Inventory every upstream release item before editing, assign it to moonbit-language, moonbit-toolchain, or an explicit out-of-scope decision, attach executable evidence, update high-impact evals, and run the complete release gate. Do not use for ordinary MoonBit application coding.
license: MIT
user-invocable: true
compatibility: Repository-maintenance workflow for hyfdev/moonbit-agent-skills. Needs Git, Node.js 24+, Vite+, and the MoonBit toolchain for executable verification.
metadata:
  skill-version: "0.1.0"
  scope: "repository-maintenance"
  internal: true
---

# MoonBit Agent Skills maintainer

Use this skill in two modes:

- **Audit:** compare a MoonBit release with the repository and report gaps without changing version pins.
- **Update:** close every release item with evidence, update the product skills, run tests and evals, then re-pin and prepare PR data.

This workflow exists because testing only written claims cannot detect an omitted release feature. The source inventory must be generated before deciding what matters.

## Required workflow

1. Read the repository's `AGENTS.md` and `references/release-maintenance.md` completely.
2. Resolve the official release page to the matching Markdown file in `moonbitlang/website`. Pin a full Git commit, repository path, page URL, and SHA-256.
3. Run `vp run snapshot-release` to generate `verification/releases/<release>/source.json`. Never hand-author or filter this file.
4. Read every generated source item. Group related items into coverage decisions in `verification/releases/<release>/coverage.json`; every source ID must appear exactly once. Enumerate each independently testable claim inside an actionable decision and link it to exact evidence roles; never let one passing example stand in for the rest of a broad release-note paragraph or code block.
5. For each user-visible change, search both product skills and existing evidence before classifying it as already covered, wrong, or missing.
6. Assign exactly one product owner (`moonbit-language` or `moonbit-toolchain`) and add verified or documented evidence. Use `out-of-scope` and `not-actionable` only with a concrete reason tied to the published product boundary.
7. Treat deprecations as migrations: remove the old form from recommended examples, prove the old form is detected, prove the replacement passes, and explicitly enable any warning that is off by default. Pair warning flags with `--deny-warn` so the negative test cannot pass silently. Even a documented-only deprecation needs separate `deprecated-form` and `replacement` evidence plus the exact reason execution is unavailable.
8. Add checked documentation or fixtures for language behavior, command-manifest entries for commands, and explicit `Documented, not executed` text plus a direct source for facts the environment cannot execute.
9. Add or update a deterministic content eval for every change that materially alters what an agent should recommend. Do not run model evals for release-note noise that has no expected agent behavior.
10. Run `vp run check-release-coverage`. In update mode, do not change the toolchain snapshot, fixture stamps, skill pins, or README status until this check has no pending or missing source items.
11. Run the full repository check sequence from `AGENTS.md`, including all pinned targets and network command cases where the environment permits them.
12. Have one fresh reviewer compare the pinned upstream Markdown with source inventory and coverage decisions, and another fresh reviewer inspect implementation and tests.

## Completion output

Report findings and user value, not a diary of commands. PR descriptions must contain:

- a release coverage table with counts for verified, documented, out of scope, and not actionable;
- a test table with the exact suites, cases, targets, and results;
- a short list of corrected wrong recommendations and newly prevented failure modes.

An audit is complete when every upstream source item has a decision and every claimed gap points to exact repository evidence. An update is complete only when the coverage gate, repository tests, targeted content evals, and both reviews are finished.

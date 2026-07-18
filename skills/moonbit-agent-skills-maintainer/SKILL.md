---
name: moonbit-agent-skills-maintainer
description: Maintain hyfdev/moonbit-agent-skills across MoonBit releases, official documentation drift, and product-scope gaps. Use whenever a user supplies MoonBit release notes, asks whether a release or the general language reference is covered, requests a re-pin or upgrade, mentions newly added/deprecated/removed behavior, or asks to repair an omitted capability. Generate the relevant upstream inventory before editing, attach executable evidence, make every actionable item discoverable from a product SKILL.md, update discriminating evals, and run the complete gates. Do not use for ordinary MoonBit application coding.
license: MIT
user-invocable: true
compatibility: Repository-maintenance workflow for hyfdev/moonbit-agent-skills. Needs Git, Node.js 24+, Vite+, and the MoonBit toolchain for executable verification.
metadata:
  skill-version: "0.2.0"
  scope: "repository-maintenance"
  internal: true
---

# MoonBit Agent Skills maintainer

Use this skill in three modes:

- **Audit:** compare a MoonBit release with the repository and report gaps without changing version pins.
- **Update:** close every release item with evidence, update the product skills, run tests and evals, then re-pin and prepare PR data.
- **Surface audit:** compare the complete official language documentation surface with the two product skills, close missing routes, and test high-value gaps without changing a release pin unless the compiler changed.

This workflow exists because testing only written claims cannot detect omitted knowledge, and a reference file can contain correct knowledge that agents cannot find from the main skill. Source completeness, semantic verification, and discoverability are separate checks.

## Required workflow

1. Read the repository's `AGENTS.md`, `references/release-maintenance.md`, and `references/language-surface-maintenance.md` completely.
2. Choose the inventory before judging content. For a release, pin the matching `moonbitlang/website` Markdown and run `vp run snapshot-release`. For a general language/reference audit, pin `moonbitlang/moonbit-docs` and run `vp run snapshot-language-surface`; never hand-author or filter either source inventory.
3. Read every generated source item. Close each exactly once in the matching `coverage.json`. Release decisions use verified/documented/out-of-scope/not-actionable claims and evidence; language-surface items use routed/out-of-scope because that inventory proves topic handling, not semantic truth.
4. For every user-visible item, search both product skills and existing evidence before classifying it. Assign one product owner and make the route explicit in that skill's `Feature index`, with the reference path and exact feature/diagnostic terms on one physical line.
5. Treat official documentation as a discovery source, not a compiler oracle. Inspect upstream warning configuration and run an isolated minimal POC with warnings enabled; the official local-type example is a known case that passes only because its package suppresses `deprecated_syntax`.
6. Add checked documentation or fixtures for language behavior, command-manifest entries or fixtures for project behavior, and explicit `Documented, not executed` text plus a direct source for facts the environment cannot execute.
7. Treat deprecations as migrations: remove the old recommendation, enable the warning, add `--deny-warn`, prove the old form is caught, and prove the replacement passes under the same settings. A documented-only deprecation still needs separate old-form and replacement evidence and the reason execution is unavailable.
8. Add a deterministic content eval for each change that materially alters agent behavior. When evaluating discoverability, use a clean task that does not expose the answer through compiler diagnostics; compare a pinned old Git-tree snapshot with the current committed snapshot.
9. Run `vp run check-release-coverage` and `vp run check-language-surface`. In update mode, do not change toolchain pins, fixture stamps, skill pins, or README status until both completeness gates close.
10. Run the full repository check sequence from `AGENTS.md`, all relevant pinned targets, targeted model evals, and the required independent reviews.

## Completion output

Report findings and user value, not a diary of commands. PR descriptions must contain:

- a release coverage table with counts for verified, documented, out of scope, and not actionable;
- a language-surface table with official documents, headings, routed topics, and explicit boundaries when that inventory changed;
- a test table with the exact suites, cases, targets, and results;
- a short list of corrected wrong recommendations and newly prevented failure modes.

An audit is complete when every relevant upstream source item has a decision and every claimed gap points to exact repository evidence. An update is complete only when both completeness gates, repository tests, targeted content evals, and both reviews are finished.

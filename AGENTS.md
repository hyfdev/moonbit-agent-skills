# Working in this repository (agent instructions)

This repository publishes two MoonBit product skills (`skills/moonbit-language`, `skills/moonbit-toolchain`) plus a repository-maintenance skill (`skills/moonbit-agent-skills-maintainer`). The core promise is: **every claim is verified against a pinned MoonBit toolchain, every upstream release item has an explicit decision and a discoverable product route, every official language topic is routed or explicitly outside the product boundary, and all three contracts are machine-checked**. When editing here, that promise is the thing you must not break.

## Rules

1. **Repository tooling is TypeScript.** Repository-owned executable tooling, validators, generators, eval runners, and tests must be TypeScript run directly by Node.js 24. Do not add Python or shell implementations. Shell is allowed only for documented command examples and CI `run` blocks that invoke external tools.
2. **No unverified content.** A fact enters a skill only with a runnable proof: an `mbt check` block in a `.mbt.md` reference (executed by `tooling/run_checked_docs.ts`), a fixture under `verification/fixtures/` (executed by `tooling/run_fixtures.ts`), or a command-manifest entry (executed by `tooling/verify_commands.ts`). If you cannot verify it, label it `documented` (with source URL) or leave it out.
3. **One owner per fact.** Language semantics belong to moonbit-language; project operation belongs to moonbit-toolchain. Cross-links are one line; never copy explanations across skills (`tooling/check_duplication.ts` enforces this).
4. **Versions come from the snapshot.** Never hand-edit version strings. Re-pin with `vp run snapshot-toolchain --date YYYY-MM-DD`, re-run all verification, re-stamp fixtures (`vp run run-fixtures --stamp --date ...`), and update skill frontmatter to match; `tooling/check_versions.ts` cross-checks all of it.
5. **Proposals are not features.** Anything sourced from moonbit-evolution or a release-note "planned" section must be labeled proposal, never shown as current syntax.
6. **Skill descriptions are an interface.** If you touch a frontmatter `description`, re-run the activation eval (`evals/activation/run_activation.ts`) or state explicitly that routing is unrevalidated.
7. **Each installable skill has per-client activation surfaces — keep all of them in sync.** A product skill ships three: the frontmatter `description` (open-spec catalog, all clients), `user-invocable: false` (Claude Code extension, hides the manual `/` entry), and `agents/openai.yaml` (Codex: display name, short description, default prompt, `allow_implicit_invocation: true`). When renaming a product skill, changing its scope/description, or adding a new product skill, update the Codex sidecar in the same change (`tooling/validate_skills.ts` enforces its presence).
8. **A release inventory comes before release judgment.** For any MoonBit release audit or re-pin, use the internal `moonbit-agent-skills-maintainer` workflow: generate `verification/releases/<release>/source.json` from a pinned `moonbitlang/website` Markdown commit, then close every source ID in `coverage.json`. Never hand-author or filter the source inventory. `tooling/verify_release_sources.ts` checks it against upstream and `tooling/check_release_coverage.ts` blocks missing, duplicate, unsupported, or unproved decisions. Every actionable decision in the current release also needs a `discoverability` route whose reference path and exact search terms occur together on one line in the owning skill's `Feature index`.
9. **Baseline completeness is separate from release completeness.** `verification/language-surface/source.json` is mechanically generated from the pinned `moonbitlang/moonbit-docs` language tree by recursively following root and nested toctrees, pinned glob expansions, `{include}` pages, and H2-H4 headings. Every item includes a section-body fingerprint. Close every source ID exactly once in schema-v2 `coverage.json` as `routed` or `out-of-scope`, record the reviewed fingerprint, and put every routed official topic name in its target reference; never add `pending`, a hand-written page whitelist, or a broad route that claims content the reference does not contain. Official docs discover topics but do not verify semantics: every routed fact still needs checked documentation, a fixture, or an explicit `Documented, not executed` source. Run both language-surface checks for language-scope or documentation-pin changes.
10. **Deprecations prove both sides.** Enable warnings that are off by default, add `--deny-warn`, prove the old form is caught, and prove the replacement passes under the same warning settings. Do not trust an upstream green test until you inspect its warning configuration; the official local-type example suppresses the warning that marks local type definitions deprecated at the pin.
11. **Repository-maintenance skills stay internal.** Set `metadata.internal: true` so default listing, interactive selection, and installs without an explicit skill selector omit them. Do not use `--skill "*"` in public install instructions because an explicit selector opts into internal skills. The two product skills are the only public install surface.
12. **Eval breadth comes before repetition.** Count distinct user cases, not condition cells. A case may have at most two materially different user-facing angles, and each angle may run at most twice. Start every content case with one paired `none` versus `ours` run on Claude Code's `sonnet` alias; on this repository's verified local setup the assistant execution model must be `deepseek-v4-pro`, not `deepseek-v4-flash`. Repeat the DeepSeek pair only when `ours` fails or the pair is unstable. Use Kimi/K3 only when `ours` still fails on the second DeepSeek run, and report that fallback separately rather than pooling providers. Do not automatically cross-product angles, repetitions, and clients.
13. **Every new or updated eval report has a simple user-facing result.** Put it before the technical analysis and keep it even when a detailed report follows. Give every distinct task its own row named after the concrete work the agent had to complete, state the total number of distinct tasks, show percentages for the two conditions side by side, identify the observed model, and give the primary finding in one sentence. Name the comparison exactly (`No skills`, `Historical skill`, or the specific removed route), never just `Baseline`. Always show final task success, including ties and regressions; skill activation and reference reads are secondary evidence and must not replace it. Keep exact counts, internal task IDs, claim IDs, condition names, repetitions, cells, graders, token breakdowns, and statistical analysis in the technical section. Never call cells or repetitions tasks.

## Local check sequence (mirror of CI)

```sh
vp install
vp check
vp test
vp run validate-skills
vp run check-duplication
vp run check-versions
vp run verify-language-surface-source
vp run check-language-surface
vp run verify-release-sources
vp run check-release-coverage
vp run run-checked-docs                    # needs moon
vp run run-fixtures --verbose              # needs moon
vp run verify-commands                     # needs moon
```

## Layout

- `skills/` — two public product skills plus one internal repository-maintenance skill.
- `verification/` — toolchain snapshot, pinned release inventories and coverage decisions, fixtures, command manifest + template project.
- `evals/` — activation + content evals with deterministic graders (`runs/` output is gitignored).
- `tooling/` — validators, runners, generators, and their tests.
- `research/` — the research note on making LLMs reliable in low-pretraining-coverage languages.

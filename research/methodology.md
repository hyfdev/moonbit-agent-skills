# How these skills were produced (the pipeline, so it can be re-run and audited)

This documents the actual production process used for v0.1.0 (2026-07-17), phase by phase, with the artifacts each phase left behind. The intent: anyone (including a future agent session) can re-run any phase, and anyone can audit whether a phase's output really follows from its inputs.

## Phase 1 — Upstream audit (before writing anything)

Sources fetched live and pinned: the Agent Skills specification (frontmatter constraints, progressive disclosure, validator), Vercel's agent-skills repo (engineering patterns only), the official moonbitlang/skills bundle and moonbit-agent-guide (cloned, audited file by file), docs.moonbitlang.com v0.10.4, release notes 0.8.0→0.10.4, and moonbit-evolution (found dormant; statuses lag shipped reality).

- Artifact: `verification/sources/sources.json` — every source with URL, pinned commit, retrieval date, and the load-bearing notes (e.g. docs' trait pages lag the v0.10.0 `fn`-keyword change).
- Audit conclusion that shaped everything: the official bundle's gaps are the version contract, language/toolchain separation, negative knowledge, and activation evals — so those became this repo's four deliverables (README "Why not just the official guides" is the audit's summary).

The initial v0.1.0 process had two serious completeness gaps. First, it verified every claim that authors chose to write, but nothing proved that authors had considered every release-note item. This allowed the repository to claim coverage through v0.10.4 while omitting `extend` and recommending behavior that v0.10.4 deprecated. Second, release notes only describe changes, so they could not reveal ordinary language topics that had never entered the repository; even after `extend` existed in a deep reference, nothing required the primary SKILL.md to name or route it.

The repair separates three contracts. Release completeness comes from a mechanical `moonbitlang/website` inventory and schema-v2 evidence decisions. Baseline language completeness comes from a mechanical `moonbitlang/moonbit-docs` inventory: all 33 pages reached from the language toctree and its includes, and all 227 document/heading items, must be routed to exact product content or have an explicit boundary. Discoverability is checked independently: each current actionable release decision and each routed language topic names a reference and exact terms that must coexist on one physical line in the owning skill's `Feature index`. None of these routing checks proves semantics; checked documentation, fixtures, command runs, and explicitly sourced documented-only text remain the truth gate.

The first baseline audit also proved why documentation cannot be promoted directly into the skill. Official docs present local type definitions as an ordinary feature, and the official language suite passes, but the package disables `deprecated_syntax`; an isolated warnings-denied POC shows the current compiler deprecates local types. The maintainer workflow therefore requires inspecting upstream warning configuration and rerunning a minimal unsuppressed POC before recommending syntax.

## Phase 2 — Probe the real toolchain (evidence before authorship)

Five parallel probe batteries ran against the locally installed toolchain, each following the same protocol (preserved verbatim at `research/probes/COMMON.md`): *write a minimal example → run `moon check`/`moon test` → record conclusion, exact code, exact command, verbatim output — never trust model memory; a rejection is a finding too.*

| Battery | Scope | Findings file |
| --- | --- | --- |
| p1 | core language (declarations, methods, visibility, structs/enums, patterns, traits) | `research/probes/p1-findings.md` (29) |
| p2 | errors, async, tests, FFI declarations, attributes/#cfg | `research/probes/p2-findings.md` (24) |
| p3 | data types, control flow, iteration | `research/probes/p3-findings.md` (52) |
| p4 | negative battery: Rust/TS/Go habits + stale MoonBit, each verified rejected/trapped | `research/probes/p4-findings.md` (52 cases) |
| p5 | toolchain commands, configs, targets, workspaces | `research/probes/p5-findings.md` (45) |

Probe agents also ran internal adversarial review rounds on their own findings files (factual errors found and fixed before any authoring consumed them). These raw files are the provenance for every reference: prose in the skills should trace back to a finding here or to a re-verification noted by the author.

## Phase 3 — Authoring under verification constraints

- One style-canon reference was written first (`declarations-and-functions.mbt.md`) and every other reference was required to match it.
- Hard authoring rules (enforced by tooling, not convention): every language example lives in an `mbt check` fence and is executed by `tooling/run_checked_docs.ts` on all four targets; wrong/deprecated forms only in `mbt nocheck` with the diagnostic; negative knowledge becomes fixtures under `verification/fixtures/` with expected diagnostics; every documented `moon` command line must be covered by `verification/commands/manifest.json`, which `tooling/verify_commands.ts` actually executes; facts that cannot be executed are labeled "documented, not executed" with the URL.
- Namespace discipline: all references compile together into one package, so files prefix their top-level names and prefer declarations inside test blocks.
- Each authoring batch got one adversarial review round by a fresh reviewer, fixes, and one confirmation round — before integration.

## Phase 4 — The version contract

Release completeness now precedes the version pin. A pinned upstream Markdown source generates `verification/releases/<release>/source.json`; its `coverage.json` must close every source item before any re-pin. `vp run snapshot-toolchain --date …` then writes the canonical toolchain snapshot; product-skill frontmatter, SKILL.md prose, and fixture stamps must agree with it (`tooling/check_versions.ts`). Fixtures are stamped by `vp run run-fixtures --stamp`. Nothing hand-writes a version string. The re-pin procedure for a new MoonBit release is in CONTRIBUTING.md and the full agent workflow is in `moonbit-agent-skills-maintainer`.

## Phase 5 — Activation as a tested interface

Descriptions were written to carry surface signals (file extensions, config names, commands, task verbs) plus explicit boundary/combination clauses, then tested: `evals/activation/run_activation.ts` installs the skills into a throwaway project, sends natural prompts (never naming a skill — the runner rejects prompts that do), and reads Skill-tool invocations from the headless transcript. The original matrix has 35 prompts across language-only / toolchain-only / combined / negative (confusables included); a targeted three-prompt check covers the internal maintainer and its boundary with ordinary `extend` questions. Results and their honest reading are in `evals/activation/RESULTS.md`. Content effectiveness was measured separately with condition comparisons (`evals/run_content.ts`, `evals/RESULTS.md`): the complete 11-task matrix ran on 2026-07-17, followed by a targeted cross-language-negative-knowledge ablation, one requested Sonnet `ours` condition per area, and two 0.10.4 release-derived migration tasks. Forced prompts name the installed `.claude/skills/<skill>` root so routed references resolve inside the skill. The full run also hardened deterministic grading with hidden behavior tests, observed-command checks, exact answer checks, client-exit checks, and preserved transcripts/failure workspaces.

## Phase 6 — Independent review, then reality

- Two independent reviewers attacked the finished repo in parallel (one on correctness/verifiability — ~31 claims attacked, none fell; one on product/consistency); their findings were fixed in one pass (`git log`: "Address adversarial review findings").
- The first real CI run on GitHub-hosted Linux then caught two environment-dependent facts local verification could not (fresh-machine `moon update` wording; llvm outcome differs by install channel) — fixed and folded back into the references. This is the designed loop: CI failures are new knowledge, not just breakage.

## Re-running / auditing checklist

- Re-verify everything at the current pin: the check sequence in AGENTS.md.
- Audit baseline language completeness: invoke `moonbit-agent-skills-maintainer`, re-pin `verification/language-surface/source.json` deliberately, close every new/renamed source item, and run both language-surface checks.
- Re-pin to a new toolchain: CONTRIBUTING.md § "Updating to a new MoonBit release".
- Audit or update release coverage: invoke `moonbit-agent-skills-maintainer`; regenerate the pinned source inventory before editing content.
- Re-probe an area from scratch: follow `research/probes/COMMON.md`, write findings in its format, then update references only from findings.
- Re-measure activation after any description change: AGENTS.md rule 6.
- Audit a claim's provenance: find it in a reference → locate its `mbt check` fence / fixture / manifest entry → if absent, it must say "documented, not executed"; else it is a process violation worth an issue.
- Known process debt (recorded, not hidden): the Codex activation sidecar was missed until review (AGENTS.md rule 7); async/FFI notes and part of the cross-language list are hand-verified at the pin, not CI-re-executed (stated inline in those files); H4 has only one compiler-detectable habit-transfer task and one run per condition, so the completed ablation found no benefit but cannot measure silent semantic traps or repeatability.

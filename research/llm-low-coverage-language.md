# Making LLM agents reliable in a low-pretraining-coverage language

Status: living note. Hypotheses, experiment design, raw results, and conclusions are kept in separate sections; nothing in "Conclusions" may cite anything not present in "Results".

## Problem

MoonBit is young (numbered releases only since 2026-02), changes monthly, and deprecates its own syntax aggressively (`loop`, `try?`, fn-less traits, JSON build configs — all deprecated within roughly a year). For such a language, an LLM's pretraining is some unknown mixture of: nothing, stale tutorials, proposals that never shipped, and adjacent-language habits. We do not claim the model has "no MoonBit training data" — that is unfalsifiable from the outside. We measure what the model actually does with no help (baseline condition), and then which mechanisms close the gap.

Two independent failure surfaces:

1. **Discovery**: given only a skill catalog (names + descriptions), does the agent activate the right knowledge for a natural request, without the user naming any skill?
2. **Execution**: once knowledge is available, do the materials plus toolchain feedback produce correct results?

A repository that fixes (2) but not (1) is a manual that nobody opens; fixing (1) but not (2) routes users to confident nonsense. They are evaluated separately (evals/activation vs evals/language|toolchain|integration).

## Hypotheses

- H1 (activation): A description that names concrete surface signals (file extensions `.mbt`/`.mbt.md`, config names `moon.mod`/`moon.pkg`, the `moon` command, task verbs) yields high trigger recall even when the prompt never says "MoonBit", while staying quiet on confusables (moonrepo, moon phases, generic wasm).
- H2 (routing): Two skills with explicitly disjoint descriptions ("language semantics only" vs "project operation only") route language-only and toolchain-only requests to exactly one skill, and combined requests to both, without a meta-router.
- H3 (baseline error profile): With no skills, agent errors are dominated by (a) stale MoonBit syntax, (b) Rust/TS/Go habit transfer, (c) proposal/current confusion — not by random noise. (Measured from the `none` condition transcripts.)
- H4 (negative knowledge): Explicit verified negative examples (rejected forms with diagnostics, silently-different traps) reduce habit-transfer errors more than additional positive examples alone.
- H5 (version contract): Exact version pins plus a "verify on mismatch" protocol produce agents that check and disclose version differences instead of asserting stale facts.
- H6 (compiler as oracle): Instructing the agent to validate load-bearing claims with `moon check` on scratch files converts many wrong-belief failures into self-corrected answers, at the cost of extra tool calls.

## Experiment design

- **Activation**: evals/activation/prompts.jsonl — 35 prompts in four categories (language-only, toolchain-only, combined, negative), including a slice where MoonBit is never named and must be inferred from files/configs/commands, and negatives chosen to be maximally confusable (the moonrepo build tool is literally invoked as `moon`). Runner: evals/activation/run_activation.ts; agent sees only the catalog; activation is read from Skill tool invocations in the transcript. Metrics: recall, false-positive rate, exact-routing accuracy, multi-skill accuracy, recall on the not-named slice, tokens/cost.
- **Content**: evals/language, evals/toolchain, evals/integration — tasks with deterministic graders (real `moon check`/`moon test` on the resulting workspace, file assertions, exact-first-line answers for capability questions). Conditions: `none` (baseline), `official` (moonbitlang/skills at the audited pin), `ours` (catalog-only), `forced-*` (skill content injected, isolating content quality from activation).
- Ground truths embedded in tasks were themselves verified against the pinned toolchain (e.g. `defer` exists and is block-scoped; `loop` is deprecated with warning 0027).
- All runs in fresh, isolated project directories; one run = one prompt = one fresh context.

Mechanisms under test, mapped to repository features: precise trigger descriptions (frontmatter), language/toolchain split (two skills), progressive disclosure (SKILL.md ≤ ~5k tokens + routed references), exact version metadata + mismatch protocol (SKILL.md verification contract), executable examples (mbt check references), verified negative examples (fixtures + cross-language reference), compiler/toolchain feedback loops (working rules), semantic API lookup (moon ide), automatic dual-skill loading for integrated tasks (boundary sections in both descriptions).

## Results

Full tables: evals/activation/RESULTS.md and evals/RESULTS.md (runs of 2026-07-17, Claude Code CLI 2.1.212).

- Activation (35 prompts, catalog-only): trigger recall 0.60 (haiku-4.5) / 0.76 (sonnet-5); false positives on 10 confusable negatives: 0 on both models; wrong-skill routing: 0 cases on both; combined-task dual activation 0.20 / 0.40; recall on the never-says-MoonBit slice 0.42 / 0.58. Every miss was under-activation (model worked bare-handed), never mis-routing.
- Content (full 11-task matrix, Haiku-requested client condition, deterministic grading): `none` 9/11, pinned official bundle 8/11, and `ours` 11/11. Forced content passed language 5/5 and toolchain 4/4; integration has no forced condition. A Sonnet-requested `ours` supplement passed 10/11.
- Two differences came from drifted language-capability questions: `none` and `official` both denied that `defer` exists; `official` called functional `loop` current, while `none` called it deprecated but named recursion rather than the current multi-binding `for` replacement. `ours` activated `moonbit-language` on exactly these two Haiku-requested tasks and answered both correctly. The official condition had one additional failure: its JS FFI binding built but produced a non-callable value at runtime.
- The no-skill baseline passed all 9 executable workspace tasks and invoked `moon` in every one. It failed both knowledge-only questions, where it did not perform a useful toolchain verification. No random-noise failure appeared.
- Catalog-only skill use remained sparse: the Haiku-requested and Sonnet-requested `ours` conditions each recorded a MoonBit Skill invocation in only 2/11 tasks. Haiku-requested `ours` passed 11/11; Sonnet-requested `ours` passed 10/11 after runtime grading exposed its build-valid but non-callable JS FFI binding. Most other actionable tasks were solvable from compiler and CLI feedback without loading a skill.
- H4 ablation: `fix-rust-habits` passed under full `forced-language` and under `forced-language-no-cross-language`, which removes the concentrated cross-language rule, route, and reference while keeping the rest of the forced skill. In the corrected pair, the full condition read the negative guide while the ablation could not because the file was absent. `none`, `official`, and `ours` also passed this task; no pass-rate or credible one-run efficiency benefit from the negative guide was observed.
- The full run found grader defects and reran affected cells after fixing them: legal anonymous `test {}` syntax and valid package-scoped test commands had caused false failures, while loose first-line and replacement checks had allowed false passes. The final loop-status check requires the current functional `for ... break` replacement. Task-local notes preserve each correction.
- The first forced-content runs exposed a separate harness error: relative reference paths in injected instructions lacked an explicit skill root. Forced language, forced toolchain, and the H4 pair were rerun after the prompt named `.claude/skills/<skill>`; the corrected H4 treatment visibly read the negative guide.
- Final review tightened command-result, source-isolation, package-preservation, nonzero-test, resume, answer-detail, and hidden-behavior checks after the model calls. Stored final answers and full transcripts were deterministically re-audited; Option and JS FFI workspaces were reconstructed from their edit traces, and migration behavior was checked against the preserved implementation. The JS runtime test changed primary official and Sonnet-requested `ours` from PASS to FAIL; no other classification changed. These post-run checks are audit evidence rather than fresh stochastic samples.
- Runtime disclosure: this Claude Code environment reported the requested Haiku/Sonnet model and `deepseek-v4-flash` together in `modelUsage`, with visible assistant stream events naming DeepSeek. These are client-stack results, not isolated single-model API results.

## Conclusions

Grounded strictly in the runs above; scope: one client, one full requested-model condition, one `ours`-only higher-capability supplement, one final run per cell, and the exact pinned toolchain.

1. **H1 partially supported, with an important refinement.** Concrete surface signals in descriptions produced perfect precision (zero false positives, zero mis-routes on both models) — but recall is gated by the model's willingness to consult the catalog at all, especially when workspace files invite immediate action. Description quality alone cannot buy recall on action-style tasks; capability-tier and client-side mechanisms (e.g. file-glob gating) are the levers there.
2. **H2 supported on precision, weak on combined recall.** No language/toolchain cross-routing occurred; but automatic dual activation on integrated tasks is the weakest measured point (0.2–0.4). Both boundary sections say "load both" — the models mostly load one or none first and proceed.
3. **H3 is weakly supported within this task set.** Both baseline failures involved stale or incomplete current-language knowledge, and all nine executable tasks passed, so no unexplained execution failure appeared. No adjacent-language habit survived to a final failure, and two failures cannot establish that the predicted classes dominate more broadly.
4. **H4 not supported by this experiment.** Removing the concentrated negative-knowledge guide did not change the one targeted task's outcome, and every other condition passed too. This does not show that negative knowledge is useless: the task's mistakes are compiler-visible, there was only one run, and silent semantic traps were not ablated.
5. **H5 is supported only for matched-pin content correctness; its mismatch protocol remains untested.** Version-pinned content corrected both moved-ground-truth questions at the exact pin. Because the installed toolchain matched, the experiment did not test whether an agent notices, verifies, and discloses a version mismatch.
6. **H6 is observationally consistent with the results, but its causal claim is untested.** The no-skill agent used `moon` and passed all nine executable tasks while failing both knowledge-only questions. The prompts themselves required successful checks or builds, and there is no no-tool control, so the run shows self-correction in transcripts but cannot attribute it to the skill's compiler-oracle instruction.

Honest overall read: verified content adds clear value where the ground truth moved and the task does not force an executable check. Compiler and CLI feedback are sufficient for many actionable tasks even without skills. Discovery remains sparse, but its measured consequence is concentrated in the knowledge-only cases that bare-handed execution cannot repair.

## Transferability

The intended transferable method, if the results support it: for any fast-moving low-coverage language, (1) split knowledge by activation boundary, not by textbook chapter; (2) make descriptions carry the language's surface signals; (3) pin versions and teach the mismatch protocol instead of writing "latest"; (4) make every example executable and every negative claim a fixture; (5) let the compiler, not the model, be the oracle of record. The MoonBit-specific content here is disposable by design; the harness is not.

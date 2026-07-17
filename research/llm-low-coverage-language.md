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

- **Activation**: evals/activation/prompts.jsonl — 35 prompts in four categories (language-only, toolchain-only, combined, negative), including a slice where MoonBit is never named and must be inferred from files/configs/commands, and negatives chosen to be maximally confusable (the moonrepo build tool is literally invoked as `moon`). Runner: evals/activation/run_activation.py; agent sees only the catalog; activation is read from Skill tool invocations in the transcript. Metrics: recall, false-positive rate, exact-routing accuracy, multi-skill accuracy, recall on the not-named slice, tokens/cost.
- **Content**: evals/language, evals/toolchain, evals/integration — tasks with deterministic graders (real `moon check`/`moon test` on the resulting workspace, file assertions, exact-first-line answers for capability questions). Conditions: `none` (baseline), `official` (moonbitlang/skills at the audited pin), `ours` (catalog-only), `forced-*` (skill content injected, isolating content quality from activation).
- Ground truths embedded in tasks were themselves verified against the pinned toolchain (e.g. `defer` exists and is block-scoped; `loop` is deprecated with warning 0027).
- All runs in fresh, isolated project directories; one run = one prompt = one fresh context.

Mechanisms under test, mapped to repository features: precise trigger descriptions (frontmatter), language/toolchain split (two skills), progressive disclosure (SKILL.md ≤ ~5k tokens + routed references), exact version metadata + mismatch protocol (SKILL.md verification contract), executable examples (mbt check references), verified negative examples (fixtures + cross-language reference), compiler/toolchain feedback loops (working rules), semantic API lookup (moon ide), automatic dual-skill loading for integrated tasks (boundary sections in both descriptions).

## Results

Full tables: evals/activation/RESULTS.md and evals/RESULTS.md (runs of 2026-07-17, Claude Code CLI 2.1.212).

- Activation (35 prompts, catalog-only): trigger recall 0.60 (haiku-4.5) / 0.76 (sonnet-5); false positives on 10 confusable negatives: 0 on both models; wrong-skill routing: 0 cases on both; combined-task dual activation 0.20 / 0.40; recall on the never-says-MoonBit slice 0.42 / 0.58. Every miss was under-activation (model worked bare-handed), never mis-routing.
- Content (smoke subset, haiku, deterministic grading): language area — baseline 1/3, official bundle 0/3, ours 3/3; both no-skill and official conditions asserted that `defer` does not exist and that `loop` is current (both false at the pin). Toolchain area — 2/2 in all conditions (no discrimination on those two tasks).
- Baseline error observations (H3): the no-skill and official-condition failures observed were exactly the predicted classes — stale-capability answers (defer, loop). No random-noise failures appeared in the smoke set.

## Conclusions

Grounded strictly in the runs above; scope: two models, one client, smoke-scale content data.

1. **H1 partially supported, with an important refinement.** Concrete surface signals in descriptions produced perfect precision (zero false positives, zero mis-routes on both models) — but recall is gated by the model's willingness to consult the catalog at all, especially when workspace files invite immediate action. Description quality alone cannot buy recall on action-style tasks; capability-tier and client-side mechanisms (e.g. file-glob gating) are the levers there.
2. **H2 supported on precision, weak on combined recall.** No language/toolchain cross-routing occurred; but automatic dual activation on integrated tasks is the weakest measured point (0.2–0.4). Both boundary sections say "load both" — the models mostly load one or none first and proceed.
3. **H3 supported at smoke scale**: baseline failures were stale-capability claims, not noise.
4. **H5/H6 directionally supported by the content smoke**: the only condition that answered moved-ground-truth questions correctly was the version-pinned skill; the compiler-feedback loop alone (baseline with Bash) already handles tasks whose truth is locally checkable, which is precisely where skills added no measurable value.
5. **H4 untested** (needs the fix-tasks slice of the full matrix under forced conditions).

Honest overall read: the harder half of the problem is discovery, not content. Content correctness is achievable with pinning + execution; getting agents to *reach* for that content on tasks they believe they can do bare-handed is the open edge, and it worsens as tasks look more actionable.

## Transferability

The intended transferable method, if the results support it: for any fast-moving low-coverage language, (1) split knowledge by activation boundary, not by textbook chapter; (2) make descriptions carry the language's surface signals; (3) pin versions and teach the mismatch protocol instead of writing "latest"; (4) make every example executable and every negative claim a fixture; (5) let the compiler, not the model, be the oracle of record. The MoonBit-specific content here is disposable by design; the harness is not.

# Content eval — full matrix

Run date: 2026-07-17 · runner: `run_content.py` · client: Claude Code CLI 2.1.212 · requested full-matrix model: `claude-haiku-4-5-20251001` · turn budget: 50 per cell · deterministic grading with the pinned MoonBit toolchain. The run host was Linux x86_64; `moon`, `moonc`, and `moonrun` exactly matched `verification/toolchains/current.json`, whose original verification platform was Darwin arm64. The official condition used `moonbitlang/skills@5caf81c57cb2ae45654b8f99c5c8f68c812beb91`.

The current client environment uses a mixed model stack: stream events name `deepseek-v4-flash`, while `modelUsage` also records the requested Haiku or Sonnet model. The labels below therefore describe requested Claude Code conditions, not isolated single-model API calls. This affects model attribution, not the deterministic pass/fail checks.

## Haiku-requested full matrix

### Language

| Task | none | official | ours | forced-language |
| --- | --- | --- | --- | --- |
| clamp API | PASS | PASS | PASS | PASS |
| defer exists | FAIL | FAIL | PASS | PASS |
| fix Rust habits | PASS | PASS | PASS | PASS |
| loop status | FAIL | FAIL | PASS | PASS |
| Option to checked error | PASS | PASS | PASS | PASS |
| **Total** | **3/5** | **3/5** | **5/5** | **5/5** |

The two discriminating tasks ask about ground truth that moved after likely training data. Both `none` and `official` said MoonBit has no `defer`; `official` also called functional `loop` current, while `none` knew it was deprecated but named recursion instead of the current multi-binding `for` replacement. `ours` activated `moonbit-language` on exactly these two tasks and answered both correctly. Every condition passed the three edit-and-verify tasks after using the local toolchain.

### Toolchain

| Task | none | official | ours | forced-toolchain |
| --- | --- | --- | --- | --- |
| generate `.mbti` | PASS | PASS | PASS | PASS |
| migrate legacy JSON config | PASS | PASS | PASS | PASS |
| add package | PASS | PASS | PASS | PASS |
| run one test file/package | PASS | PASS | PASS | PASS |
| **Total** | **4/4** | **4/4** | **4/4** | **4/4** |

These tasks did not discriminate among conditions. Every agent could discover the current command or configuration by inspecting help and iterating against `moon`.

### Integration

| Task | none | official | ours |
| --- | --- | --- | --- |
| fix code and config | PASS | PASS | PASS |
| JS FFI plus target setup | PASS | FAIL | PASS |
| **Total** | **2/2** | **1/2** | **2/2** |

No integration condition invoked either local skill. Build-only grading initially passed all six cells, but the final hidden JS runtime test under Node v24.18.0 found that the official condition's `extern "js" fn date_now() -> Int64 = "Date.now()"` built successfully and then failed because the imported value was not callable. The no-skill and `ours` implementations used callable arrow-function bindings and passed the independent `Date.now()` comparison.

Across the 11 directly comparable tasks, `none` passed 9/11, `official` passed 8/11, and `ours` passed 11/11. The catalog-only `ours` condition invoked a MoonBit skill in only 2/11 cells; those were precisely the two drifted capability questions that the no-skill condition missed. The additional official failure was a runtime FFI error that build-only feedback had not exposed.

## Sonnet-requested `ours` supplement

One `ours` condition per area was run as the issue's optional higher-capability supplement.

| Area | Pass rate | Cost |
| --- | --- | ---: |
| Language | 5/5 | $1.2506 |
| Toolchain | 4/4 | $0.9952 |
| Integration | 1/2 | $0.5048 |
| **Total** | **10/11** | **$2.7506** |

The Sonnet-requested client invoked a MoonBit skill in 2/11 cells (`loop-status` and `migrate-legacy`). Its JS FFI binding also built successfully but produced a non-callable imported value at runtime. Because only `ours` was run, this supplement is not a cross-condition comparison.

## H4 negative-knowledge ablation

The original matrix could not isolate negative knowledge: `forced-language` isolates activation, and the official bundle also contains cross-language warnings. A new `forced-language-no-cross-language` condition keeps the same forced language skill but removes its concentrated cross-language rule, routing entry, and `cross-language-and-stale-syntax.md` reference.

On `fix-rust-habits`, full `forced-language` and the ablation both passed; `none`, `official`, and `ours` also passed. In the path-corrected pair, the full condition read `cross-language-and-stale-syntax.md`, used 19 turns, and cost $0.1337; the ablation had no such file, used 17 turns, and cost $0.1148. One stochastic run is not an efficiency comparison. **Verdict: H4 is not supported by this experiment.** The compiler made this single task self-correcting, and the ablation does not prove that negative knowledge has no value on silent semantic traps.

## 0.10.4 release-derived supplement

Two deterministic edit tasks were added on 2026-07-18 for guidance introduced by the release audit. The requested model was `claude-haiku-4-5-20251001`; the same mixed client routing disclosed above resolved both that name and `deepseek-v4-flash`.

| Task | catalog-only `ours` | forced language skill |
| --- | --- | --- |
| Add explicit `extend` and deny warning 79 | PASS | PASS |
| Replace immutable `HashSet::from_array` | PASS | PASS |
| **Total** | **2/2** | **2/2** |

The first `extend` attempt exposed a grader defect rather than a product failure: the starter's private tuple constructor raised unrelated `unused_constructor` under global `--deny-warn`, so a correct `extend` edit still failed. Changing the starter to a public constructor isolated warning 79; direct baseline/fixed POCs then showed the old workspace failing on `implicit_impl_as_method` and the reference edit passing both `moon check` and one test with the exact warning flags. The corrected catalog-only rerun passed, and both forced-skill cells passed. Content-eval cost was $0.5656 including the discarded grader-defect cell; the two valid catalog-only cells cost $0.1743 and the forced pair cost $0.1655.

## What the full run says

- The no-skill baseline passed all 9 executable workspace tasks and invoked `moon` in every one; it failed both knowledge-only capability questions. Toolchain feedback closes a large part of the execution gap, while it cannot repair facts the agent never tests.
- Version-pinned content mattered at the matched pin: `ours` and forced language content corrected both moved-ground-truth questions. Version-mismatch behavior was not tested because the local toolchain exactly matched the pin.
- Catalog discovery remained sparse: Haiku-requested and Sonnet-requested `ours` each invoked a MoonBit skill in only 2/11 tasks. Most actionable tasks succeeded without loading a skill because the compiler and CLI exposed enough feedback.
- No unexplained baseline failure appeared. Both final failures involved stale or incomplete current-language knowledge; with only two failures, the run cannot establish how common that profile is more broadly.
- Build success was insufficient for the JS FFI task: the runtime grader changed one primary official cell and the Sonnet-requested supplement cell from PASS to FAIL.

## Grader corrections and audit trail

Before paid measurement, the runner was changed so a nonzero Claude exit cannot pass, exact-first-line checks are exact, full stdout/stderr and failed workspaces are preserved, the official cache commit is verified, the MoonBit pin is checked before the first model call, actual Bash commands can be graded, and hidden behavior tests prevent empty-project or deleted-test passes.

The run then exposed grader defects: legal anonymous `test {}` blocks and valid package-scoped forms (`moon test -p utils`, `moon test utils[/]`) caused false failures; prefix matching accepted extra text after a required first-line token; and the loop-status grader first accepted a claim that `loop` was removed, then accepted a generic mention of `for` without the required functional `for ... break` replacement. Each `task.json` records its correction. Replacement reruns were used for the affected cells, and the final loop-status rerun passed only after producing the specific current replacement.

The first forced-content runs also exposed a harness error: injected instructions referred to relative `references/...` paths without naming their installed skill root, so attempted reads could resolve outside the skill. The runner now states the root explicitly; all forced language and toolchain cells, plus the H4 pair, were rerun with accessible references. Unit tests cover the prompt root, exact first-line grading, observed Bash commands, source preservation, temporary hidden tests, the ablation, and the accepted trailing-slash package command.

Final review added conservative checks after the paid model calls: successful Bash evidence is now linked to its tool result and expected output, command regexes reject extra test scope, recursive source checks exclude injected `.claude` templates, required package files and nonzero hidden-test discovery prevent empty-project passes, resume configuration is fixed in `run.json`, and answer/behavior graders enforce details that the prompts already required. These checks are not present in every original `results.jsonl` record. Preserved artifacts were re-audited without another stochastic model sample: final-text checks were reapplied to the stored answers; every final MBTI and single-test transcript passed the new command-plus-result checks; all six stored Option implementations and all four JS FFI implementations were reconstructed from their Write/Edit traces and executed against their hidden tests; and the migration transcripts preserved the original `twice` implementation, whose hidden behavior test passed after the deterministic migration. The JS runtime audit changed primary official and Sonnet-requested `ours` from PASS to FAIL; no other classification changed. The checked-in unit suite covers the new false-pass cases.

Primary full-matrix cost was $3.7752. The requested-Sonnet supplement cost $2.7506, all H4, grader-correction, and path-correction runs cost $1.6307, and the release-derived supplement cost $0.5656, for $8.7221 of checked content runs including superseded cells. Raw records, transcripts, stderr, and failed workspaces remain under the gitignored `evals/*/runs/` directories.

Limitations: one run per final cell; mixed client model routing as disclosed above; Sonnet requested only for `ours`; the H4 ablation covers one compiler-detectable Rust-habit task and removes the concentrated guide rather than every negative sentence in the skill; Bash network access was not OS-blocked, although transcript inspection found no model-initiated network lookup; and the run platform differs from the original verification platform even though all pinned component versions match.

# Content eval results

## 2026-07-18 frozen paired runs

The current language skill was compared with a purpose-built route ablation that removes only explicit top-level `extend` guidance while preserving the trait/generics route and every reference byte-for-byte. Tasks, skill trees, the derived ablation, runner files, actual model, and condition order were frozen before calls.

| Client and task group | Current | Route ablation | Eligible pairs | Current only | Ablation only | Both pass | Cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Kimi/K3, two `extend` tasks × 3 | 6/6 | 6/6 | 6 | 0 | 0 | 6 | subscription; USD unavailable |
| Kimi/K3, two regression controls × 3 | 6/6 | 6/6 | 6 | 0 | 0 | 6 | included above |
| DeepSeek Flash, two `extend` tasks × 1 | 2/2 | 2/2 | 2 | 0 | 0 | 2 | $0.962685 |

No run established a task-outcome improvement. The Kimi primary tasks did show a small process difference, reported descriptively because there are only six pairs:

| `extend`-task discovery, Kimi/K3 | Current | Route ablation | Paired current-only | Paired ablation-only |
| --- | ---: | ---: | ---: | ---: |
| Language skill loaded successfully | 3/6 | 1/6 | 3 | 1 |
| Target reference read | 6/6 | 4/6 | 2 | 0 |
| Target reference read before action | 5/6 | 2/6 | 3 | 0 |

The top-level route may help Kimi reach the correct reference earlier, but the final tasks hit a 100% ceiling in both conditions. Kimi used 4,378,948 input tokens, including 4,129,024 cache-read tokens, and 56,056 output tokens across 24 cells; total cell time was 58.9 minutes. All cells emitted `k3` through provider Kimi with alias `kimi-code/k3`; there were no missing pairs, model mismatches, timeouts, or nonzero client exits. The DeepSeek cross-check emitted `deepseek-v4-flash` in all four cells and likewise had no client or model exclusions.

Before measurement, 11 grader contracts exercised one canonical correct answer and at least two plausible wrong answers per task. After model answers exposed additional valid wording, the final contract suite contains 41/41 passing cases. Measurements affected by an earlier grader or ablation definition are excluded rather than repaired in place.

## Historical full matrix

Run date: 2026-07-17 · runner: `run_content.ts` · client: Claude Code CLI 2.1.212 · requested full-matrix model: `claude-haiku-4-5-20251001` · turn budget: 50 per cell · deterministic grading with an exact MoonBit toolchain build. The full matrix ran on Linux x86_64 with moonc `v0.10.4+ade96c819` (2026-07-13). A release-drift follow-up ran with the current snapshot, moonc `v0.10.4+2cc641edf` (2026-07-15). The official condition used `moonbitlang/skills@5caf81c57cb2ae45654b8f99c5c8f68c812beb91`.

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

The first `extend` attempt exposed a grader defect rather than a product failure: the starter's private tuple constructor raised unrelated `unused_constructor` under global `--deny-warn`, so a correct `extend` edit still failed. Changing the starter to a public constructor isolated warning 79. CI then found that the 2026-07-15 compiler changed behavior without changing the 0.10.4 release number: warning 79 moved into the default deprecated-warning set, and or-pattern defaults now require the `with` clause inside parentheses. The first follow-up prompt also allowed a qualified trait call that preserved runtime behavior but changed the requested dot-call API, so that ambiguous cell was discarded and the prompt now states the API requirement directly. At the current exact build, both catalog-only and forced-skill conditions passed the corrected task with `moon check --deny-warn` and one test. Release-supplement cost was $0.9138 including both discarded prompt/grader cells; the corrected post-drift pair cost $0.1673.

## Language-reference discoverability follow-up

Run date: 2026-07-18 · client: Claude Code CLI 2.1.212 · pinned moonc: `v0.10.4+2cc641edf` · historical condition: skill tree `291192ad3ba3bd5c3bd47e4352580fab7682d711` at `b4a323735da6f2f33d8846536f912eaf339f2512` · current condition: skill tree `090a9057d2b9ab7d8e39fdcddaef52f2301f1899` at `b612b7412baeea833a35af4b6277a9e757b1e1e0`. Each run manifest records both tree IDs and every installed skill file's SHA-256. No user-level or plugin-provided `moonbit-language` skill was present.

The two tasks start from warning-free, passing cross-package projects, do not name `extend`, and do not expose a compiler diagnostic that contains the answer. Hidden graders require the exact public attachment, preserve qualified APIs and trait implementations, test downstream dot calls with fresh values, and prove that an unselected method remains unavailable.

| Requested condition | Emitted model | Baseline outcome | Current outcome | Baseline skill / reference | Current skill / reference | Cost |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Haiku, two balanced repetitions | `deepseek-v4-flash` | 3/4 | 3/4 | 1/4 / 3/4 | 1/4 / 3/4 | $0.8098 |
| Sonnet, one repetition | `deepseek-v4-pro` | 2/2 | 2/2 | 2/2 / 2/2 | 2/2 / 2/2 | $1.6297 |

`skill` counts a successful `Skill` tool result. `reference` counts a successful read of `references/traits-and-generics.mbt.md` before an action in a later assistant turn. Neither is part of functional PASS.

The measured result is a tie. The current skill makes `extend` explicit in its top-level feature index and closes a mechanical completeness gate, but these samples do not show a functional gain over the old skill: the old deep trait reference already contained the syntax whenever the model found it. On the failed low-cost repetition, both conditions skipped the skill and reference and wrote a standalone `fn Robot::greet`, which the hidden grader rejected. The stronger run loaded the skill and routed reference in every cell and both conditions passed.

One earlier four-cell run was discarded after it exposed an ambiguous task contract: both conditions added the correct `pub extend` but removed a qualified wrapper that the hidden grader expected even though the prompt had not explicitly protected it. The prompt now names that requirement. The discarded run cost $0.4538 and is excluded from the table.

## What the full run says

- The no-skill baseline passed all 9 executable workspace tasks and invoked `moon` in every one; it failed both knowledge-only capability questions. Toolchain feedback closes a large part of the execution gap, while it cannot repair facts the agent never tests.
- Exact-build content mattered: `ours` and forced language content corrected both moved-ground-truth questions, and the follow-up caught semantic drift between two compiler builds that both report MoonBit 0.10.4. The repository now keys validation to the full moonc build identifier rather than the release number alone.
- Catalog discovery remained sparse: Haiku-requested and Sonnet-requested `ours` each invoked a MoonBit skill in only 2/11 tasks. Most actionable tasks succeeded without loading a skill because the compiler and CLI exposed enough feedback.
- No unexplained baseline failure appeared. Both final failures involved stale or incomplete current-language knowledge; with only two failures, the run cannot establish how common that profile is more broadly.
- Build success was insufficient for the JS FFI task: the runtime grader changed one primary official cell and the Sonnet-requested supplement cell from PASS to FAIL.

## Grader corrections and audit trail

Before paid measurement, the runner was changed so a nonzero Claude exit cannot pass, exact-first-line checks are exact, full stdout/stderr and failed workspaces are preserved, the official cache commit is verified, the MoonBit pin is checked before the first model call, actual Bash commands can be graded, and hidden behavior tests prevent empty-project or deleted-test passes.

The run then exposed grader defects: legal anonymous `test {}` blocks and valid package-scoped forms (`moon test -p utils`, `moon test utils[/]`) caused false failures; prefix matching accepted extra text after a required first-line token; and the loop-status grader first accepted a claim that `loop` was removed, then accepted a generic mention of `for` without the required functional `for ... break` replacement. Each `task.json` records its correction. Replacement reruns were used for the affected cells, and the final loop-status rerun passed only after producing the specific current replacement.

The first forced-content runs also exposed a harness error: injected instructions referred to relative `references/...` paths without naming their installed skill root, so attempted reads could resolve outside the skill. The runner now states the root explicitly; all forced language and toolchain cells, plus the H4 pair, were rerun with accessible references. Unit tests cover the prompt root, exact first-line grading, observed Bash commands, source preservation, temporary hidden tests, the ablation, and the accepted trailing-slash package command.

Final review added conservative checks after the paid model calls: successful Bash evidence is now linked to its tool result and expected output, command regexes reject extra test scope, recursive source checks exclude injected `.claude` templates, required package files and nonzero hidden-test discovery prevent empty-project passes, resume configuration is fixed in `run.json`, and answer/behavior graders enforce details that the prompts already required. These checks are not present in every original `results.jsonl` record. Preserved artifacts were re-audited without another stochastic model sample: final-text checks were reapplied to the stored answers; every final MBTI and single-test transcript passed the new command-plus-result checks; all six stored Option implementations and all four JS FFI implementations were reconstructed from their Write/Edit traces and executed against their hidden tests; and the migration transcripts preserved the original `twice` implementation, whose hidden behavior test passed after the deterministic migration. The JS runtime audit changed primary official and Sonnet-requested `ours` from PASS to FAIL; no other classification changed. The checked-in unit suite covers the new false-pass cases.

Primary full-matrix cost was $3.7752. The requested-Sonnet supplement cost $2.7506, all H4, grader-correction, and path-correction runs cost $1.6307, and the release-derived supplement cost $0.9138, for $9.0703 of checked content runs including superseded cells. Raw records, transcripts, stderr, and failed workspaces remain under the gitignored `evals/*/runs/` directories.

Limitations: one run per final cell; mixed client model routing as disclosed above; Sonnet requested only for `ours`; the H4 ablation covers one compiler-detectable Rust-habit task and removes the concentrated guide rather than every negative sentence in the skill; Bash network access was not OS-blocked, although transcript inspection found no model-initiated network lookup; and most primary cells ran on the superseded 2026-07-13 exact build, while the corrected `extend` follow-up ran on the current 2026-07-15 exact build.

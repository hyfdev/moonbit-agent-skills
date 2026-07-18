# Activation eval — checked-in snapshot

Protocol note for new runs: the current runner labels `mode=routing` as `prompted-routing-classification`. It explicitly asks the agent to classify and load applicable skills, so it must not be reported as automatic activation; that claim requires `mode=end-to-end` on the natural request. Each historical section below retains the protocol description under which it was recorded.

## 2026-07-18 frozen-runner smoke

This four-prompt Kimi/K3 run verifies the real-client path after activation inputs and successful Skill results became frozen and auditable. It is a runner smoke, not an accuracy estimate and not an automatic-activation measurement.

| Prompt | Required | Attempted | Loaded successfully | Exact and timely |
| --- | --- | --- | --- | ---: |
| Ordinary `extend` question | language | language | language | PASS |
| One-test-file command | toolchain | toolchain | toolchain | PASS |
| JS FFI code plus configuration | language + toolchain | language + toolchain | language + toolchain | PASS |
| Moonshot coffee brand | none | none | none | PASS |

| Audit field | Result |
| --- | ---: |
| Completed cells | 4/4 |
| Failed Skill loads / client errors / timeouts | 0 / 0 / 0 |
| Observed model | `k3` in 4/4 cells |
| Prompt snapshot | 4 prompts, SHA-256 `7781534b…74060` |
| Skill snapshot | 33 files, aggregate SHA-256 `a15cb798…9960` |
| Usage | 157,378 input tokens, including 141,312 cache-read; 931 output tokens |
| Total cell time | 110.5 seconds |
| Access mode | Kimi subscription |

The run manifest also pins the activation runner and shared client parser hashes. All four cells materialized their catalog from the frozen snapshot rather than the live worktree.

Run date: 2026-07-17 · runner: `run_activation.ts` · 35 prompts · skills at commit of this snapshot · client: Claude Code CLI 2.1.212, catalog-only discovery (prompts never name skills; the runner rejects prompts that do). Raw per-prompt records live in gitignored `runs/`; these tables are the durable summary.

| Metric | haiku-4.5 | sonnet-5 |
| --- | --- | --- |
| Trigger recall (all positive prompts) | 0.60 | 0.76 |
| — language-only (n=10) | 0.70 | 0.80 |
| — toolchain-only (n=10) | 0.70 | 0.90 |
| — combined (n=5) | 0.20 | 0.40 |
| False-positive rate on negatives (n=10) | 0.00 | 0.00 |
| Wrong-skill routing (activated but wrong side) | 0 cases | 0 cases |
| Multi-skill exact on combined | 0.20 | 0.40 |
| Recall when "MoonBit" never named (n=12) | 0.42 | 0.58 |
| User ever needed to name a skill | no | no |

## Reading

1. **The description interface itself did not misfire once on either model**: all 10 confusable negatives (moonrepo's `moon` CLI, moon phases, generic wasm-GC, Rust/TS/Go/Python lookalikes, Moonshot branding) stayed quiet, and no prompt ever activated the wrong MoonBit skill.
2. **Every recall miss is under-activation, not mis-routing**: the model answers or edits bare-handed instead of loading any skill. This dominates on action-style prompts with workspace files (the model dives into Read/edit), and on combined project tasks. Recall rises with model capability (0.60 → 0.76), consistent with activation being a judgment behavior of the model, not a property of the catalog entry.
3. Six prompts hit the 12-turn cap with tools disallowed (marked `errors` in summaries); their activation observations remain valid — truncation only limits task completion, which this eval does not grade.

This legacy snapshot predates the normalized token and duration rollup now required by the runner; the durable table retains its model/client identity and six recorded turn-limit errors without reconstructing missing usage totals.

## Known limitations / next levers

- Run in the author's normal user environment: the user-level skill catalog contained unrelated (non-MoonBit) personal skills as constant background noise across models and conditions.
- Not yet tested: Claude Code `paths` frontmatter (glob-gated auto-activation on `.mbt`/`moon.pkg` files) — the highest-leverage fix for the workspace-file under-activation pattern, though it is a client-specific extension; description phrasing A/B tests; opus-class models.

Reproduce: `node evals/activation/run_activation.ts --model <model> --run-name <name>`.

## 2026-07-18 targeted internal-maintainer check

This was a targeted three-prompt addition, not a rerun of the 35-prompt product-skill matrix above. Client: Claude Code CLI 2.1.212; requested model: `claude-haiku-4-5-20251001`; observed model: `deepseek-v4-flash`. The three cells recorded 107,281 input tokens, 759,808 cache-read input tokens, and 5,728 output tokens. Two cells reached the declared turn limit; there were no timeouts. This is a mixed client-routing result rather than an isolated Haiku API run.

| Prompt | Expected | Activated | Exact |
| --- | --- | --- | --- |
| Release audit | internal maintainer | none | no |
| Release update | internal maintainer | internal maintainer | yes |
| Ordinary `extend` question | language only | language only | yes |

Maintenance auto-activation was 1/2; the missed audit was under-activation, not routing to a product skill. The ordinary `extend` request activated only the language skill, so adding the internal maintainer did not steal that product request. Both maintenance runs reached the runner's turn limit after the activation decision; the activation observations remain usable, but this small check does not establish reliable implicit activation. The maintainer remains explicitly invocable for repository work.

## 2026-07-18 language-reference rerun

The 38-prompt catalog suite was rerun after the language feature index and description update with the same 12-turn budget as the checked-in 35-prompt baseline. Client: Claude Code CLI 2.1.212; requested model: `claude-haiku-4-5-20251001`; resolved usage named both that model and `deepseek-v4-flash`. The run recorded 1,242,678 input tokens, 4,419,328 cache-read input tokens, and 67,628 output tokens. Two cells ended with client errors; neither was a timeout.

| Category | Current | Earlier checked snapshot |
| --- | ---: | ---: |
| Language-only, original 10 prompts | 8/10 | 7/10 |
| Added ordinary `extend` prompt | 1/1 | not present |
| Toolchain-only | 5/10 | 7/10 |
| Combined exact dual activation | 1/5 | 1/5 |
| Confusable negatives | 10/10 | 10/10 |
| Maintenance-only | 0/2 | previously 1/2 in a separate targeted run |
| Positive recall, all 28 current prompts | 15/28 | not directly comparable |

The ordinary `extend` request activated only `moonbit-language`, and no negative prompt activated a MoonBit skill. The one-case language increase is not evidence that the new wording generally improves activation: this is one stochastic mixed-routing run, and the unchanged toolchain prompts moved in the opposite direction. The reliable result is that adding explicit language terms did not create false positives or steal ordinary `extend` requests for the internal maintainer.

A preceding three-turn trial was excluded because its turn budget did not match the historical run. Its 38 cells recorded 1,087,512 input tokens, 1,598,080 cache-read input tokens, 28,814 output tokens, and 17 client errors; it contributes no reported comparison.

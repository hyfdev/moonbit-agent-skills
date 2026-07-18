# Activation eval — checked-in snapshot

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
| Run cost (USD, API) | 1.05 | 6.50 |

## Reading

1. **The description interface itself did not misfire once on either model**: all 10 confusable negatives (moonrepo's `moon` CLI, moon phases, generic wasm-GC, Rust/TS/Go/Python lookalikes, Moonshot branding) stayed quiet, and no prompt ever activated the wrong MoonBit skill.
2. **Every recall miss is under-activation, not mis-routing**: the model answers or edits bare-handed instead of loading any skill. This dominates on action-style prompts with workspace files (the model dives into Read/edit), and on combined project tasks. Recall rises with model capability (0.60 → 0.76), consistent with activation being a judgment behavior of the model, not a property of the catalog entry.
3. Six prompts hit the 12-turn cap with tools disallowed (marked `errors` in summaries); their activation observations remain valid — truncation only limits task completion, which this eval does not grade.

## Known limitations / next levers

- Run in the author's normal user environment: the user-level skill catalog contained unrelated (non-MoonBit) personal skills as constant background noise across models and conditions.
- Not yet tested: Claude Code `paths` frontmatter (glob-gated auto-activation on `.mbt`/`moon.pkg` files) — the highest-leverage fix for the workspace-file under-activation pattern, at the cost of being a client-specific extension; description phrasing A/B tests; opus-class models.

Reproduce: `node evals/activation/run_activation.ts --model <model> --run-name <name>`.

## 2026-07-18 targeted internal-maintainer check

This was a targeted three-prompt addition, not a rerun of the 35-prompt product-skill matrix above. Client: Claude Code CLI 2.1.212; requested model: `claude-haiku-4-5-20251001`; cost: $0.2575. As in the content eval, stream events named `deepseek-v4-flash` while usage also recorded the requested model, so this is a mixed client-routing result rather than an isolated Haiku API run.

| Prompt | Expected | Activated | Exact |
| --- | --- | --- | --- |
| Release audit | internal maintainer | none | no |
| Release update | internal maintainer | internal maintainer | yes |
| Ordinary `extend` question | language only | language only | yes |

Maintenance auto-activation was 1/2; the missed audit was under-activation, not routing to a product skill. The ordinary `extend` request activated only the language skill, so adding the internal maintainer did not steal that product request. Both maintenance runs reached the runner's turn limit after the activation decision; the activation observations remain usable, but this small check does not establish reliable implicit activation. The maintainer remains explicitly invocable for repository work.

## 2026-07-18 language-reference rerun

The 38-prompt catalog suite was rerun after the language feature index and description update with the same 12-turn budget as the checked-in 35-prompt baseline. Client: Claude Code CLI 2.1.212; requested model: `claude-haiku-4-5-20251001`; resolved usage named both that model and `deepseek-v4-flash`; cost: $2.2728.

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

A preceding three-turn trial was excluded because its turn budget did not match the historical run. It cost $1.6202 and contributes no reported comparison.

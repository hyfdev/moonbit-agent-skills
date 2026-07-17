# Activation eval — checked-in snapshot

Run date: 2026-07-17 · runner: `run_activation.py` · 35 prompts · skills at commit of this snapshot · client: Claude Code CLI 2.1.212, catalog-only discovery (prompts never name skills; the runner rejects prompts that do). Raw per-prompt records live in gitignored `runs/`; these tables are the durable summary.

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

Reproduce: `python3 evals/activation/run_activation.py --model <model> --run-name <name>`.

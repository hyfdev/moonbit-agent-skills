# Content eval — checked-in snapshot (smoke subset)

Run date: 2026-07-17 · runner: `run_content.py` · model: claude-haiku-4-5 · deterministic grading (real `moon` commands + regex assertions). This is a smoke subset (5 of 8 tasks, 3 of 5 conditions), run to validate the harness end-to-end and get a first signal; the full matrix commands are at the bottom.

## Language area (3 tasks: defer-exists, loop-status, fix-rust-habits)

| Condition | Pass rate | Notes |
| --- | --- | --- |
| none (baseline) | 1/3 | Both capability questions answered WRONG from pretraining: said MoonBit has no `defer` (it does, since 2025-08) and treated `loop` as current (deprecated since v0.9). Fixed the Rust-habit file by leaning on compiler feedback. |
| official moonbitlang/skills @5caf81c | 0/3 | Same two capability errors (its skills also answered no-defer / loop-current — the official fundamentals reference itself still teaches `loop`); also failed the Rust-habit fix within the turn budget after routing through moonbit-orientation. |
| ours (catalog-only activation) | 3/3 | Activated moonbit-language on both capability questions and answered correctly; Rust-habit fix passed. |

## Toolchain area (2 tasks: migrate-legacy, single-test-command)

| Condition | Pass rate |
| --- | --- |
| none | 2/2 |
| official | 2/2 |
| ours | 2/2 |

No discrimination on these two tasks: legacy-JSON migration and path-scoped test runs are within haiku's bare-handed reach when it can iterate against `moon` itself. (First runs of single-test-command showed all conditions failing — that was a grader bug, a `failed` regex matching moon's normal `failed: 0` output; fixed in the task definition and re-run.)

## Interpretation so far

Where the ground truth moved after the models' training data (defer, loop), only the version-pinned skill produced correct answers — including against the official bundle. Where toolchain feedback loops suffice (config migration, test filtering), skills added nothing measurable on these smoke tasks. Matches the design thesis: the value concentrates in drift-prone knowledge, and the compiler-as-oracle loop is the floor that all conditions share.

## Remaining full matrix (not yet run; exact commands)

```sh
python3 evals/run_content.py --area language    --condition none --condition official --condition ours --condition forced-language
python3 evals/run_content.py --area toolchain   --condition none --condition official --condition ours --condition forced-toolchain
python3 evals/run_content.py --area integration --condition none --condition official --condition ours
```

Reason not run in this snapshot: session token budget; the harness, tasks, workspaces, and graders are complete and validated by the smoke runs above (plus `--dry-run` for all areas).

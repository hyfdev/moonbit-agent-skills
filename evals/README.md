# Evals

Three separate questions get three separate eval families:

1. **Activation** (`activation/`) — can the agent, seeing only the skill catalog (names + descriptions), decide per natural request whether to load moonbit-language, moonbit-toolchain, both, or neither? No eval here ever names a skill in the prompt; the runner rejects prompts that do.
2. **Content** (`language/`, `toolchain/`, `integration/`) — once knowledge is available, does the agent finish MoonBit tasks correctly? Conditions compare no skills, the pinned official `moonbitlang/skills` bundle, this repository's catalog-only skills, and force-injected single skills. `forced-language-no-cross-language` is a targeted H4 ablation: it removes the concentrated cross-language rule, route, and reference while retaining the rest of the forced language skill.
3. **Error reporting** (`reporting/`) — when the installed guidance conflicts with observed behavior, does the agent verify the conflict, fix the task, display a complete privacy-scrubbed issue draft and template link, and stop without invoking GitHub? The same scenarios run with and without the skill.

All runners are TypeScript executed directly by Node.js 24 and need the Claude Code CLI (`claude`) with credentials for paid runs. The content and reporting runners also need `moon` on `PATH`; content additionally needs `git`, and Node executes its JS-target tests. Before its first model call, the content runner verifies its executables, records the Node version, and checks every MoonBit component against `verification/toolchains/current.json`; the reporting runner likewise refuses to run without Node.js 24+, Claude Code, and the exact MoonBit pin. Grading is deterministic — real commands, file/state assertions, hidden behavior tests, and transcript assertions, never an LLM judge.

## Running

```sh
# Validate prompt/task definitions without spending tokens.
node evals/activation/run_activation.ts --dry-run
node evals/run_content.ts --area language --condition none --dry-run
node evals/reporting/run_reporting.ts --dry-run

# Full activation eval.
node evals/activation/run_activation.ts --model claude-haiku-4-5-20251001

# Full content matrix, one area per process.
node evals/run_content.ts --area language --condition none --condition official --condition ours --condition forced-language --max-turns 50
node evals/run_content.ts --area toolchain --condition none --condition official --condition ours --condition forced-toolchain --max-turns 50
node evals/run_content.ts --area integration --condition none --condition official --condition ours --max-turns 50

# Targeted H4 ablation.
node evals/run_content.ts --area language --ids lang-fix-rust-habits --condition forced-language-no-cross-language --max-turns 50 --run-name h4-no-cross-language

# Error-reporting behavior comparison.
node evals/reporting/run_reporting.ts --model claude-haiku-4-5-20251001 --run-name reporting-manual-only

# Reapply the current deterministic scorer to a preserved reporting run without model calls.
node evals/reporting/run_reporting.ts --regrade-run reporting-manual-only
```

For activation and content, use a fresh `--run-name` for a new measurement. A pre-existing `results.jsonl` is rejected unless `--resume` is given; resume skips completed task/condition pairs and recomputes the summary from old plus new records. These runners write `run.json` before the first task and refuse to resume when the recorded run configuration or environment changed. Reporting runs are smaller one-shot comparisons: always use a fresh name; the runner rejects an existing directory and does not support resume. `--regrade-run` only reapplies the checked-in deterministic scorer to preserved artifacts and makes no model call.

Results are written to `*/runs/<run-name>/` and gitignored. Activation and content use `run.json`, `results.jsonl`, `summary.json`, `transcripts/`, and, for content failures, `failed-workspaces/`. Reporting stores per-scenario answers, sanitized workspace snapshots, detected GitHub command attempts, transcripts, and deterministic grading under `iteration-1/`, plus a top-level `summary.json`. Checked-in results live in the corresponding `RESULTS.md` snapshots with date, client/model disclosure, corrections, and cost.

## `activation/prompts.jsonl` schema

One JSON object per line:

| Field | Meaning |
| --- | --- |
| `id` | unique prompt id |
| `category` | `language-only` / `toolchain-only` / `combined` / `maintenance-only` / `negative` |
| `moonbit_named` | whether the prompt text says "MoonBit" (false = infer it from files, configs, or commands) |
| `prompt` | the natural user request, exactly as sent |
| `workspace` | optional map of relative path to file content materialized in the project |
| `expected.required` | skills that must activate |
| `expected.forbidden` | skills that must not activate |

Grading: `recall_ok` means all required skills activated; `no_forbidden` means nothing forbidden activated; `exact` means the activated set equals the required set.

## Content task schema (`<area>/tasks/<id>/task.json`)

| Field | Meaning |
| --- | --- |
| `id` | task id, equal to the directory name |
| `prompt` | the natural user request |
| `grader_note` | optional dated explanation of a grader correction |
| `grade` | deterministic checks, all of which must pass |

Check types: `moon` runs a MoonBit command and expects exit 0 unless `expect_ok: false`; its optional `temp_files` map installs hidden grader files only for that command, while `min_tests` rejects a successful no-op test run that discovered too few tests. File checks are `file_exists`, `file_absent`, `file_contains`, and `any_file_contains`; recursive content checks exclude injected `.claude` content and generated `_build` files. Answer checks are `output_matches`, `output_not_matches`, and exact `first_line_is`. `command_matches` inspects Bash calls with successful tool results rather than trusting the final answer and can also require an `output_regex`; task regexes should anchor the entire command when extra arguments would change its scope. `initial_files_unchanged` verifies that no initial workspace file changed or disappeared and no file was added outside runner-managed `.claude` and generated `_build`. The runner appends a mandatory `client_exit` check, so a timeout or nonzero Claude exit cannot pass. The optional `workspace/` directory is copied into the isolated project before each run.

Ground truths embedded in tasks (for example, `defer` exists and functional `loop` is deprecated but still accepted) were verified against `verification/toolchains/current.json`; re-verify them when re-pinning.

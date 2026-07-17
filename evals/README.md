# Evals

Two separate questions get two separate eval families:

1. **Activation** (`activation/`) — can the agent, seeing only the skill catalog (names + descriptions), decide per natural request whether to load moonbit-language, moonbit-toolchain, both, or neither? No eval here ever names a skill in the prompt; the runner rejects prompts that do.
2. **Content** (`language/`, `toolchain/`, `integration/`) — once knowledge is available, does the agent finish MoonBit tasks correctly? Conditions compare no skills, the pinned official `moonbitlang/skills` bundle, this repository's catalog-only skills, and force-injected single skills. `forced-language-no-cross-language` is a targeted H4 ablation: it removes the concentrated cross-language rule, route, and reference while retaining the rest of the forced language skill.

Both runners need the Claude Code CLI (`claude`) with credentials. The content runner also needs `moon` and Node.js (`node`) on `PATH`; Node executes JS-target tests. Before its first model call, the content runner verifies that `claude`, `moon`, `node`, and `git` exist, records the Node version, and checks that every MoonBit component matches `verification/toolchains/current.json`. Grading is deterministic — real commands, file/state assertions, hidden behavior tests, and transcript assertions, never an LLM judge.

## Running

```sh
# Validate prompt/task definitions without spending tokens.
python3 evals/activation/run_activation.py --dry-run
python3 evals/run_content.py --area language --condition none --dry-run

# Full activation eval.
python3 evals/activation/run_activation.py --model claude-haiku-4-5-20251001

# Full content matrix, one area per process.
python3 evals/run_content.py --area language --condition none --condition official --condition ours --condition forced-language --max-turns 50
python3 evals/run_content.py --area toolchain --condition none --condition official --condition ours --condition forced-toolchain --max-turns 50
python3 evals/run_content.py --area integration --condition none --condition official --condition ours --max-turns 50

# Targeted H4 ablation.
python3 evals/run_content.py --area language --ids lang-fix-rust-habits --condition forced-language-no-cross-language --max-turns 50 --run-name h4-no-cross-language
```

Use a fresh `--run-name` for a new measurement. A pre-existing `results.jsonl` is rejected unless `--resume` is given; resume skips completed task/condition pairs and recomputes the summary from old plus new records. The runner writes `run.json` before the first task and refuses to resume if the area, model, turn budget, client, MoonBit or Node runtime, platform, or recorded model environment changed.

Results are written to `*/runs/<run-name>/` and gitignored. `run.json` fixes the resumable run configuration; `results.jsonl` contains checks, usage, full final text, skill activations, and tool calls; `summary.json` contains the turn budget, environment, requested/resolved models, rates, and cost; `transcripts/` preserves full stdout/stderr; and `failed-workspaces/` preserves failed project state without `.claude` or `_build`. Checked-in results live in `RESULTS.md` snapshots with date, client/model disclosure, corrections, and cost.

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

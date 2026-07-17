# Evals

Two separate questions get two separate eval families:

1. **Activation** (`activation/`) — can the agent, seeing only the skill
   catalog (names + descriptions), decide per natural request whether to load
   moonbit-language, moonbit-toolchain, both, or neither? No eval here ever
   names a skill in the prompt; the runner rejects prompts that do.
2. **Content** (`language/`, `toolchain/`, `integration/`) — once knowledge is
   available, does the agent finish MoonBit tasks correctly? Compared across
   conditions: no skills, the official moonbitlang/skills bundle, this
   repository's skills (catalog-only), and force-injected single skills (to
   separate content quality from activation quality).

Both runners need the Claude Code CLI (`claude`) with credentials, and the
content runner needs the MoonBit toolchain for grading. All grading is
deterministic — real `moon` commands and regex assertions, no LLM judges.

## Running

```sh
# validate prompt/task definitions without spending tokens
python3 evals/activation/run_activation.py --dry-run
python3 evals/run_content.py --area language --condition none --dry-run

# full activation eval
python3 evals/activation/run_activation.py --model claude-haiku-4-5-20251001

# content eval matrix (one area at a time)
python3 evals/run_content.py --area language   --condition none --condition official --condition ours --condition forced-language
python3 evals/run_content.py --area toolchain  --condition none --condition official --condition ours --condition forced-toolchain
python3 evals/run_content.py --area integration --condition none --condition official --condition ours
```

Results are written to `*/runs/<run-name>/` (gitignored). Checked-in results
live in `RESULTS.md` snapshots with model, date, and cost.

## activation/prompts.jsonl schema

One JSON object per line:

| Field | Meaning |
| --- | --- |
| `id` | unique prompt id |
| `category` | `language-only` / `toolchain-only` / `combined` / `negative` |
| `moonbit_named` | whether the prompt text says "MoonBit" (false = the agent must recognize MoonBit from file extensions, configs, or commands) |
| `prompt` | the natural user request, exactly as sent |
| `workspace` | optional map of relative path -> file content materialized in the project before the run |
| `expected.required` | skills that must activate |
| `expected.forbidden` | skills that must not activate |

Grading: `recall_ok` = all required activated; `no_forbidden` = nothing
forbidden activated; `exact` = activated set equals required set.

## Content task schema (`<area>/tasks/<id>/task.json`)

| Field | Meaning |
| --- | --- |
| `id` | task id (= directory name) |
| `prompt` | the natural user request |
| `grade` | list of deterministic checks, all must pass |

Check types: `moon` (run a moon command in the resulting workspace, expect
exit 0 unless `expect_ok: false`), `file_exists`, `file_absent`,
`file_contains` (regex), `any_file_contains` (glob + regex), `output_matches`
/ `output_not_matches` (regex over the agent's final message),
`first_line_is` (exact-answer tasks). The optional `workspace/` directory is
copied into the project before the run.

Ground truths embedded in tasks (e.g. "defer exists", "loop is deprecated")
were verified against the toolchain snapshot in
`verification/toolchains/current.json`; re-verify them when re-pinning.

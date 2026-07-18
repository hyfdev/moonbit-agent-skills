# Evals

Three separate questions get three separate eval families:

1. **Activation** (`activation/`) — two distinct modes: `routing` explicitly instructs the agent to make only a catalog classification and rejects domain actions; it measures prompted routing, not automatic activation. `end-to-end` sends the natural request and measures whether required skills loaded successfully before the first Bash/Edit/Write in an earlier assistant turn. No source prompt names a skill; the runner rejects prompts that do.
2. **Content** (`language/`, `toolchain/`, `integration/`) — once knowledge is available, does the agent finish MoonBit tasks correctly? Conditions compare no skills, the pinned official `moonbitlang/skills` bundle, a pinned historical `baseline`, this repository's catalog-only skills, and force-injected single skills. `forced-language-no-cross-language` is a targeted H4 ablation: it removes the concentrated cross-language rule, route, and reference while retaining the rest of the forced language skill.
3. **Error reporting** (`reporting/`) — when the installed guidance conflicts with observed behavior, does the agent verify the conflict, fix the task, display a complete privacy-scrubbed issue draft and template link, and stop without invoking GitHub? The same scenarios run with and without the skill.

All runners are TypeScript executed directly by Node.js 24. Activation and content support Kimi Code (`kimi`) and Claude Code (`claude`) through normalized JSONL adapters; reporting remains Claude-only because it requires a command allowlist equivalent to its outward-action safety boundary. Read [CLIENTS.md](CLIENTS.md) for the locally verified versions, model mappings, stream schemas, isolation, and subscription/API behavior. The content and reporting runners also need `moon` on `PATH`; content additionally needs `git`, and Node executes its JS-target tests. Before its first model call, the content runner verifies its executables, records the Node version, and checks every MoonBit component against `verification/toolchains/current.json`; the reporting runner likewise refuses to run without Node.js 24+, Claude Code, and the exact MoonBit pin. Grading is deterministic — real commands, file/state assertions, hidden behavior tests, and transcript assertions, never an LLM judge.

## Running

```sh
# Validate prompt/task definitions without spending tokens.
node evals/activation/run_activation.ts --dry-run
node evals/run_content.ts --area language --condition none --dry-run
node evals/reporting/run_reporting.ts --dry-run

# Prompted routing/classification eval on the default DeepSeek Pro path.
node evals/activation/run_activation.ts --client claude-code --model sonnet --mode routing --repetitions 1 --paid-budget-usd "$EVAL_BUDGET_USD" --run-name routing-deepseek-pro

# Primary user-value comparison with paired AB/BA ordering across tasks.
node evals/run_content.ts --area language --condition none --condition ours --client claude-code --model sonnet --repetitions 1 --max-turns 50 --paid-budget-usd "$EVAL_BUDGET_USD" --run-name language-deepseek-pro

# New experiment manifests use one or two repetitions. Historical K3 manifests and result summaries remain evidence, but the runners intentionally reject replaying them.

# Prove canonical solutions pass and plausible wrong solutions fail before any model calls.
node evals/validate_graders.ts

# Discoverability comparison; the runner alternates condition order across tasks.
node evals/run_content.ts --area language --ids lang-discover-selected-trait-method,lang-discover-default-trait-method --condition ours-no-top-level-extend --condition ours --client claude-code --model sonnet --repetitions 1 --max-turns 30 --paid-budget-usd "$EVAL_BUDGET_USD" --run-name language-reference-discovery

# Targeted H4 ablation.
node evals/run_content.ts --area language --ids lang-fix-rust-habits --condition forced-language-no-cross-language --client claude-code --model sonnet --paid-budget-usd "$EVAL_BUDGET_USD" --max-turns 50 --run-name h4-no-cross-language

# Error-reporting behavior comparison.
node evals/reporting/run_reporting.ts --model sonnet --paid-budget-usd "$EVAL_BUDGET_USD" --run-name reporting-manual-only

# Reapply the current deterministic scorer to a preserved reporting run without model calls.
node evals/reporting/run_reporting.ts --regrade-run reporting-manual-only
```

For activation and content, use a fresh `--run-name` for a new measurement. A pre-existing `results.jsonl` is rejected unless `--resume` is given; resume skips completed prompt/task, repetition, and condition cells and recomputes the summary. These runners write `run.json` before the first task and refuse to resume when conditions, repetitions, selected inputs, environment, provider, runner/parser files, or skill snapshots changed. Activation freezes the selected prompts and every installed skill before its first model call, materializes every cell from that snapshot, and scores only Skill calls with successful tool results. Content alternates AB/BA condition order and reports paired task outcomes; pairs with different or unobserved actual models are excluded. Claude API runs require an explicit total `--paid-budget-usd`; the runner keeps it only in memory and passes the remaining allowance to each child. A resume command starts a fresh in-memory guard from the supplied cap and applies it only to unfinished cells; a fully completed resume needs no cap because it makes no model call. Kimi subscription runs use the same token, duration, model, and error records without an API cap. API content runs require committed, clean `skills/`; current and historical skills are materialized once from Git trees into the run cache, and the manifest records commit IDs, tree IDs, every included path, and SHA-256. Purpose-built ablations are also materialized and hashed before the first model call, including their transformation description and every derived file. Reporting runs are smaller one-shot comparisons with the same runtime-only API guard: always use a fresh name; the runner rejects an existing directory and does not support resume. `--regrade-run` only reapplies the checked-in deterministic scorer to preserved artifacts and makes no model call.

For new content measurements, count distinct user cases rather than condition cells. A case may have at most two materially different user-facing angles, and each angle may run at most twice. Start with one `none` versus `ours` pair on Claude Code's `sonnet` alias and verify that the assistant execution model is `deepseek-v4-pro` on this machine. Repeat the DeepSeek pair only when `ours` fails or the pair is unstable. Use Kimi/K3 once on the same frozen pair only if `ours` fails again; keep that fallback result separate. Do not automatically cross-product angles, repetitions, and clients.

Results are written to `*/runs/<run-name>/` and gitignored. Activation and content use `run.json`, `results.jsonl`, `summary.json`, `transcripts/`, and, for content failures, `failed-workspaces/`. Reporting stores per-scenario answers, sanitized workspace snapshots, detected GitHub command attempts, transcripts, and deterministic grading under `iteration-1/`, plus top-level `run.json` and `summary.json`. Persisted artifacts retain normalized token counters, duration, requested and observed model/client identity, and errors. Monetary fields and runtime caps are removed from structured records, transcripts, and stderr. Checked-in `RESULTS.md` snapshots use the same token-only reporting policy.

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

Grading uses successful Skill tool results, not attempted calls. `recall_ok` means every required skill loaded successfully; `no_forbidden` means no forbidden skill loaded successfully; `exact` means the successful MoonBit skill set equals the required set. Each result retains attempted, succeeded, and failed skill sets separately.

## Content task schema (`<area>/tasks/<id>/task.json`)

| Field | Meaning |
| --- | --- |
| `id` | task id, equal to the directory name |
| `prompt` | the natural user request |
| `claim_id` | stable identifier for the behavior under test; required for experiment tasks |
| `risk_class` | why an incorrect answer can survive ordinary compiler/CLI feedback; required for experiment tasks |
| `primary_metric` | exact outcome the grader treats as primary; required for experiment tasks |
| `grader_note` | optional dated explanation of a grader correction |
| `discovery.skill` | optional skill whose successful activation is measured separately from functional PASS |
| `discovery.reference` | optional routed reference whose successful read, and read before a later action turn, are measured separately from functional PASS |
| `grade` | deterministic checks, all of which must pass |

Check types: `moon` runs a MoonBit command and expects exit 0 unless `expect_ok: false`; its optional `temp_files` map installs hidden grader files only for that command, `min_tests` rejects a successful no-op test run, and `output_regex` / `output_not_regex` check the actual diagnostic. File checks are `file_exists`, `file_absent`, `file_contains`, `file_not_contains`, `file_match_count`, `any_file_contains`, and project-wide `no_file_contains`; recursive content checks exclude injected `.claude` content and generated `_build` files. Answer checks are `output_matches`, `output_not_matches`, `first_line_is`, structural `first_line_json_is`, and token-wise `first_line_csv_is`. First-line checks ignore blank lines and harmless Markdown wrappers but still compare only the first answer line, so a wrong first line followed by a correct alternative cannot pass. The CSV check also ignores whitespace around separators without weakening item order or count. `command_matches` inspects Bash calls with successful tool results rather than trusting the final answer and can also require an `output_regex`; task regexes should anchor the entire command when extra arguments would change its scope. `initial_files_unchanged` verifies that no initial workspace file changed or disappeared and no file was added outside runner-managed `.claude` and generated `_build`. The runner appends a mandatory `client_exit` check, so a timeout or nonzero Claude exit cannot pass. The optional `workspace/` directory is copied into the isolated project before each run.

Functional PASS, successful skill activation, and successful routed-reference reads are separate measurements. A routed read counts only when its tool result succeeds. `reference_read_before_action` is stricter: the successful result must return before a Bash, Edit, or Write tool call in a later assistant turn, so parallel calls in one message cannot be misreported as evidence that the reference informed the edit. Summaries disclose both the requested model and model IDs emitted in the stream.

Ground truths embedded in tasks (for example, `defer` exists and functional `loop` is deprecated but still accepted) were verified against `verification/toolchains/current.json`; re-verify them when re-pinning.

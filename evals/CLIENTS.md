# Eval clients

This note records the locally verified command contracts used by the eval harness. Re-check it when either CLI version changes; do not infer behavior from the product name or authentication status.

Verified on 2026-07-18:

| Client | Version | Local backend | Access mode |
| --- | --- | --- | --- |
| Kimi Code CLI | `0.26.0` | provider `kimi`, requested alias `kimi-code/k3`, observed model `k3` | subscription |
| Claude Code | `2.1.212` | `https://api.deepseek.com`; `haiku` maps to `deepseek-v4-flash`, `sonnet` and `opus` map to `deepseek-v4-pro[1m]` | API |

The names above describe this machine, not portable defaults. Every checked result must retain the requested model, observed model, CLI version, and provider origin when available. Subscription versus API remains an operational runner choice, not a per-result field.

## Kimi Code

Use a fresh process and workspace for every cell:

```sh
kimi \
  -m kimi-code/k3 \
  --skills-dir /absolute/path/to/condition-skills \
  -p "$PROMPT" \
  --output-format stream-json
```

Set the working directory through the TypeScript child-process `cwd`; this version has no `--cwd` option. Do not combine prompt mode with `--auto` or `--yolo`: `-p` already uses auto permission mode, and either combination exits with status 1. Do not use `--continue`, `--session`, or the hidden resume alias.

`--skills-dir` replaces automatic user/project skill discovery. Point the no-skill condition at an empty controlled directory and each skill condition at its materialized snapshot. It does not suppress `AGENTS.md`, so use an isolated temporary workspace outside a parent tree with uncontrolled instructions, or keep the same controlled instructions in every condition.

Stdout is JSONL; stderr contains progress and raw command output and must stay separate. Relevant stdout records are:

```json
{"role":"assistant","tool_calls":[{"id":"...","function":{"name":"Skill","arguments":"{\"skill\":\"moonbit-language\"}"}}]}
{"role":"tool","tool_call_id":"...","content":"Skill \"moonbit-language\" loaded inline. Follow its instructions."}
{"role":"assistant","content":"final answer"}
{"role":"meta","type":"session.resume_hint","session_id":"session_..."}
```

Built-in tool names verified in this version include `Read`, `Write`, `Edit`, `Grep`, `Glob`, `Bash`, `Skill`, `Agent`, `AgentSwarm`, `WebSearch`, and `FetchURL`. The process may still exit 0 after an individual Bash failure, so deterministic grading must use the structured tool result and final workspace, not the process status alone.

The public JSONL stream does not disclose tokens or the actual backend model. Extract only the following whitelisted records from `~/.kimi-code/sessions/*/<session-id>/agents/main/wire.jsonl` after the process exits:

- `llm.request`: `model`, `modelAlias`, `provider`, `thinkingEffort`, and `turnStep`;
- `usage.record`: `model` and the numeric `inputOther`, `inputCacheRead`, `inputCacheCreation`, and `output` fields.

Never copy or commit the wire file: it can contain prompts, source, command output, and secrets. The harness reads only the whitelist above. Kimi has no native turn or API-budget flag, so use a process-group wall timeout, a predeclared maximum cell count, and observed assistant steps. Persist the four normalized token counters, duration, observed model/client identity, and errors.

Official references: [command](https://moonshotai.github.io/kimi-code/en/reference/kimi-command.html), [Agent Skills](https://moonshotai.github.io/kimi-code/en/customization/skills), and [data locations](https://moonshotai.github.io/kimi-code/en/configuration/data-locations.html).

## Claude Code with the local DeepSeek endpoint

Use a short model alias so the local mapping is explicit, and require a total API budget at the runner boundary. Supply the remaining in-memory allowance to each child:

```sh
claude -p "$PROMPT" \
  --model sonnet \
  --output-format stream-json \
  --verbose \
  --no-session-persistence \
  --permission-mode dontAsk \
  --strict-mcp-config \
  --setting-sources project \
  --tools 'Skill,Read,Grep,Glob,Bash,Edit,Write' \
  --allowedTools 'Skill,Read,Grep,Glob,Bash,Edit,Write' \
  --disallowedTools 'WebFetch,WebSearch,Task' \
  --max-turns 12 \
  --max-budget-usd "$REMAINING_API_BUDGET_USD"
```

For activation and content, set the workspace with the TypeScript child-process `cwd`, give every cell a fresh `CLAUDE_CONFIG_DIR`, and do not use `--continue` or `--resume`. Do not use `--safe-mode` or `--disable-slash-commands` because both disable skills. `--tools` determines which tools exist; `--allowedTools` only pre-approves permission and is not a substitute.

Parse these fields separately. Persist only the token, timing, model/client, tool, status, and error fields:

| Event | Fields |
| --- | --- |
| `system/init` | requested/init model, CLI version, tools, permission mode, session ID |
| `assistant` | `message.model`, usage, structured tool calls |
| `user` | matching tool results and error status |
| `result` | subtype, error status, turns, token usage, sanitized `modelUsage`, permission denials |

On this machine, the default `sonnet` alias maps to `deepseek-v4-pro[1m]`, while assistant events name the execution model `deepseek-v4-pro`. `modelUsage` may also include a small auxiliary `deepseek-v4-flash` entry; do not mistake that helper usage for the assistant execution model. Treat `assistant.message.model` as authoritative and retain all fields for audit. Before pairing cells, normalize and compare the complete observed execution signature: emitted model, model alias, provider, and thinking effort. The emitted-model set must be non-empty. An optional dimension that the client omits in both cells matches as two empty sets; one-sided missing data does not match.

Normal completion requires process exit 0, exactly one result event, `subtype=success`, `is_error=false`, no forbidden tool call, and deterministic task graders passing. Every content cell stores a structured analysis-eligibility result. Exclude wall timeouts and client or transport failures from outcome comparisons. A normal result at the predeclared turn limit exits 1 with `subtype=error_max_turns`; retain it as an eligible task failure and account for it in the current invocation's in-memory API guard.

The 2026-07-18 smoke command used no tools, requested `haiku`, resolved to `deepseek-v4-flash`, and returned `OK` in one turn. This is an environment check, not a model benchmark.

Claude result events expose a charge used only to decrement the current runner invocation's guard. That value and the supplied cap are not written to `run.json`, results, summaries, transcripts, or stderr. Persisted JSONL removes the top-level charge and nested per-model charge fields. A resumed activation or content command starts a new in-memory guard from the cap supplied to that command and applies it only to unfinished cells.

## Allocation policy

Use Claude Code with the `sonnet` alias as the default activation and content client; on this machine, verify that every assistant event emits `deepseek-v4-pro`. Start each content case with one paired `none` versus `ours` run. Repeat that DeepSeek pair once only when `ours` fails or the pair is unstable. If `ours` fails again, run the same frozen pair once with Kimi/K3 to distinguish a model-specific failure from a task, grader, or skill problem. Do not run Kimi routinely, do not use the `haiku` alias for new measurements on this setup, and never pool providers into one effect estimate.

The reporting eval remains Claude-only until a Kimi execution path can enforce an equivalent command/tool allowlist. Reporting tests an outward-action safety boundary, so transcript inspection after an unrestricted run is not an adequate substitute.

# Eval clients

This note records the locally verified command contracts used by the eval harness. Re-check it when either CLI version changes; do not infer behavior from the product name or authentication status.

Verified on 2026-07-18:

| Client | Version | Local backend | Billing used here |
| --- | --- | --- | --- |
| Kimi Code CLI | `0.26.0` | provider `kimi`, requested alias `kimi-code/k3`, observed model `k3` | subscription; the CLI exposes tokens but no USD cost |
| Claude Code | `2.1.212` | `https://api.deepseek.com`; `haiku` maps to `deepseek-v4-flash`, `sonnet` and `opus` map to `deepseek-v4-pro[1m]` | API; the result event exposes USD cost |

The names above describe this machine, not portable defaults. Every checked result must retain the requested model, observed model, CLI version, provider origin when available, and billing mode.

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

Never copy or commit the wire file: it can contain prompts, source, command output, and secrets. The harness reads only the whitelist above. Kimi has no native turn or USD-budget flag, so use a process-group wall timeout, a predeclared maximum cell count, and observed assistant steps. Report USD cost as unavailable, not zero.

Official references: [command](https://moonshotai.github.io/kimi-code/en/reference/kimi-command.html), [Agent Skills](https://moonshotai.github.io/kimi-code/en/customization/skills), and [data locations](https://moonshotai.github.io/kimi-code/en/configuration/data-locations.html).

## Claude Code with the local DeepSeek endpoint

Use a short model alias so the local mapping is explicit, and require a total paid budget at the runner boundary:

```sh
claude -p "$PROMPT" \
  --model haiku \
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
  --max-budget-usd 0.20
```

Set the workspace with the TypeScript child-process `cwd` and give every cell a fresh `CLAUDE_CONFIG_DIR`. Do not use `--continue` or `--resume`. Do not use `--safe-mode` or `--disable-slash-commands` in activation/content evals because both disable skills. `--tools` determines which tools exist; `--allowedTools` only pre-approves permission and is not a substitute.

Parse and preserve these fields separately:

| Event | Fields |
| --- | --- |
| `system/init` | requested/init model, CLI version, tools, permission mode, session ID |
| `assistant` | `message.model`, usage, structured tool calls |
| `user` | matching tool results and error status |
| `result` | subtype, error status, turns, usage, `total_cost_usd`, `modelUsage`, permission denials |

On this machine, `system/init.model` and `modelUsage` can retain a requested Claude name while every assistant event names `deepseek-v4-flash`. Treat `assistant.message.model` as the observed execution model, retain all fields for audit, and exclude a baseline/current pair when their observed model sets differ.

Normal completion requires process exit 0, exactly one result event, `subtype=success`, `is_error=false`, no forbidden tool call, and deterministic task graders passing. A turn-limit result exits 1 with `subtype=error_max_turns` but still contains billable usage, which must count against the total experiment budget.

The 2026-07-18 smoke command used no tools, requested `haiku`, resolved to `deepseek-v4-flash`, returned `OK` in one turn, and cost `$0.005615`. This is an environment check, not a model benchmark.

## Allocation policy

Use Kimi/K3 for task screening, repeated paired runs, and the main activation/content experiment. Use Claude Code with the `haiku` alias (DeepSeek Flash locally) as an independent execution-path check on a predeclared subset. Use `sonnet` (DeepSeek Pro locally) only for predeclared disagreements or high-variance tasks. Keep providers in separate tables; never pool Kimi and Claude/DeepSeek cells into one effect estimate.

The reporting eval remains Claude-only until a Kimi execution path can enforce an equivalent command/tool allowlist. Reporting tests an outward-action safety boundary, so transcript inspection after an unrestricted run is not an adequate substitute.

# moonbit-agent-skills

Agent Skills for MoonBit. Help coding agents work with MoonBit and write better MoonBit code.

- Up to date with the latest MoonBit release — **[v0.10.4](https://www.moonbitlang.com/updates/2026/07/13/moonbit-0-10-4-release)**
- Backed by [evaluation](#evaluation) across multiple AI models
- Automatic activation based on context

## Contents

- [Skills](#skills)
- [Install](#install)
- [How to use](#how-to-use)
- [Evaluation](#evaluation)
- [FAQ](#faq)
- [License](#license)

## Skills

| Skill | Role | Scope |
| --- | --- | --- |
| [moonbit-language](skills/moonbit-language/SKILL.md) | Language reference | Understanding, writing, and fixing MoonBit code: syntax, types, patterns, traits, errors, async, tests, and FFI. |
| [moonbit-toolchain](skills/moonbit-toolchain/SKILL.md) | Toolchain reference | Creating and operating MoonBit projects: `moon` commands, `moon.mod` / `moon.pkg`, dependencies, targets, testing, workspaces, publishing, and IDE queries. |

## Install

> [!WARNING]
> When a skill detects that its guidance conflicts with actual MoonBit behavior, it instructs the agent to prepare a privacy-scrubbed public issue draft and give you the issue-template link. The built-in workflow stops there: it uses no automatic reporting or telemetry service, and you decide whether to submit the draft.

- Global install for Claude Code and `.agents`:

  ```sh
  npx skills@latest add hyfdev/moonbit-agent-skills -g -a claude-code -a universal --copy -y
  ```

- Interactive install:

  ```sh
  npx skills@latest add hyfdev/moonbit-agent-skills
  ```

<details>
<summary>Manual installation</summary>

Clone or download this repository, then copy either or both skill directories into your agent's skill directory:

- `skills/moonbit-language`
- `skills/moonbit-toolchain`

</details>

## How to use

Use your coding agent as usual—no special prompts or manual invocation required.

## Evaluation

Performance of AI coding agents with the current skills compared to matched baselines.

MoonBit v0.10.4 introduced `extend` for explicitly exposing trait methods as dot-call APIs.

| Model | Evaluation | Baseline | With current skills |
| --- | --- | ---: | ---: |
| Kimi K3 | Read the relevant MoonBit reference before changing code | 25% | **92%** |
| Kimi K3 | Find the current syntax for public trait method dot calls | 33% | **83%** |
| Kimi K3 | Expose trait methods as public dot calls with `extend` | 100% | **100%** |
| DeepSeek Flash | Expose trait methods as public dot calls with `extend` | 100% | **100%** |

Results use objective graders and preserve failed runs. See the [full content results](evals/RESULTS.md) and [activation results](evals/activation/RESULTS.md).

## FAQ

### How do these skills complement the MoonBit compiler?

MoonBit's compiler already gives coding agents clear, useful feedback, allowing them to correct many mistakes on their own. These skills add current language and toolchain knowledge for the remaining gaps that compiler feedback alone cannot cover.

### Why can't I invoke or see these skills manually?

Manual invocation is deliberately disabled. This keeps the skills out of manual menus while allowing them to activate automatically from context. The setting is included with the skills, so no configuration is required after installation.

### How does this compare to the official MoonBit skills?

The official [MoonBit skills](https://github.com/moonbitlang/skills) focus on specialized workflows such as C bindings, OCaml migration, formal verification, and refactoring. This repository is a community-maintained, general-purpose reference for everyday MoonBit coding and project work. It also keeps fast-changing language guidance current—for example, the official guide still presents deprecated functional `loop` as current. We will explore contributing verified updates back to the official repository.

## License

[MIT](LICENSE)

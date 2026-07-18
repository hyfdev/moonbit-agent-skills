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

The primary evaluation tests MoonBit language behavior, not command recall. The latest run used four distinct tasks, with one Kimi K3 run per condition.

| MoonBit language task | No skills | Current language skill |
| --- | ---: | ---: |
| Preserve old constructor calls after changing a wrapper into an enum | 100% | 100% |
| Make an iterator prepare only the items that callers consume | 100% | 100% |
| Re-export a function, type, and trait without changing their identities | 100% | 100% |
| Return typed errors for invalid packets and continue decoding | 100% | 100% |

Latest language result: 100% with the current language skill, compared with 100% without skills. These harder behavior and API cases found no success-rate difference and now serve as regression tests.

An earlier five-task language evaluation measured 100% with the current skill, compared with 60% without skills. The skill supplied two facts that compiler feedback alone did not reveal: `defer` is available, and deprecated functional `loop` should be replaced with the current multi-binding `for` form. A separate four-task toolchain evaluation measured 100% with the current skill and 75% without skills.

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

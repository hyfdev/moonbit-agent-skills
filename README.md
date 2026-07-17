# moonbit-agent-skills

Agent Skills for MoonBit. Help coding agents work with MoonBit and write better MoonBit code.

- Up to date with the latest MoonBit release — **[v0.10.4](https://www.moonbitlang.com/updates/2026/07/13/moonbit-0-10-4-release)**
- Backed by evaluation across multiple AI models
- Automatic activation based on context

## Contents

- [Skills](#skills)
- [Install](#install)
- [How to use](#how-to-use)
- [FAQ](#faq)
- [License](#license)

## Skills

| Skill | Role | Scope |
| --- | --- | --- |
| [moonbit-language](skills/moonbit-language/SKILL.md) | Language reference | Understanding, writing, and fixing MoonBit code: syntax, types, patterns, traits, errors, async, tests, and FFI. |
| [moonbit-toolchain](skills/moonbit-toolchain/SKILL.md) | Toolchain reference | Creating and operating MoonBit projects: `moon` commands, `moon.mod` / `moon.pkg`, dependencies, targets, testing, workspaces, publishing, and IDE queries. |

## Install

> [!WARNING]
> When automatically activated, a skill may detect that its guidance conflicts with actual MoonBit behavior and propose filing an issue here. Nothing is submitted without your explicit approval; approved reports improve the skills for everyone.

- Global install for Claude Code and `.agents`:

  ```sh
  npx skills@latest add hyfdev/moonbit-agent-skills -g -a claude-code -a universal -s "*" --copy -y
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

## FAQ

### How do these skills complement the MoonBit compiler?

MoonBit's compiler already gives coding agents clear, useful feedback, allowing them to correct many mistakes on their own. These skills add current language and toolchain knowledge for the remaining gaps that compiler feedback alone cannot cover.

### Why can't I invoke or see these skills manually?

Manual invocation is deliberately disabled. This keeps the skills out of manual menus while allowing them to activate automatically from context. The setting is included with the skills, so no configuration is required after installation.

### How does this compare to the official MoonBit skills?

The official [MoonBit skills](https://github.com/moonbitlang/skills) focus on specialized workflows such as C bindings, OCaml migration, formal verification, and refactoring. This repository is a community-maintained, general-purpose reference for everyday MoonBit coding and project work. It also keeps fast-changing language guidance current—for example, the official guide still presents deprecated functional `loop` as current. We will explore contributing verified updates back to the official repository.

## License

[MIT](LICENSE)

# moonbit-agent-skills

Agent Skills for MoonBit. Help coding agents work with MoonBit and write better MoonBit code.

- Up to date with the latest MoonBit release — **[v0.10.4](https://www.moonbitlang.com/updates/2026/07/13/moonbit-0-10-4-release)**
- Backed by [evaluation](#evaluation) across multiple AI models
- Automatic activation based on context

## Contents

- [Skills](#skills)
- [Install](#install)
- [Update](#update)
- [How to use](#how-to-use)
- [Evaluation](#evaluation)
- [FAQ](#faq)
- [License](#license)

## Skills

### [moonbit-language](skills/moonbit-language/SKILL.md)

Version `0.3.1` · Last updated 2026-07-19 · Verified 2026-07-18 against MoonBit `0.10.4` · [History](https://github.com/hyfdev/moonbit-agent-skills/commits/main/skills/moonbit-language)

Language reference for understanding, writing, and fixing MoonBit code: syntax, types, patterns, traits, errors, async, tests, and FFI.

### [moonbit-toolchain](skills/moonbit-toolchain/SKILL.md)

Version `0.3.1` · Last updated 2026-07-19 · Verified 2026-07-18 against MoonBit `0.10.4` · [History](https://github.com/hyfdev/moonbit-agent-skills/commits/main/skills/moonbit-toolchain)

Toolchain reference for creating and operating MoonBit projects: `moon` commands, `moon.mod` / `moon.pkg`, dependencies, targets, testing, workspaces, publishing, and IDE queries.

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

## Update

Update both globally installed skills:

```sh
npx skills@latest update moonbit-language moonbit-toolchain -g
```

For project-level installations:

```sh
npx skills@latest update moonbit-language moonbit-toolchain -p
```

Installed `SKILL.md` files carry the same version, update date, and verification date shown above.

## How to use

Use your coding agent as usual—no special prompts or manual invocation required.

## Evaluation

### MoonBit language

#### Current syntax and migration

| What the agent had to do | Without skills | With skills |
| --- | ---: | ---: |
| Keep a generic clamp API type-safe | 100% | 100% |
| Recognize that `defer` is available | 0% | **100%** |
| Replace Rust-style syntax with MoonBit equivalents | 100% | 100% |
| Replace deprecated functional `loop` with the current multi-binding `for` form | 0% | **100%** |
| Convert an `Option`-returning parser to checked errors | 100% | 100% |
| **Overall** | **60%** | **100%** |

#### Language behavior and public APIs

| What the agent had to do | Without skills | With skills |
| --- | ---: | ---: |
| Preserve old constructor calls after changing a wrapper into an enum | 100% | 100% |
| Make an iterator prepare only the items that callers consume | 100% | 100% |
| Re-export a function, type, and trait without changing their identities | 100% | 100% |
| Return typed errors for invalid packets and continue decoding | 100% | 100% |
| **Overall** | **100%** | **100%** |

The different outcomes were `defer` availability and the current replacement for deprecated functional `loop`.

### MoonBit toolchain

| What the agent had to do | Without skills | With skills |
| --- | ---: | ---: |
| Test every configured backend with `--target all` | 100% | 100% |
| Generate a MoonBit ESM library that Node can import by named export | 0% | **100%** |
| Run both on-disk and virtual tests supplied by `--patch-file` | 100% | 100% |
| Select a virtual-package provider without changing the default consumer | 100% | 100% |
| **Overall** | **75%** | **100%** |

The ESM named-export task was the only different outcome: without skills it failed, and with skills it passed.

See the [full evaluation results](evals/RESULTS.md) for models, prompts, grading, and run details. Activation is measured [separately](evals/activation/RESULTS.md).

## FAQ

### How do these skills complement the MoonBit compiler?

MoonBit's compiler already gives coding agents clear, useful feedback, allowing them to correct many mistakes on their own. These skills add current language and toolchain knowledge for the remaining gaps that compiler feedback alone cannot cover.

### Why can't I invoke or see these skills manually?

Manual invocation is deliberately disabled. This keeps the skills out of manual menus while allowing them to activate automatically from context. The setting is included with the skills, so no configuration is required after installation.

### How does this compare to the official MoonBit skills?

The official [MoonBit skills](https://github.com/moonbitlang/skills) focus on specialized workflows such as C bindings, OCaml migration, formal verification, and refactoring. This repository is a community-maintained, general-purpose reference for everyday MoonBit coding and project work. It also keeps fast-changing language guidance current—for example, the official guide still presents deprecated functional `loop` as current. We will explore contributing verified updates back to the official repository.

## License

[MIT](LICENSE)

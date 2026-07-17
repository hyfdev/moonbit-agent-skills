# moonbit-agent-skills

Two independently installable [Agent Skills](https://agentskills.io) that give AI coding agents **version-pinned, machine-verified** knowledge of MoonBit:

- **`moonbit-language`** — the MoonBit language: syntax, types, pattern matching, traits, visibility, checked errors, async, tests, FFI declarations.
- **`moonbit-toolchain`** — operating MoonBit projects: `moon.mod` / `moon.pkg`, moon commands, testing workflows, dependencies, targets, workspaces, publishing, `moon ide`.

MoonBit is young and evolves fast, so model pretraining about it is thin, stale, or silently wrong. These skills exist to raise the reliability floor: current syntax instead of remembered syntax, real command behavior instead of plausible flags, and an explicit "verify against your local toolchain" contract instead of confident guessing.

<!-- BEGIN GENERATED: status -->
- Verified toolchain: `moon 0.1.20260713` · `moonc v0.10.4+ade96c819` · `moonrun 0.1.20260713`
- Verification date: 2026-07-17 on Darwin arm64
- Verified targets: js, native, wasm, wasm-gc
<!-- END GENERATED: status -->

## Install

Copy the two skill directories into your agent's skill path, e.g. for Claude Code:

```sh
git clone https://github.com/hyfdev/moonbit-agent-skills
mkdir -p ~/.claude/skills
cp -R moonbit-agent-skills/skills/moonbit-language ~/.claude/skills/
cp -R moonbit-agent-skills/skills/moonbit-toolchain ~/.claude/skills/
```

Other clients: use their skill directory (`~/.agents/skills/`, `~/.codex/skills/`, project-level `.claude/skills/`, ...). The skills follow the open Agent Skills spec plus exactly one documented client extension: `user-invocable: false`, which tells Claude Code to keep them out of the manual `/` menu so they are reachable only through automatic activation (verified to not affect auto-triggering). Clients that don't know the field ignore it.

## Use

After installing, just ask normally. You never need to know or type a skill name — the skills describe their own triggers and the agent activates them (individually or together) from your request:

- "Fix the type errors in this MoonBit package."
- "Why does this MoonBit match expression fail to compile?"
- "How do error types and raise work?"
- "Add a package to this project and run only its tests."
- "Configure this project to build for JS and native."
- "Is this moon.pkg configuration correct?"

If your client only supports manually invoked skills, that is a client capability limit — the skills still work when invoked manually, but automatic activation is the designed and tested path.

## Why not just the official MoonBit guides?

The official [moonbitlang/skills](https://github.com/moonbitlang/skills) bundle (which includes the [moonbit-agent-guide](https://github.com/moonbitlang/moonbit-agent-guide)) is good, and this repository deliberately does not duplicate its specialized skills (C bindings, OCaml migration, proofs, refactoring). Audited at commit `5caf81c` (2026-07-06), the gaps this repository fills are:

1. **A version contract.** The official skills float on nightly/latest with no statement of what they were verified against. Here, every claim is pinned to exact `moon`/`moonc` versions, with a committed snapshot, per-fixture stamps, and machine-checked consistency — plus explicit instructions to the agent for when local versions differ.
2. **Language / toolchain separation.** One 58 KB monolithic guide becomes two small, independently versioned, independently activatable skills with an explicit ownership boundary and a duplication check.
3. **Verified negative knowledge.** The official guides teach correct MoonBit; agents also need to know what is *wrong now* — Rust/TS/Go habits and stale MoonBit that the compiler rejects (or worse, silently accepts with different meaning). This repo ships fixtures proving each rejection/trap, including deprecated syntax the official language-fundamentals reference still teaches (e.g. `loop`, fn-less trait signatures).
4. **Activation evals.** Frontmatter descriptions are treated as a tested interface: prompt sets measure trigger recall, false positives on confusables (moonrepo, moon phases, generic wasm questions), language/toolchain routing, and multi-skill activation — without ever naming skills in prompts.
5. **Everything executable is executed in CI** — reference examples (all `mbt check` blocks, all pinned targets), fixtures, and every documented `moon` command line (coverage-checked manifest), with a drift-watch lane on the nightly toolchain channel (runs on push/PR and a weekly schedule). Two documents (async/FFI notes and part of the cross-language list) are hand-verified at the pin rather than re-executed by CI; they say so inline.

## Repository map

<!-- BEGIN GENERATED: inventory -->
- `moonbit-language` v0.1.0: SKILL.md (44 lines) + 12 reference file(s)
- `moonbit-toolchain` v0.1.0: SKILL.md (41 lines) + 8 reference file(s)
- Verification fixtures: 35
- Activation eval prompts: 35 (combined 5, language-only 10, negative 10, toolchain-only 10)
<!-- END GENERATED: inventory -->

- `skills/` — the two installable skills.
- `verification/` — toolchain snapshot, pinned upstream sources, fixtures (positive, negative, semantic-trap), command manifest + template project.
- `evals/` — activation and content evals with deterministic graders; see `evals/README.md` and checked-in `RESULTS.md` snapshots.
- `tooling/` — validators, verification runners, README generator, and their tests (mirrored in `.github/workflows/ci.yml`).
- `research/` — research note: making LLM agents reliable in a language with low pretraining coverage.

## License

MIT — see LICENSE.

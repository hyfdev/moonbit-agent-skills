---
name: moonbit-language
description: Verified knowledge of the MoonBit programming language, pinned to an exact moonc version - syntax, structs, enums, pattern matching, traits, generics, visibility, checked errors and raise, async, tests, FFI declarations. Use when reading, writing, explaining, reviewing, or fixing MoonBit code in .mbt or .mbt.md files, fixing MoonBit type, pattern, visibility, or error-handling diagnostics, designing MoonBit APIs, judging whether a MoonBit language feature currently exists, or translating Rust, TypeScript, or Go habits into MoonBit. Language semantics only - for moon commands, moon.mod or moon.pkg configuration, dependencies, targets, or project setup use moonbit-toolchain; load both for tasks that touch code and project configuration together.
license: MIT
user-invocable: false
compatibility: Verified only against moonc v0.10.4+ade96c819 (MoonBit v0.10.4, 2026-07-13). Needs the moon CLI for verification steps.
metadata:
  skill-version: "0.2.0"
  moonc-version: "0.10.4+ade96c819"
  moonbit-release: "0.10.4"
  verified-date: "2026-07-18"
  verified-platform: "Linux-x86_64"
  verified-targets: "wasm-gc,wasm,js,native"
  source-docs: "https://docs.moonbitlang.com/en/latest/ (MoonBit v0.10.4 documentation)"
---

# MoonBit language

## Verification contract

Everything in this skill was verified by compiling and running real code against **moonc v0.10.4+ade96c819** (MoonBit release 0.10.4, build 2026-07-13) on Linux x86_64, targets wasm-gc, wasm, js, native, on **2026-07-18**. MoonBit is pre-1.0 and changes fast; there is no language version separate from the compiler — language behavior is keyed to the moonc version.

**Before relying on this skill, run `moon version --all`.** If the local moonc differs from the pin above:

1. Treat every claim here as a hypothesis, not a fact.
2. For any load-bearing construct, run a minimal experiment first: put the snippet in a scratch file and run `moon check /tmp/probe.mbt` or a `test { }` block via `moon test /tmp/probe.mbt.md` (both work standalone, no project needed) — or pipe it through scripts/verify_snippet.sh, which does exactly that.
3. Check the release notes at https://www.moonbitlang.com/updates/ for changes between 0.10.4 and the local version.
4. Say explicitly in your answer which version you verified against and where versions differed.

## Non-negotiable working rules

- **The compiler is the oracle.** Never assert that MoonBit syntax exists, or that code is correct, from memory alone — MoonBit changed too fast for pretraining to be trusted. If you cannot run `moon check`, say so and mark the answer unverified.
- **Write current syntax, not remembered syntax.** The highest-risk drift areas, all verified 2026-07-18: entry point is `fn main { }` (no parens); `fn init { }` (bare `init { }` is gone); type parameters are prefix (`fn[T] id`, not `fn id[T]`); trait/impl bodies never use `impl Type { }` blocks; error handling is `suberror` + `-> T raise E` + `try/catch/noraise` (the `!Error`, `f!()`, `try?` forms are deprecated); `loop` is deprecated; `derive(Show)` for debugging is deprecated in favor of `Debug`.
- **Distinguish status.** Label knowledge as: verified (ran here), documented (official docs, not run), proposal (moonbit-evolution — NEVER present as shipped; that repo's own status fields lag), or unknown. The docs themselves lag in places (e.g. trait pages still show pre-0.10.0 fn-less signatures).
- **Cross-language habits are the main failure mode.** When input code looks like Rust, TypeScript, or Go, check references/cross-language-and-stale-syntax.md before "fixing" it into another language's idiom. Watch the silent traps: `"${x}"` is literal text (interpolation is `\{x}`), `defer` is block-scoped, and unnecessary `let mut` is a hard error.

- **If the toolchain contradicts this skill, that is a bug in the skill.** Reproduce it with a fresh minimal snippet, draft a privacy-scrubbed report (never the user's code, paths, or names), show the user the full text, and file it to https://github.com/hyfdev/moonbit-agent-skills/issues ONLY after their explicit confirmation — if you cannot get that confirmation, save the draft locally and do not file. Exact protocol: references/reporting-errors.md

## Reference routing

Load only what the task needs:

- Program structure, functions, methods, lambdas, pipelines, cascades → references/declarations-and-functions.mbt.md
- Structs, enums, newtypes, aliases, derives → references/types-structs-enums.mbt.md
- match, patterns (array/string/map/range), `is`, `guard` → references/pattern-matching.mbt.md
- Traits, generics, impls, operators, trait objects → references/traits-and-generics.mbt.md
- pub / pub(all) / pub(open) / priv, cross-package access → references/visibility.mbt.md
- Error types, raise, try/catch, Option/Result → references/errors-and-error-handling.mbt.md
- Numbers, strings, bytes, arrays, maps, views → references/data-types.mbt.md
- Loops, iteration, closures, guard flow, Iter → references/control-flow-and-iteration.mbt.md
- test blocks, inspect snapshots, doc tests, .mbt.md → references/tests-and-checked-docs.mbt.md
- async semantics, extern FFI declarations → references/async-and-ffi.md
- Attributes (#cfg, #deprecated, #alias, ...) → references/attributes.mbt.md
- Rust/TS/Go habits and stale MoonBit forms → references/cross-language-and-stale-syntax.md

Files ending in `.mbt.md` are executable documentation: every `mbt check` block in them is compiled and run by this repository's CI against the pinned toolchain, so their examples are guaranteed-current at the pin. Blocks marked `mbt nocheck` show rejected or deprecated forms.
- Toolchain contradicts this skill → report upstream (with consent): references/reporting-errors.md

## Boundary

This skill owns language semantics (what code means, which programs compile). It does not cover moon commands, moon.mod/moon.pkg configuration, dependency management, targets, linking, or publishing — that is the moonbit-toolchain skill. For a task that spans both (new package with code, FFI plus build wiring, fixing a repo where both code and config are broken), load both skills. Using `moon check`/`moon test` to verify language claims as described above does not require the toolchain skill.

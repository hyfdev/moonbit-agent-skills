---
name: moonbit-language
description: Verified MoonBit language reference pinned to an exact moonc version. Use when understanding, writing, reviewing, or fixing .mbt and .mbt.md code; resolving syntax, type, pattern, visibility, trait, or error diagnostics; designing APIs; checking whether a feature exists; or translating Rust, TypeScript, or Go habits. Covers functions and labelled/optional/autofill arguments, structs, enums and extenum, bitstring/JSON/regex patterns, traits and explicit extend/pub extend, generics, visibility, checked errors, async, tests, and FFI declarations. Language semantics only - use moonbit-toolchain for commands, configuration, dependencies, targets, or project setup; load both when code and project operation are involved.
license: MIT
user-invocable: false
compatibility: Verified only against moonc v0.10.4+2cc641edf (MoonBit v0.10.4, 2026-07-15). Needs the moon CLI for verification steps and Node.js 24+ for the bundled helper script.
metadata:
  skill-version: "0.3.2"
  updated-date: "2026-07-19"
  moonc-version: "0.10.4+2cc641edf"
  moonbit-release: "0.10.4"
  verified-date: "2026-07-18"
  verified-platform: "Linux-x86_64"
  verified-targets: "wasm-gc,wasm,js,native"
  source-docs: "https://docs.moonbitlang.com/en/latest/ (MoonBit v0.10.4 documentation)"
---

# MoonBit language

## Verification contract

Executable claims in this skill are checked against **moonc v0.10.4+2cc641edf** (MoonBit release 0.10.4, build 2026-07-15) on Linux x86_64. The repository runs every `mbt check` fence on wasm-gc, wasm, js, and native and runs diagnostic fixtures against the same pin. Facts that depend on an external runtime or were not executed are explicitly labeled **Documented, not executed** with an official source. Blocks marked `mbt nocheck` are explanatory rejected or deprecated forms; they are not executed.

MoonBit is pre-1.0 and changes quickly. Before relying on a load-bearing claim, run `moon version --all`. If local moonc differs from the pin:

1. Treat the claim as a hypothesis.
2. Reproduce the smallest relevant example with `moon check`, `moon test`, or `node scripts/verify_snippet.ts`.
3. Check the official release notes between 0.10.4 and the local version.
4. State which version was actually tested and any remaining difference.

## Work by task

- **Understand code:** identify unfamiliar syntax and the local compiler version; search this file for the exact token or diagnostic; load the routed reference; explain behavior only after matching the code to a checked example or an explicitly documented fact.
- **Write code:** load the smallest relevant reference, use its current forms, then run `moon check` and the narrowest useful `moon test`. Do not invent syntax from another language or an old MoonBit tutorial.
- **Fix code:** preserve the program's intent, reproduce the diagnostic, search both the diagnostic text and suspicious token in the references, apply the current migration, and rerun with warnings denied when deprecation is involved. Do not silence a warning before proving the replacement.
- **Judge a feature:** distinguish **verified**, **documented**, **proposal**, and **unknown**. Official docs can lag or suppress warnings; the compiler at the stated pin decides executable behavior.

If a token, warning, or construct is not named below, search all `references/` for the exact spelling and the compiler's diagnostic before concluding that the skill does not cover it.

## Feature index

Each row is both a capability map and a search route. Load only the rows relevant to the task.

| Need or search terms | Reference |
| --- | --- |
| Program structure; `fn main`; `fn init`; naming conventions; Keywords and Reserved Keywords; `//` comments; `///` Doc Comments and doc tests; labelled arguments; optional arguments and forwarding; autofill / `#callsite`; `declare fn`; function aliases / `#alias`; deprecated `fnalias`; `letrec`; lambdas; partial application; pipelines `\|>` and `<\|`; methods; cascades; TODO placeholder `...` | references/declarations-and-functions.mbt.md |
| Structs; struct update; enums; mutable enum fields; `extenum`; custom constructors; tuple structs; aliases; opaque types; derives; `Eq` / `Compare` / `Default`; JSON Enum styles; Deriving `Option`; Container, Case, and Field arguments; local type definitions are deprecated | references/types-structs-enums.mbt.md |
| `match`; guards; array, string, map, bitstring, and `Json` patterns; regex literal and `=~`; or-pattern defaults with `with`; `lexscan`; deprecated `lexmatch` | references/pattern-matching.mbt.md |
| Traits; generics; impls; explicit `extend` and `pub extend`; `implicit_impl_as_method`; supertrait dot-call migration; Builtin traits; Deriving builtin traits; operators; trait objects | references/traits-and-generics.mbt.md |
| `pub`; `pub(all)`; `pub(open)`; `priv`; alias visibility; `pub impl`; source-level `using`; cross-package access and re-export | references/visibility.mbt.md |
| Error types; `raise`; `try` / `catch` / `noraise`; `Option`; `Result`; deprecated `!Error`, bang calls, and `try?` | references/errors-and-error-handling.mbt.md |
| `Unit`; `Bool`; Boolean negation; `!value`; deprecated `not(value)`; `Ref`; `Option`; `Result`; `Json`; Numbers and overloaded literals; strings, bytes, escapes, interpolation, and Choosing a Byte Container; arrays, maps, views; conditional spread; ambiguous `{}`; immutable `Type(array)` / deprecated `from_array`; negative view indices; removed collection aliases and `IterResult`; `Json::empty_object`, String predicates, `Int16` / `UInt16` `lnot` | references/data-types.mbt.md |
| `if`; `while`; `for`; list comprehensions; `Iter` and `[\| ... \|]`; deprecated implicit array-to-Iter and `loop`; labels; closures; `defer` | references/control-flow-and-iteration.mbt.md |
| `test`; snapshots; `inspect`; blackbox and whitebox tests; doc tests; `.mbt.md` | references/tests-and-checked-docs.mbt.md |
| `async`; task groups; cancellation and cleanup; JavaScript Promise bridge; native/JS/Wasm1 runtime boundaries; `extern "js"`, `extern "wasm"`, `extern "C"`; stable FFI Types; constant enum ABI values; exported functions; FFI ownership and callbacks | references/async-and-ffi.md |
| Attributes including `#cfg`, `#deprecated`, `#alias`, `#as_free_fn`, `#callsite`, `#doc(hidden)`, `#internal`, `#label_migration`, `#module`, `#must_implement_one`, `#visibility`, `#warnings`; deprecated `@` warning switch and `--deny-warn`; derives | references/attributes.mbt.md |
| Rust, TypeScript, Go, and stale MoonBit forms; silent interpolation, `defer`, integer division, and indexing traps | references/cross-language-and-stale-syntax.md |
| Skill guidance contradicts the compiler; minimal reproduction and privacy-scrubbed issue draft | references/reporting-errors.md |

## Current syntax and migrations

- Entry points are `fn main { }` and `fn init { }`; type parameters precede names (`fn[T] id`); top-level function parameters and results need annotations.
- Trait implementations do not automatically create dot-call methods. Attach intended methods with `extend Type with Trait::{method}`; use `pub extend` when downstream packages need the dot call. Rename identifiers called `extend`, and use qualified `Trait::method(value)` for deprecated supertrait or ambiguous constrained dot calls.
- Current checked-error syntax is `suberror`, `-> T raise E`, and `try` / `catch` / `noraise`. The `!Error`, `f!()`, and `try?` forms are deprecated.
- `loop` and expected-type conversion from an array literal to `Iter` are deprecated. Use `while true` / `for` and explicit `[| ... |]` respectively.
- Local type definitions still parse but emit `deprecated_syntax`; move the type to top level. Do not copy the official local-type example without checking warnings.
- `derive(Show)` for debugging is deprecated; use `Debug`. Unnecessary `let mut` is an error. String interpolation is `\{value}`, not `${value}`.

## Reporting contradictions

If the pinned compiler contradicts this skill, reproduce it with a fresh minimal example and follow references/reporting-errors.md before the final response. Prepare a privacy-scrubbed issue title and body and show the exact draft plus issue-template link. The skill workflow never submits the issue, invokes GitHub, edits the installed skill, or writes the draft into the user's repository.

## Boundary

This skill owns language semantics: what MoonBit code means and which programs compile. It does not own `moon` commands, `moon.mod` / `moon.pkg`, dependencies, targets, linking, publishing, or project setup; use moonbit-toolchain for those. Load both skills when a task changes code and project operation together. Running `moon check` or `moon test` solely to verify a language claim does not require the toolchain skill.

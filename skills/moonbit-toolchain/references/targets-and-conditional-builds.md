# Targets and conditional builds

All verified at the pin on Linux x86_64 (native backend uses the system C compiler).

## Target selection

```sh
moon build --target js
moon build --target all
moon check --target all
moon run --target native cmd/main
```

- `--target` values: `wasm`, `wasm-gc` (default), `js`, `native`, `llvm`, `all`. It exists on check/build/run/test/bench.
- `all` = wasm + wasm-gc + js + native. It does **not** include llvm.
- **`llvm` depends on the install channel** (both outcomes verified 2026-07-17): on the stable/latest channel it prints `Warning: LLVM backend is experimental and only supported on nightly moonbit toolchain for now`, then dies with an internal-compiler-error banner (exit 255 — a required prelude file ships only on nightly); on the nightly channel the same command builds successfully, keeping the experimental warning.
- Per-target artifact paths and names: see the table in references/commands.md (`_build/<target>/<debug|release>/build/...`; native executables are `*.exe` even on macOS; js builds also emit `.d.ts` files).

## Native backend selection in 0.10.4

**Documented, not executed across the full platform matrix:** the [0.10.4 release notes](https://www.moonbitlang.com/updates/2026/07/13/moonbit-0-10-4-release) say the new native backend supports macOS Apple Silicon and x86-64 Linux, with Windows MSVC support on nightly. Debug builds on macOS Apple Silicon use it by default; set `MOONBIT_NEW_NATIVE=0` to force the C backend. Other platforms default to the C backend and opt into the new debug backend with `MOONBIT_NEW_NATIVE=1`. Release builds still use the C backend with `-O2`. Do not assume a successful `--target native` build identifies which backend was selected.

## Default target: preferred_target

`preferred_target = "js"` in moon.mod (or `options("preferred-target": "js")` — both spellings parse, see references/project-layout-and-config.md) changes what a bare `moon build`/`moon run`/`moon test` targets. Verified: with `js`, artifacts appear only under `_build/js/`. **Documented, not executed for a workspace-level key:** the [0.10.4 release notes](https://www.moonbitlang.com/updates/2026/07/13/moonbit-0-10-4-release) deprecate workspace-level `preferred-target`; put the setting in each module. `moon run` now respects the selected module's own value.

## Restricting targets: supported_targets

Two different shapes at the two levels (verified):

- **Module level** (moon.mod): an array — `supported_targets = [ "js", "wasm-gc" ]`. Building an unsupported target is **silently skipped**: `moon build --target native` prints `Finished. moon: no work to do` and exits 0. Nothing fails — watch for this in CI matrices.
- **Package level** (moon.pkg): a top-level key, preferably with a string *expression* — `supported_targets = "js"`, `"js+wasm-gc"`, or `"all-native"` (`+` adds, `-` subtracts from `all`). An array (`supported_targets = [ "js" ]`) also parses and enforces identically — it is what JSON migration emits. Effects differ by how the package is reached (all verified):
  - Whole-module `moon check`/`moon build` on an unsupported backend **silently skips** the package (exit 0, fewer tasks) — same trap as the module level.
  - Naming the package directly (`moon check textutil`) errors: `Package '...' does not support target backend 'wasm-gc'. Supported backends: [js]` (exit 255).
  - Importing it from a package that is built for an unsupported backend errors with `Selected backend 'wasm-gc' is incompatible with the dependency graph. '...' requires '...' which supports [js]` plus the dependency path — the restriction propagates to importers.
- The older package-level `options("supported-targets": [ ... ])` spelling still parses but emits two deprecation warnings (exact wording not transcribed here; run it to see them). Note `moon fmt` canonicalizes it to `options(supported_targets: [...])` rather than the expression form.

## Per-file conditional compilation

`options(targets: { "file.mbt": [ <cond> ] })` in moon.pkg maps individual files to build conditions. Conditions are backend names (`"wasm"`, `"wasm-gc"`, `"js"`, `"native"`), build modes (`"debug"`, `"release"`), and prefix operators in nested arrays: `["not", "js"]`, `["and", ...]`, `["or", ...]` — e.g. `["or", ["and", "wasm", "release"], ["and", "js", "debug"]]`.

```
pkgtype(kind: "executable")

options(
  targets: {
    "only_js.mbt": [ "js" ],
    "not_js.mbt": [ "not", "js" ],
  },
)
```

Verified end-to-end: two files each defining the same function (and even the same `fn main`) coexist because only one is ever in a given build; `moon run --target js` picks the js file, every other backend gets the other, and `moon check --target all` passes across all four backends.

```sh
moon run --target js cmd/show
moon run cmd/show
```

## Link options per backend

`options(link: { "<backend>": { ... } })` in moon.pkg. Giving a *library* package link options makes `moon build` produce a linked artifact for it. Verified fields:

```
options(
  link: {
    "js": { "exports": [ "add" ], "format": "esm" },
    "wasm": { "exports": [ "add" ], "heap-start-address": 65536 },
    "native": { "cc-flags": "-O2" },
  },
)
```

- js: `exports` + `format: "esm"` verified — the built `.js` ends with an ES-module `export { <mangled> as add }` line.
- wasm: `exports` + `heap-start-address` accepted and a linked `.wasm` is produced.
- native: `cc-flags` accepted (also `cc`, `cc-link-flags` per docs — those two documented, not executed here: https://docs.moonbitlang.com/en/latest/toolchain/).

## Native stubs (C files)

`options("native-stub": [ "stub.c" ])` in moon.pkg compiles and links the listed C files into the package on the native backend — verified end-to-end with a C function called through an `extern "C"` declaration (declaration syntax belongs to the moonbit-language skill) and `moon test --target native`:

```sh
moon test --target native
```

Remember `extern "C"` code makes the package js-incompatible (E4156 on a js build) — pair native stubs with `supported_targets` or per-file `targets:` conditions.

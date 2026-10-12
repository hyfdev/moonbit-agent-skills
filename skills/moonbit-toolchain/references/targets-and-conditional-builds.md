# Targets and conditional builds

All executable claims are verified at the pin on Linux x86_64. A debug native build uses MoonBit's new native code generator and the system linker; a release native build still generates C and invokes the system C compiler.

## Official toolchain topic map

Official headings routed here: Preferred Target; Supported Targets; Conditional Compilation; Native Stub Files; Link Options; Wasm Backend Link Options; Common Options; Wasm Linear Backend Link Options; Wasm GC Backend Link Options; JS Backend Link Options; Native Backend Link Options; Default C compiler and compiler flags for the native backend; WebAssembly Integration; Custom Export and Import.

## Target selection

```sh
moon build --target js
moon build --target all
moon check --target all
moon run --target native cmd/main
```

- `--target` values: `wasm` (default), `wasm-gc`, `js`, `native`, `llvm`, `all`. It exists on check/build/run/test/bench.
- `all` = wasm + wasm-gc + js + native. It does **not** include llvm.
- **`llvm` depends on the install channel** (both outcomes verified 2026-07-17): on the stable/latest channel it prints `Warning: LLVM backend is experimental and only supported on nightly moonbit toolchain for now`, then dies with an internal-compiler-error banner (exit 255 — a required prelude file ships only on nightly); on the nightly channel the same command builds successfully, keeping the experimental warning.
- Per-target artifact paths and names: see the table in references/commands.md (`_build/<target>/<debug|release>/build/...`; native executables are `*.exe` even on macOS; js builds also emit `.d.ts` files).

## Native backend selection

On the verified Linux x86_64 host, a debug build uses the new native backend by default: `moon build --target native --dry-run` links a native object emitted by `moonc`. `MOONBIT_NEW_NATIVE=0` switches that debug build back to generated C. Release builds still use the C backend with `-O2`.

**Documented, not executed across the full platform matrix:** the [current toolchain source](https://github.com/moonbitlang/moon/commit/92ee596a647448c825c385c9513663221c45bb4e) enables the new debug backend by default on macOS Apple Silicon and Linux x86_64. Other supported platforms may keep the C default or differ by install channel; inspect `--dry-run` output before diagnosing backend-specific behavior. `MOONBIT_NEW_NATIVE=1` opts into the new debug backend where available, and `MOONBIT_NEW_NATIVE=0` forces C. Do not assume a successful `--target native` build identifies which backend was selected.

**Documented, not executed on Windows:** native builds require an MSVC-compatible toolchain with C++ tools and the Windows SDK; Microsoft `cl.exe` and LLVM `clang-cl.exe` are supported, while MinGW is not. On other platforms the documented C-compiler search order is `gcc`, `clang`, then `cc`; do not rely on an internal TCC fallback. Source: [pinned native compiler reference](https://github.com/moonbitlang/moonbit-docs/blob/8d9f3ba206eb17f80ee1836e4c1139068d1351b5/next/toolchain/moon/package.md#default-c-compiler-and-compiler-flags-for-the-native-backend). Cross-platform compiler selection was not executed on this Linux host.

## Default target: preferred_target

`preferred_target = "js"` in moon.mod (or `options("preferred-target": "js")` — both spellings parse, see references/project-layout-and-config.md) changes what a bare `moon build`/`moon run`/`moon test` targets. Verified: with `js`, artifacts appear only under `_build/js/`. **Documented, not executed for a workspace-level key:** the [0.10.4 release notes](https://www.moonbitlang.com/updates/2026/07/13/moonbit-0-10-4-release) deprecate workspace-level `preferred-target`; put the setting in each module. `moon run` now respects the selected module's own value.

## Restricting targets: supported_targets

Both `moon.mod` and `moon.pkg` use the same canonical compact target-set string: `supported_targets = "js"`, `"+js+wasm-gc"`, or `"+all-native"` (`+` adds, `-` subtracts from `all`). The older array form remains accepted for compatibility but is legacy syntax; JSON migration may still emit it. When both a module and one of its packages declare supported targets, the effective set is their intersection.

- **Module level** (moon.mod): `supported_targets = "+js+wasm-gc"`. Building an unsupported target is **silently skipped**: `moon build --target native` prints `Finished. moon: no work to do` and exits 0. Nothing fails — watch for this in CI matrices.
- **Package level** (moon.pkg): the same top-level compact string. Effects differ by how the package is reached (all verified):
  - Whole-module `moon check`/`moon build` on an unsupported backend **silently skips** the package (exit 0, fewer tasks) — same trap as the module level.
  - Naming the package directly (`moon check textutil`) errors: `Package '...' does not support target backend 'wasm-gc'. Supported backends: [js]` (exit 255).
  - Importing it from a package that is built for an unsupported backend errors with `Selected backend 'wasm-gc' is incompatible with the dependency graph. '...' requires '...' which supports [js]` plus the dependency path — the restriction propagates to importers.
- The older package-level `options("supported-targets": [ ... ])` spelling still parses but emits two deprecation warnings (exact wording not transcribed here; run it to see them). `moon fmt` may canonicalize it only as far as `options(supported_targets: [...])`; prefer the current top-level compact string in newly written configuration.

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

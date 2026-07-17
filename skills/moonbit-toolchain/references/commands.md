# Everyday commands

All commands below were executed against the pinned toolchain. Examples assume a module shaped like the repository's verification template (root package `mbtskills/template` with `lib.mbt`, a `textutil` subpackage, and a `cmd/main` executable).

## Exit codes (inconsistent — memorize this table)

| Situation | Exit code |
| --- | --- |
| Success | 0 |
| `moon check` / `moon build` compile or build-plan error | 255 |
| `moon test` with failing tests | 2 |
| `moon fmt --check` with formatting differences | 255 |
| `moon check --deny-warn` when any warning exists | 255 |
| `moon doc` in a new-DSL module (broken, see below) | 255 |
| `moon test -p` with a nonexistent `--patch-file` (compiler crash) | 1 |

## new

```sh
moon new hello --user mbtskills
```

`--user` is required non-interactively. See references/project-layout-and-config.md for the generated tree.

## check

```sh
moon check
moon check textutil
moon check lib.mbt
```

Accepts no argument (whole module), a package directory, or a single `.mbt`/`.mbt.md` file. `-q` silences the `Finished.` line. Diagnostics flags (`--deny-warn`, `--warn-list`, `--output-json`, `--no-render`) are covered in references/diagnostics-and-recovery.md. `--target {wasm,wasm-gc,js,native,llvm,all}` selects backends.

## build and the `_build` layout

```sh
moon build
moon build --target js
moon build --release
```

The build directory is **`_build/`** (not `target/`). Default target is wasm-gc (or the module's `preferred_target`); default mode is debug. Layout: `_build/<target>/<debug|release>/build/<pkg-path>/`. Verified artifacts per target for `cmd/main`:

```
_build/wasm-gc/debug/build/cmd/main/main.wasm   (+ main.wasm.map in debug)
_build/wasm/debug/build/cmd/main/main.wasm
_build/js/debug/build/cmd/main/main.js          (+ main.js.map, main.d.ts, moonbit.d.ts)
_build/native/debug/build/cmd/main/main.exe     (named .exe even on macOS)
```

Library packages produce `<pkg>.core` + `<pkg>.mi` per target. `--target all` builds wasm, wasm-gc, js, and native (not llvm — llvm is listed but crashes on stable; see references/targets-and-conditional-builds.md).

## run

```sh
moon run cmd/main
moon run cmd/main one two
moon run --target native cmd/main
```

Takes the **filesystem path** of an executable package (with `source = "src"`, that means `moon run src/cmd/main`). Trailing arguments pass straight to the program, no `--` separator; the program sees argv[0] as the built artifact path. Running a library package fails: `` Error: `textutil` is not a main package `` (exit 255).

Outside any module, `moon run` runs throwaway code in a temporary project:

```sh
moon run -e 'fn main { println("one-liner") }'
moon run hello.mbtx
printf 'fn main { println("from stdin") }' | moon run -
```

`.mbtx` scripts support pinned inline imports — see references/workspaces-and-scripts.md.

## test

```sh
moon test
moon test -u
```

`moon test` runs regular tests **and** doctests (the old `--doc` flag is deprecated); `-u` updates `inspect` snapshots in place. Filtering, coverage, and benchmarks: references/testing-workflows.md.

## fmt

```sh
moon fmt
moon fmt --check
```

- `moon fmt` rewrites sources **and config files**: it canonicalizes `moon.pkg` (e.g. `options("is-main": true)` becomes `pkgtype(kind: "executable")`) and migrates any legacy JSON configs, deleting the JSON originals. Not a read-only command.
- `moon fmt --check` modifies nothing, renders would-be changes as git diffs (against formatted copies under `_build/wasm-gc/release/format/`), and exits 255 when anything differs. Cosmetic bug at the pin: each diff is followed by a noise line `failed to execute git --no-pager diff ...` because git itself exits 1 on differences — the diff above it is real.
- `--block-style` no longer exists (rejected as unexpected argument). Remaining options: `--check`, `--sort-input`, `--warn`, plus `moon fmt -- <args>` passthrough to the underlying `moonfmt` binary.

## info

```sh
moon info
```

Writes a `pkg.generated.mbti` public-API summary into every package directory (source tree, not `_build/`; intended to be committed). Parameter names are dropped (`pub fn add(Int, Int) -> Int`). `-p <name>` limits regeneration; names match by path segment.

## doc — broken for new-DSL modules

```sh
moon doc
```

**Verified broken at the pin:** in a module using the current `moon.mod` DSL, `moon doc` crashes — the doc generator still hard-requires `moon.mod.json` (`Fatal error: exception Sys_error(".../moon.mod.json: No such file or directory")`, then exit 255). Partial files may appear under `_build/doc/` anyway; their presence does not mean it worked. The only working path is a legacy-JSON module, where output lands in `_build/doc/<user>/<module>/` (HTML per file, `members.md`, JSON indexes). `moon doc` also refuses to run while the project has *any* warnings. `--serve` (default 127.0.0.1:3000) exists but was not executed here. For API lookup, prefer `moon ide doc` (references/moon-ide.md) — passing a symbol to `moon doc` is itself marked deprecated.

## clean, version

```sh
moon clean
moon version --all
```

`moon clean` deletes the whole `_build/` directory. `moon version --all` prints moon/moonc/moonrun versions plus a `Feature flags enabled: rr_moon_mod,rr_moon_pkg` line (the DSL config formats sit behind enabled-by-default feature flags); `--json` gives machine-readable output (without the feature-flags line).

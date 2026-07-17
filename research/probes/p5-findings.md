# P5 findings: MOON TOOLCHAIN behavior

Toolchain verified: moon 0.1.20260713 (75c7e1f 2026-07-13), moonc v0.10.4+ade96c819, moonrun 0.1.20260713, macOS arm64. `moon version --all` prints a line `Feature flags enabled: rr_moon_mod,rr_moon_pkg` — the new DSL config formats are behind (enabled-by-default) feature flags.

### moon-new-tree
- conclusion: `moon new hello --user probeuser` scaffolds a git repo (git init included), an AGENTS.md, .githooks/pre-commit, a GitHub Copilot workflow, root library package + cmd/main executable, and uses ONLY new-style `moon.mod`/`moon.pkg` (no JSON configs anywhere).
- example:
```
hello/
├── .git/  (moon new runs `git init`)
├── .githooks/pre-commit, .githooks/README.md
├── .github/workflows/copilot-setup-steps.yml
├── .gitignore            (_build/, target/, .mooncakes/, .moonagent/, .DS_Store)
├── AGENTS.md
├── LICENSE
├── README.md -> README.mbt.md (both present; README.md is a symlink)
├── moon.mod
├── moon.pkg               (EMPTY file — root package needs no options)
├── hello.mbt
├── hello_test.mbt         (blackbox test stub)
├── hello_wbtest.mbt       (whitebox test stub)
└── cmd/main/{main.mbt, moon.pkg}
```
- command: moon new hello --user probeuser
- result: pass — "Created probeuser/hello at hello"; tree as above
- notes: `--user` required in non-interactive mode. Root `moon.pkg` is a zero-byte file; presence alone marks the directory as a package.

### moon-mod-dsl-format
- conclusion: generated `moon.mod` is the new DSL: bare `key = "value"` lines (name, version, readme, repository, license, keywords, description) plus top-level `preferred_target = "wasm-gc"`; dependencies go in an `import { ... }` block, NOT a JSON "deps" object.
- example:
```
name = "probeuser/hello"
version = "0.1.0"
readme = "README.mbt.md"
repository = ""
license = "Apache-2.0"
keywords = []
preferred_target = "wasm-gc"
description = ""
```
- command: moon new hello --user probeuser; cat moon.mod
- result: pass (verbatim content above, comments stripped)
- notes: The official agent guide shows `options("preferred-target": "native")` inside an options() block, but the generator emits a TOP-LEVEL `preferred_target = "wasm-gc"` key (snake_case, no options block). Both spellings apparently exist; see preferred-target-both-forms below.

### moon-pkg-main-dsl
- conclusion: executable package config is `options("is-main": true)` in `moon.pkg`; generated cmd/main/moon.pkg shows the commented import syntax `import { "probeuser/hello" @lib, }`.
- example:
```
// cmd/main/moon.pkg as generated:
// import {
//   "probeuser/hello" @lib,
// }
options(
  "is-main": true,
)
```
- command: moon new hello --user probeuser; cat cmd/main/moon.pkg
- result: pass
- notes: option keys are quoted strings with kebab-case ("is-main"), unlike moon.mod's snake_case top-level keys.

### multi-package-imports
- conclusion: packages import each other in `moon.pkg` via `import { "user/mod/sub" }` (default alias = last path segment) or `import { "user/mod" @alias }` (custom alias, note alias comes AFTER the path with `@` prefix, no colon), then call `@alias.func()`.
- example:
```
// cmd/main/moon.pkg
import {
  "probeuser/hello" @lib,
  "probeuser/hello/liba",
  "probeuser/hello/liba/libb" @bb,
}
options(
  "is-main": true,
)
// main.mbt
fn main {
  println(@lib.hello())      // root package, custom alias
  println(@liba.greet_a())   // default alias liba
  println(@bb.greet_b())     // nested pkg custom alias
}
```
- command: moon run cmd/main
- result: pass — prints "Hello from root / from liba / from libb"
- notes: root package of a module is importable by the bare module name "probeuser/hello"; a custom alias is needed for it since the last segment "hello" would collide with nothing but is the module name.

### for-test-wbtest-imports
- conclusion: `import { ... } for "test"` makes a package visible only in `*_test.mbt` (blackbox), `import { ... } for "wbtest"` only in `*_wbtest.mbt`; using a test-only import from normal code fails with E4020 "Package ... not found in the loaded packages".
- example:
```
// moon.pkg (root)
import {
  "probeuser/hello/util",
} for "test"
import {
  "probeuser/hello/liba/libb",
} for "wbtest"
// hello_test.mbt
test "blackbox uses @hello and test-only import" {
  inspect(@hello.hello(), content="Hello from root")
  inspect(@util.helper_tag(), content="helper")
}
// hello_wbtest.mbt
test "whitebox sees internals and wbtest import" {
  inspect(hello(), content="Hello from root")   // no @ needed, whitebox
  inspect(@libb.greet_b(), content="from libb")
}
```
- command: moon test
- result: pass — "Total tests: 2, passed: 2, failed: 0."
- notes: blackbox tests auto-import the tested package as `@hello` without declaring it. Whitebox tests see private members directly.

### diagnostic-format-sample
- conclusion: moon diagnostics are rendered with an error code in brackets, an ASCII-art source span, and a summary line; a failing `moon check` exits 255 (not 1).
- example:
```
///|
pub fn misuse() -> String {
  @util.helper_tag()   // @util is imported `for "test"` only
}
```
- command: moon check; echo $?
- result: fail (expected). Verbatim:
```
Error: [4020]
   ╭─[ .../hello/misuse.mbt:3:3 ]
   │
 3 │   @util.helper_tag()
   │   ────────┬───────  
   │           ╰───────── Package "util" not found in the loaded packages.
───╯
Failed with 0 warnings, 1 errors.
Error: failed when checking project
exit=255
```
- notes: exit code is 255, not 1. Error code E4020 for unknown package.

### pkgtype-executable
- conclusion: `pkgtype(kind: "executable")` in moon.pkg works as an alternative to `options("is-main": true)`; valid kinds are `library`, `executable`, `foreign_library` (revealed by the error for an invalid kind).
- example:
```
// cmd/alt/moon.pkg — entire file:
pkgtype(kind: "executable")
// cmd/alt/alt.mbt
fn main {
  println("alt main via pkgtype")
}
```
- command: moon run cmd/alt
- result: pass — prints "alt main via pkgtype"
- notes: `pkgtype(kind: "bogus")` fails at package discovery with: "unknown variant `bogus`, expected one of `library`, `executable`, `foreign_library`". So BOTH `pkgtype(kind: "executable")` and `options("is-main": true)` are accepted in v0.10.4.

### moon-mod-source-field
- conclusion: top-level `source = "src"` in moon.mod works: packages then live under src/ but keep import paths without the src prefix; `moon run` still takes the FILESYSTEM path (`moon run src/cmd/main`), not the source-relative package path (`moon run cmd/main` fails with "failed to resolve path").
- example:
```
// moon.mod
name = "probeuser/srcmod"
version = "0.1.0"
source = "src"
// layout: src/moon.pkg, src/lib.mbt, src/cmd/main/{moon.pkg,main.mbt}
// src/cmd/main/moon.pkg imports "probeuser/srcmod" @lib
```
- command: moon run src/cmd/main   (moon run cmd/main -> error)
- result: pass — "srcmod root"; `moon run cmd/main` fails: "Error: failed to resolve path `cmd/main`" exit 255
- notes: import path stays "probeuser/srcmod" (source dir not part of package path), but run argument is the real directory path. Slightly asymmetric.

### moon-mod-options-vs-toplevel
- conclusion: moon.mod accepts BOTH spellings: top-level `source = "src"` / `preferred_target = "js"` (what `moon new` generates) AND an `options(source: "src", "preferred-target": "js")` block (what the official agent guide documents); both pass moon check.
- example:
```
// form A (generated style)
source = "src"
preferred_target = "js"
// form B (guide style)
options(
  source: "src",
  "preferred-target": "js",
)
```
- command: moon check with each form
- result: pass for both
- notes: doc-vs-reality: the agent guide only shows the options() form; the generator only emits top-level keys. In options() form, `source:` is a bare key while "preferred-target" must be quoted (kebab-case).

### preferred-target-effect
- conclusion: `preferred_target = "js"` changes the default target of moon build: after `moon clean`, `moon build` produces only `_build/js/debug/build/...` artifacts.
- example:
```
preferred_target = "js"   // in moon.mod
```
- command: moon clean && moon build && find _build -type f
- result: pass — artifacts only under _build/js/debug/build/: main.core, main.js, main.js.map, main.d.ts, moonbit.d.ts, srcmod.core, srcmod.mi, all_pkgs.json, build.moon_db
- notes: js build emits TypeScript declaration files (main.d.ts, moonbit.d.ts) and a source map by default. Default build mode is debug ("debug" path segment). `moon clean` deletes the whole `_build` dir.

### moon-check-flags
- conclusion: `moon check` accepts `[PATH]...` (a package directory OR a single `.mbt`/`.mbt.md` file), plus `-d/--deny-warn`, `--warn-list`, `--output-json`, `--no-render`, `--patch-file`, `--explain`, `--fmt`, `-w/--watch`, `--diagnostic-limit <N>`, `--target {wasm,wasm-gc,js,native,llvm,all}`.
- example:
```
moon check annot.mbt      # single file — works ("ran 5 tasks")
moon check liba           # package dir — works
moon check -q             # silent, exit 0
```
- command: moon check --help; moon check <file>; moon check <dir>
- result: pass — all accepted
- notes: target list includes `llvm` as a 6th value beside wasm/wasm-gc/js/native/all. `--fmt` (format check) and `--explain` are flags of moon check itself. `-q` suppresses even the "Finished" line.

### moon-check-deny-warn
- conclusion: `--deny-warn` promotes warnings to errors and flips exit code from 0 to 255; the rendered label becomes "Error Warning (unused_value): ...".
- example:
```
///|
fn unused_helper() -> Int {
  42
}
```
- command: moon check (exit 0, "1 warnings, 0 errors") vs moon check --deny-warn (exit 255)
- result: pass — deny-warn output ends: `Failed with 0 warnings, 1 errors.` / `Error: failed when checking project`
- notes: unused function warning is code [0001], name `unused_value`.

### warn-list-73
- conclusion: `--warn-list +unnecessary_annotation` and `--warn-list +73` both enable warning 0073; it fires on over-qualified constructors (e.g. `Option::Some` where `Some` suffices) but NOT on a redundant `let x : Int = 1` type annotation.
- example:
```
///|
pub fn annotated() -> Option[Int] {
  let o : Option[Int] = Option::Some(1)
  o
}
```
- command: moon check --warn-list +unnecessary_annotation
- result: pass — `Warning: [0073] ... This `Option::` annotation is unnecessary.`
- notes: `let x : Int = 1` (redundant type annotation on a literal) produced NO 0073 warning — the warning targets unnecessary qualifiers/annotations of a narrower kind than the name suggests.

### moon-check-output-json
- conclusion: `moon check --output-json` emits one JSON object per diagnostic on stdout with fields $message_type, level, error_code (number), path, loc ("2:4-2:17"), message, context; `--no-render` prints a compact one-line `path:span [E0001] message` format instead of the ASCII art.
- example (verbatim JSON line):
```
{"$message_type":"diagnostic","level":"warning","error_code":1,"path":".../warnprobe.mbt","loc":"2:4-2:17","message":"Warning (unused_value): Unused function 'unused_helper'","context":"1 |///|\n2 |fn unused_helper() -> Int {\n3 |  42\n"}
```
- command: moon check --output-json; moon check --no-render
- result: pass
- notes: the final "Finished..." summary line is still plain text after the JSON lines. With --no-render the same diagnostic printed TWICE (appears once per check flavor, e.g. package + blackbox-test check of the same file).

### moon-test-selection
- conclusion: test selection: positional PATH (package dir or single file), `-p/--package <name>` (matches by path SEGMENT: `-p liba` also picks up nested `liba/libb`; the full name `-p probeuser/hello/liba` matches only that exact package), `-i/--index N` or range `0-2` (single file only), `-f/--filter <glob>` filters by TEST NAME (also accepts undocumented shorthand `-F`).
- example:
```
moon test                          # 6 tests (root + liba + libb + util)
moon test -p probeuser/hello/liba  # 3 tests (exact package)
moon test -p liba                  # 4 tests (liba AND liba/libb — segment match)
moon test liba                     # 3 tests (path = just that dir)
moon test liba/a_test.mbt          # 3 tests (one file)
moon test liba/a_test.mbt -i 1     # only index 1 ("alpha two")
moon test liba/a_test.mbt -i 0-2   # indices 0,1 (right-exclusive range)
moon test --filter 'alpha*'        # 2 tests by name glob
moon test liba -F 'alpha*'         # same; -F is an undocumented alias
```
- command: as above, in the hello module
- result: pass — counts verified via -v output and Total lines
- notes: IMPORTANT doc-vs-help gap: `-f` is `--filter` (glob on test name), NOT a file selector. Files are selected positionally. `-i` implies `--include-skipped`. `moon test --outline` prints a numbered list of every test with package, file:line, index, and name without running anything.

### moon-test-flags-help
- conclusion: `moon test --help` documents: `-u/--update`, `-l/--limit` (max expect-test update PASSES, default 256 — an anti-infinite-loop bound, not a test-count limit), `--doc-index`, `--build-only`, `--profile`, `--no-parallelize`, `--outline`, `--test-failure-json`, `--patch-file`, `--include-skipped`; there is NO `--doc` flag in help.
- command: moon test --help
- result: pass (verbatim options recorded)
- notes: `moon test --doc` still runs but prints "Warning: --doc flag is deprecated and will be removed in the future, please use `moon test` directly" — doctests now run as part of plain `moon test`.

### moon-test-snapshot-update
- conclusion: `inspect(expr)` without content fails with a diff, and `moon test -u` rewrites the source in place using the multiline-string form `content=(#|3\n  )` rather than `content="3"`.
- example:
```
test "snapshot demo" {
  inspect(1 + 2)
}
// after `moon test util -u` the file becomes:
test "snapshot demo" {
  inspect(1 + 2, content=(#|3
  ))
}
```
- command: moon test util (fails, diff "+3"); moon test util -u (passes, rewrites file)
- result: pass
- notes: update output uses `#|` multiline string literal syntax even for single-line content.

### moon-test-exit-and-failure-json
- conclusion: a failing `moon test` exits with code 2 (vs 255 for a failed `moon check`); `--test-failure-json` prints one JSON object per failed test.
- example (verbatim failure JSON):
```
{"package":"probeuser/hello/util","filename":"fail_test.mbt","index":"0","test_name":"deliberately failing","message":"util/fail_test.mbt:3:3-3:18@probeuser/hello FAILED: `1 != 2`\ndiff:\n-1 +2"}
```
- command: moon test util --test-failure-json; echo $?
- result: pass — exit 2 on failure; JSON as above; "Total tests: 2, passed: 1, failed: 1."
- notes: `index` is a JSON string, not a number. `--no-parallelize` accepted (same results).

### moon-test-doctests
- conclusion: ```mbt check``` blocks inside `///` docstrings are compiled and run as blackbox tests by plain `moon test` (shown as `file.mbt:LINE (#0)`); `--doc-index N` selects the N-th doctest of a single file.
- example:
```
///|
/// Doubles a number.
///
/// Example:
/// ```mbt check
/// test {
///   inspect(@util.double(21), content="42")
/// }
/// ```
pub fn double(x : Int) -> Int {
  x * 2
}
```
- command: moon test util -v; moon test util/doc_demo.mbt --doc-index 0
- result: pass — `[probeuser/hello] test util/doc_demo.mbt:6 (#0) ok`
- notes: inside the doctest you reference the package as `@util` (blackbox view of the containing package).

### moon-test-patch-file
- conclusion: `--patch-file <json>` overlays virtual test files without touching disk, but ONLY takes effect with `-p` package selection — with a positional PATH selector the flag is silently ignored; schema is `{"drops": [...], "patches": [{"name": "file.mbt", "content": "source"}]}`.
- example:
```
// patch3.json
{
  "drops": ["snap_test.mbt"],
  "patches": [
    {"name": "injected_test.mbt",
     "content": "///|\ntest \"from patch\" {\n  inspect(2 + 3, content=\"5\")\n}\n"}
  ]
}
```
- command: moon test -p probeuser/hello/util --patch-file $PWD/patch3.json -v
- result: pass — runs `util/injected_test.mbt:2 ("from patch") ok` for a file that does not exist on disk
- notes: (1) with `moon test util --patch-file ...` (path selection) the patch did nothing, no warning — the flag is inert there, so even a nonexistent patch path passes silently; (2) with `-p` selection a NONEXISTENT patch path is NOT ignored: moonc crashes with its internal-compiler-error banner, `Error: Sys_error("/nonexistent/nope.json: No such file or directory")`, exit 1; (3) "drops" did NOT remove snap_test.mbt from the run in my experiment; (4) a patched *_test.mbt that referenced `@util` failed oddly with E4020 rendered against the on-disk file's source lines — patch diagnostics point at wrong source text.

### moon-build-targets-and-layout
- conclusion: `moon build --target {wasm,wasm-gc,js,native}` all work; artifacts land in `_build/<target>/<debug|release>/build/<pkg-path>/<pkg>.{wasm,js,exe}`; default mode is debug; `--release` writes a parallel `release/` tree; `--target llvm` on this stable toolchain crashes.
- example:
```
_build/wasm-gc/debug/build/cmd/main/main.wasm (+ main.wasm.map in debug)
_build/wasm/debug/build/cmd/main/main.wasm
_build/js/debug/build/cmd/main/main.js (+ main.js.map, main.d.ts, moonbit.d.ts)
_build/native/debug/build/cmd/main/main.exe (+ .dSYM bundle on macOS, runtime.o, __moonbit_link_core__/main.o)
_build/wasm-gc/release/build/cmd/main/main.wasm (no .map in release)
```
- command: moon clean; moon build --target <t> for each; find _build -type f
- result: pass for wasm/wasm-gc/js/native; llvm FAILS
- notes: `--target llvm` prints "Warning: LLVM backend is experimental and only supported on nightly moonbit toolchain for now" then an internal compiler error (ICE banner with ASCII art) because `~/.moon/lib/core/_build/llvm/release/bundle/prelude/prelude.mi` does not exist on stable. Native executables are named `.exe` even on macOS. Library packages produce `<pkg>.core` + `<pkg>.mi` per target. `--target all` builds wasm+wasm-gc+js+native (not llvm). `-w/--watch` exists on moon build ("Monitor the file system and automatically build artifacts") — not exercised. Also `--output-wat` flag exists.

### moon-run-args-passthrough
- conclusion: `moon run <pkg> arg1 arg2` passes trailing args straight to the program (no `--` separator needed); `@env.args()` sees argv[0] = the built artifact path (.wasm on wasm-gc, .exe on native) followed by the args.
- example:
```
// cmd/args/moon.pkg
import {
  "moonbitlang/core/env",
}
pkgtype(kind: "executable")
// args.mbt
fn main {
  println(@env.args())
}
```
- command: moon run cmd/args one two; moon run --target native cmd/args one two
- result: pass — `[.../_build/wasm-gc/debug/build/cmd/args/args.wasm, one, two]` / `[.../args.exe, one, two]`
- notes: `@env.args()` requires importing "moonbitlang/core/env". Printing an Array via println currently triggers a core deprecation warning: "Use Debug instead of Show for debugging purposes".

### moon-run-script-modes
- conclusion: outside any module, `moon run` executes: `-e '<code>'` one-liners, standalone `.mbtx` script files, `.mbtx` source from stdin via `moon run -`, and even a bare `.mbt` file — all without a moon.mod (help: "otherwise, runs in a temporary project").
- example:
```
moon run -e 'fn main { println("from -e") }'
# script.mbtx:
fn main {
  println("from mbtx script: \{1+2}")
}
moon run script.mbtx
printf 'fn main { println("from stdin") }\n' | moon run -
moon run plain.mbt        # plain .mbt also accepted standalone
```
- command: as shown, run from a non-module directory
- result: pass — all four print as expected, exit 0
- notes: string interpolation `\{...}` works in scripts. Help says stdin `-` reads ".mbtx source".

### legacy-json-configs-still-work
- conclusion: a module using legacy `moon.mod.json` + `moon.pkg.json` (old schema: "deps", "is-main", "import": [{"path","alias"}]) still checks and runs with ZERO deprecation warnings from moon check/run/test in v0.10.4.
- example:
```
// moon.mod.json: {"name":"probeuser/legacy","version":"0.1.0","deps":{}, ...}
// main/moon.pkg.json: {"is-main": true, "import":[{"path":"probeuser/legacy","alias":"lib"}]}
```
- command: moon check (exit 0, no warning); moon run main → "legacy"
- result: pass
- notes: doc-vs-reality: docs say JSON configs are deprecated in v0.10.4 and will be removed next release, but nothing in check/build/run/test warns about them. The deprecation only surfaces when you run `moon fmt` (see next finding).

### moon-fmt-migrates-json-configs
- conclusion: `moon fmt` REWRITES config files: it converts moon.mod.json → moon.mod and every moon.pkg.json → moon.pkg and DELETES the JSON originals, printing "Warning: Migrating to moon.mod at module root '...', deprecated moon.mod.json is removed." per file — so running the formatter is the migration tool.
- example:
```
// before: moon.mod.json + moon.pkg.json + main/moon.pkg.json
// after `moon fmt`: moon.mod, moon.pkg, main/moon.pkg — JSON files gone.
// main/moon.pkg content produced from {"is-main":true,"import":[{"path":"probeuser/legacy","alias":"lib"}]}:
import {
  "probeuser/legacy" @lib,
}

options(
  "is-main": true,
)
```
- command: moon fmt (inside the legacy module)
- result: pass — migration performed, module still runs
- notes: this matches the docs' claim that the new DSL is current. Surprising: a "formatter" command deletes and replaces config files. The migrated moon.mod initially lacks a trailing newline, so the very next `moon fmt --check` STILL reports a diff (adds final newline) — migration output is not fully fmt-clean in one pass.

### moon-fmt-check-behavior
- conclusion: `moon fmt --check` does not modify files; it renders would-be changes as `git diff --no-index` output (comparing the source tree to formatted copies under `_build/wasm-gc/release/format/`) and exits 255 if anything differs; it also prints the JSON-migration warnings even though in check mode nothing is actually migrated.
- command: moon fmt --check; echo $?
- result: pass — exit 255 with diffs, 0 when clean
- notes: cosmetic bug: after each shown diff it prints "failed to execute `git --no-pager diff --color=always --no-index ...`" because git exits 1 on differences — the diff WAS rendered, the "failed" line is noise. Check mode also formats moon.mod/moon.pkg files themselves (e.g. missing trailing newline is a diff).

### moon-fmt-no-block-style
- conclusion: `moon fmt --block-style` does NOT exist in this version — it is rejected as an unexpected argument; moon fmt's only options are --check, --sort-input, --warn, plus `-- <ARGS>` passthrough to the underlying `moonfmt` binary.
- command: moon fmt --block-style (fails); moon fmt --help; moon fmt -- --help
- result: fail as described (flag removed/absent)
- notes: `moon fmt -- --help` reveals the underlying moonfmt options: -w/-i overwrite, -o output, `-file-type {mbt|md|pkg|pkg_json|mod|mod_json}`, and surprising extras `-add-dependency (path@version)`, `-remove-dependency`, `-add-uuid`, `-strip-uuid` — moonfmt is also the config-file rewriter that powers moon add/remove. No block-style flag anywhere.

### moon-info-mbti
- conclusion: `moon info` writes a `pkg.generated.mbti` file into EVERY package directory (including executable cmd packages); the file lists the public API grouped under headers // Values, // Errors, // Types and methods, // Type aliases, // Traits; parameter NAMES are dropped (`pub fn added_later(Int) -> Int`).
- example (verbatim liba/pkg.generated.mbti):
```
// Generated using `moon info`, DON'T EDIT IT
package "probeuser/hello/liba"

// Values
pub fn added_later(Int) -> Int

pub fn greet_a() -> String

// Errors

// Types and methods

// Type aliases

// Traits
```
- command: moon info; moon info -p liba
- result: pass — files created in source tree (not _build); adding a pub fn and re-running updates only the Values section
- notes: `-p` accepts short segment names like `-p liba` (regenerates liba AND nested liba/libb, same segment matching as moon test). mbti files land next to sources, intended to be committed.

### moon-doc-broken-on-new-dsl
- conclusion: `moon doc` CRASHES in a module that uses the new `moon.mod` DSL — moondoc still hard-requires `moon.mod.json` ("Fatal error: exception Sys_error(.../moon.mod.json: No such file or directory)"), so doc generation only works in legacy-JSON modules; a big doc-vs-reality gap given JSON configs are the "deprecated" format.
- example:
```
# in a new-DSL module (moon.mod, no moon.mod.json):
$ moon doc
Fatal error: exception Sys_error(".../hello/moon.mod.json: No such file or directory")
Raised by primitive operation at Stdlib.open_in_gen ...
Called from Moondoc.Docgen_json.generate_json_files ... (moondoc.ml)
Error: failed when checking project     # exit 255
```
- command: moon doc (new-DSL module: crash) vs moon doc (legacy moon.mod.json module: works)
- result: fail on new DSL; pass on legacy JSON — output goes to `_build/doc/<user>/<module>/` with package_data.json, module_index.json, <file>.mbt.html, members.md, resource.json per package
- notes: caveat: even on the crashing new-DSL run, PARTIAL artifacts (package_data.json / resource.json per package) are still written under `_build/doc/` before the crash — files there do not mean doc generation succeeded. moon doc also refuses to proceed if the project has ANY warnings ("Failed with 1 warnings, 0 errors" then exit 255) — doc generation implies deny-warn semantics. `--serve` (with `-b/--bind`, `-p/--port`, default 127.0.0.1:3000) exists; not exercised. Passing a SYMBOL arg to `moon doc` is marked "[Deprecated] ... Use `moon ide doc <SYMBOL>` instead".

### moon-add-remove-tree-update
- conclusion: `moon add moonbitlang/x@0.4.6` and `moon add moonbitlang/x` (latest) write `"moonbitlang/x@<ver>"` into moon.mod's `import { }` block; `-u/--upgrade` bumps an existing dep; `moon remove <name>` deletes it; `moon tree` prints an ASCII dependency tree; `moon update` refreshes the registry index; deps are vendored into `.mooncakes/` at the module root.
- example:
```
$ moon add moonbitlang/x@0.4.6     # -> import { "moonbitlang/x@0.4.6", }
$ moon add moonbitlang/x -u        # -> import { "moonbitlang/x@0.4.46", }
$ moon tree
probeuser/hello@0.1.0 (local ...):
└─ moonbitlang/x -> moonbitlang/x@0.4.46
```
- command: as shown
- result: pass
- notes: (1) to USE the dep you still add e.g. "moonbitlang/x/uuid" to a moon.pkg import block; (2) pinned OLD version x@0.4.6 no longer compiles under moonc v0.10.4 (`Type Bytes has no method op_set`, E4015 inside .mooncakes source) — registry deps are recompiled from source so old versions can break with a newer compiler; (3) removing a dep still referenced by a moon.pkg gives: "0: Failed to solve package relationship / 1: Cannot find import 'moonbitlang/x/uuid' in probeuser/hello@0.1.0".

### local-path-deps-not-in-new-dsl
- conclusion: local path dependencies are NOT supported by the new moon.mod DSL AT ALL — they still work in legacy moon.mod.json ("deps": {"m": {"path": "../other"}}), but `moon fmt` migration then fails with: "Error: moon.mod does not support local dependency `probeuser/othermod` in `import`; use workspace configuration in `moon.work` instead. See https://docs.moonbitlang.com/en/latest/toolchain/moon/module.html#dependency-management"
- example:
```
// legacy moon.mod.json (WORKS: moon test passes)
{
  "name": "probeuser/pathdep",
  "version": "0.1.0",
  "deps": { "probeuser/othermod": { "path": "../othermod" } }
}
// moon fmt -> hard error, no migration performed (JSON files left intact)
```
- command: moon test (pass); moon fmt (error above, exit 255)
- result: pass/fail as described
- notes: the official replacement for path deps is a moon.work workspace (see workspace findings). Migration failure is graceful: nothing deleted, module keeps working on JSON.

### moon-add-bin
- conclusion: `moon add --bin <module>` records the dependency in moon.mod as an options entry `options("bin-deps": { "moonbitlang/x": "0.4.46" })` instead of the import block; `moon remove` can NOT remove a bin-dep ("Error: the dependency `moonbitlang/x` could not be found") — you must edit moon.mod by hand.
- example:
```
options(
  "bin-deps": { "moonbitlang/x": "0.4.46" },
)
```
- command: moon add --bin moonbitlang/x; moon remove moonbitlang/x
- result: pass for add; remove fails as quoted
- notes: during the config rewrite, moon rendered a spurious MoonBit `ambiguous_braces` warning against the moon.mod content (the DSL is parsed with the MoonBit parser, and the `{ }` map literal trips warning heuristics) — one-time, disappears on re-run.

### moon-install-deprecated-noargs
- conclusion: `moon install` without args is deprecated: "Warning: `moon install` without arguments is deprecated and will be removed in a future version. Use `moon install <package>` to install binaries globally, or use `moon build` to build your project."; with args it installs a binary globally (source can be a local path, git URL, or registry name per --help).
- command: moon install
- result: pass (warning shown, verbatim above)
- notes: not exercised with a real package to avoid global installs.

### moon-work-workspace
- conclusion: `moon work init` creates `moon.work` with `members = []`; `moon work use <dirs...>` appends validated member paths; `moon check` / `moon test` at the workspace root operate across all members; running inside a member dir also works and still resolves sibling members.
- example:
```
// moon.work after `moon work init && moon work use base app`:
members = [
  "./base",
  "./app",
]
// app/moon.mod declares the sibling:
import {
  "probeuser/base@0.2.0",
}
// app/moon.pkg: import { "probeuser/base", }
```
- command: moon work init; moon work use base app; moon check; moon test
- result: pass — 1 test passes at root and from inside app/
- notes: `moon work use` VALIDATES members: it refused to add a member whose moon.mod contained an unversioned import ("moon.mod only supports versioned registry dependencies in `import`, found `probeuser/base`") — moon.mod import entries MUST be `name@version`. Glob members are not supported: `members = ["./*"]` → "failed to resolve workspace member `./*` ... No such file or directory".

### workspace-dependency-resolution
- conclusion: intra-workspace dependencies are declared like a normal versioned registry dep in the member's moon.mod (`"probeuser/base@0.2.0"`), but resolution PREFERS the local member and IGNORES the declared version — a deliberate mismatch (app wants @0.2.0, base/moon.mod says 0.9.0) still builds with no warning; `moon work sync` rewrites member manifests so declared versions match actual member versions.
- example:
```
$ moon work sync
Synced workspace manifests:
app/moon.mod        # "probeuser/base@0.2.0" rewritten to "probeuser/base@0.9.0"
```
- command: edit base version to 0.9.0; moon check (passes silently); moon work sync
- result: pass
- notes: the module "probeuser/base" does not exist in any registry, proving resolution was local. So the new-DSL answer to "local path dependency" = workspace membership + versioned name; the version string is cosmetic until you publish.

### conditional-compilation-targets
- conclusion: per-file conditional compilation in the new DSL is `options(targets: { "file.mbt": [ <cond> ] })` in moon.pkg — exactly what the docs claim; conditions are backends ("wasm","wasm-gc","js","native"), modes ("debug","release"), and prefix operators ("not","and","or") in nested arrays; verified that a js-only extern file is compiled for js and excluded elsewhere.
- example:
```
// moon.pkg
options(
  targets: {
    "only_js.mbt": [ "js" ],
    "not_js.mbt": [ "not", "js" ],
    "dbg.mbt": [ "debug" ],
    "rel.mbt": [ "release" ],
  },
)
// only_js.mbt
extern "js" fn js_rand() -> Double = "() => 42.0"
pub fn backend_tag() -> String {
  "js says \{js_rand()}"
}
// not_js.mbt
pub fn backend_tag() -> String {
  "non-js backend"
}
```
- command: moon run --target js cmd/show ("js says 42"); --target wasm-gc / native ("non-js backend"); moon run cmd/show ("debug mode") vs moon run --release cmd/show ("release mode"); moon check --target all passes
- result: pass
- notes: duplicate top-level definitions across mutually-exclusive files are fine (only one is in any given build). Note the "not" form is prefix-in-array: ["not","js"], and complex nesting ["or",["and","wasm","release"],["and","js","debug"]] round-trips through the JSON→DSL migration verbatim. moon fmt migration is a handy way to learn canonical DSL: feeding the old moon.pkg.json "targets" object produces the options(targets: {...}) form.

### coverage-flow
- conclusion: working coverage flow: EITHER `moon test --enable-coverage` (drops `_build/moonbit_coverage_<ts>_<hash>.txt` trace files) then `moon coverage report -f summary`, OR simply `moon coverage analyze` which instruments+runs tests itself and prints annotated uncovered lines directly.
- example:
```
$ moon coverage analyze
1 uncovered line(s) in liba/a.mbt:
7	pub fn added_later(x : Int) -> Int {
8	  x + 1	<-- UNCOVERED
9	}
Total: 4 uncovered line(s) in 4 file(s)

$ moon test --enable-coverage && moon coverage report -f summary
liba/a.mbt: 1/2
Total: 5/16
```
- command: as shown, in the hello module
- result: pass
- notes: `moon coverage report` is a thin wrapper over `moon_cove_report`; formats: bisect (OCaml bisect, DEFAULT), caret, coveralls (JSON), cobertura (XML), html, summary; flags `-p <package>`/`-F <file>` scope output, `--send-to coveralls|codecov` can upload. `moon coverage clean` removes artifacts. With no -t args it recursively globs `moonbit_coverage_*` under the cwd.

### moon-bench-syntax
- conclusion: a benchmark is a `test` block taking a bench parameter — `test "name" (b : @bench.T) { b.bench(fn() { ... }) }` — run with `moon bench [path]`, which reports mean ± sigma and min…max; plain `moon test` SKIPS bench blocks (they are not counted as tests).
- example:
```
///|
test "bench sum" (b : @bench.T) {
  b.bench(fn() {
    let mut s = 0
    for i in 0..<1000 {
      s = s + i
    }
    b.keep(s)
  })
}
```
- command: moon bench util
- result: pass — verbatim: `[probeuser/hello] bench util/bench_probe.mbt:2 ("bench sum") ok` / `time (mean ± σ)         range (min … max)` / ` 290.97 ns ±   7.43 ns   280.75 ns … 304.68 ns  in 10 × 100000 runs`
- notes: `b.keep(s)` prevents dead-code elimination of the result. Using `@bench` without importing "moonbitlang/core/bench" in moon.pkg gives a deprecation warning (core_package_not_imported) but still works. moon bench shares moon test's flags (--target, --release, PATH selection).

### moon-ide-suite
- conclusion: `moon ide` provides peek-def, find-references, rename (dry-run by default, `--apply` to rewrite), hover (`--loc path:line:col`, supports `--output-json`), outline (file or dir), analyze (public API usage counts), doc (API search), gen-symbols (writes ./symbols.jsonl) — all verified working in a local module; `--output-json` is ONLY accepted by hover, every other subcommand rejects it ("Error: <cmd>: unknown option '--output-json'").
- example:
```
moon ide peek-def greet_a          # "Found 1 symbols ... pub fn greet_a in package probeuser/hello/liba at .../a.mbt:1-4" + source
moon ide outline liba              # per-file: "2 |pub fn greet_a() -> String {"
moon ide doc 'String::*rev*'       # stdlib search: lists String::rev, rev_find, rev_iter... with signatures and #alias(deprecated) markers
moon ide doc '@liba'               # whole-package API dump: package "probeuser/hello/liba" // probeuser/hello@0.1.0 + signatures
moon ide hover --loc cmd/main/main.mbt:4:17 --output-json
# -> {"range":"4:11-4:24","contents":["```moonbit\nfn @probeuser/hello/liba.greet_a() -> String\n```"]}
moon ide find-references greet_a   # "Found 3 references for symbol 'greet_a':" with context blocks
moon ide analyze                   # mbti-like listing with "// usage: 2 (1 in test)" per symbol
moon ide gen-symbols               # writes ./symbols.jsonl, JSONL like {"kind":["Sym","hello"],"path":"hello.mbt","pkg":"probeuser/hello","tag":"0x1001","range":[2,1,4,2],...}
```
- command: as shown
- result: pass for all
- notes: `moon ide rename old new --loc file:line` prints a "*** Begin Patch / *** Update File: ... / @@ ... / *** End Patch" patch WITHOUT touching disk; `--apply` reports "Applied 1 edit(s) across 1 file(s)." and edits the file. gen-symbols includes test blocks as symbols (tag 0x8000) with quoted test names. hover output without --output-json is a caret-annotated source snippet.

### exit-codes-and-common-errors
- conclusion: exit codes are inconsistent across failure kinds: compile/check errors and build-plan errors → 255; failing TESTS → 2; success → 0; `moon fmt --check` with diffs → 255; and a directory WITHOUT moon.pkg is silently ignored (its .mbt files are simply not compiled, no error at all).
- example (verbatim error messages):
```
# no tests in module:
Warning: no test entry found.
Total tests: 0, passed: 0, failed: 0.        # exit 0

# import cycle (liba <-> libb):
Error: Failed to calculate build plan
Caused by:
    0: Failed to solve package relationship
    1: ... Error 1: Import loop detected: probeuser/hello -> probeuser/hello/liba/libb -> probeuser/hello/liba -> probeuser/hello/liba/libb
# exit 255; self-import also reported as "Import loop detected: ... liba -> liba"

# unknown module in moon.pkg import:
    1: Cannot find import 'someuser/notreal/pkg' in probeuser/hello/util@0.1.0   # exit 255

# moon run on a library package:
Error: `liba` is not a main package          # exit 255
# moon run on nonexistent path: "failed to resolve path" exit 255

# malformed moon.pkg (missing colon after "is-main"):
    1: Unable to read `moon.pkg` ... error: Parsing error: UnexpectedToken(STRING((Pos { line: 2, column: 3 }..Pos { line: 2, column: 12 }, "is-main")))
```
- command: as shown
- result: pass (all reproduced)
- notes: the silent-ignore of packages lacking moon.pkg is the sharpest trap: a typo'd/omitted moon.pkg means the code is invisible — no diagnostics anywhere. moon.pkg DSL parse errors surface as Rust-style debug enum dumps (UnexpectedToken(...)), not rendered diagnostics.

### housekeeping-flags
- conclusion: `moon clean` deletes the whole `_build` dir; `--target-dir <dir>` redirects all build state to another directory (creates packages.json + per-target trees there); `--frozen` ("Do not sync dependencies") is accepted on check/build/test/run; `moon version --all --json` emits machine-readable version info.
- example:
```
$ moon version --all --json
{"items":[{"name":"moon","version":"0.1.20260713 (75c7e1f 2026-07-13)","path":"~/.moon/bin/moon"},{"name":"moonc","version":"v0.10.4+ade96c819 (2026-07-13)","path":"~/.moon/bin/moonc"},{"name":"moonrun","version":"moonrun 0.1.20260713 (75c7e1f 2026-07-13)","path":"~/.moon/bin/moonrun"}]}
```
- command: moon clean; moon check --target-dir /tmp/moon-alt-target; moon check --frozen; moon version --all --json
- result: pass
- notes: `moon upgrade --help` shows only `-f/--force` and `--dev` (installs latest development version) — not executed. `moon version --all` also prints "Feature flags enabled: rr_moon_mod,rr_moon_pkg" but that line is absent from the --json output.

### moon-home-env
- conclusion: MOON_HOME redirects the registry/cache home: `MOON_HOME=<dir> moon update` clones the registry index into `<dir>/registry/{index,symbols}`; however core/stdlib resolution does NOT follow MOON_HOME (a clean `moon check` still used ~/.moon's core bundle) — toolchain location is governed separately (binary also reads MOON_TOOLCHAIN_ROOT, MOON_CORE_OVERRIDE, MOON_CC, MOON_AR, MOON_NO_WORKSPACE, MOON_IGNORE_PREBUILD per strings in the binary).
- command: MOON_HOME=$PWD/moonhome-test moon update; MOON_HOME=... moon check (after moon clean)
- result: pass — registry cloned under the alternate home; check unaffected
- notes: useful for sandboxing registry state without touching ~/.moon; not sufficient to relocate the toolchain.

### moon-package
- conclusion: `moon package` runs `moon check` first, then zips the module source to `_build/publish/<user>-<mod>-<version>.zip`; the archive contains .mbt sources INCLUDING *_test.mbt files, all moon.pkg/moon.mod configs, pkg.generated.mbti files, LICENSE and README; `--list` prints the file list.
- command: moon package; moon package --list; unzip -l _build/publish/probeuser-hello-0.1.0.zip
- result: pass — "Package to .../_build/publish/probeuser-hello-0.1.0.zip"
- notes: `_build` itself is excluded; test files are NOT stripped from the published archive.

### moon-publish-dry-run-hits-server
- conclusion: `moon publish` has no dedicated --dry-run of its own; the global `--dry-run` common option is accepted, and it does the local pipeline (metadata warnings -> moon check -> zip -> extract zip to `_build/publish/verify/` -> re-check extracted copy) BUT then still CONTACTS THE REGISTRY SERVER — here it ended with "Server status: 403 Forbidden, detail: User mismatch: The username in the module config file (probeuser) does not match the authenticated user's username (hyfdev)." followed by "Error: `moon publish` failed".
- command: moon publish --dry-run (nothing was published; server rejected with 403 user mismatch)
- result: fail at the server step by design of this probe (module owner "probeuser" != logged-in user)
- notes: WARNING for future agents: `--dry-run` on `moon publish` is NOT offline — it authenticates against the registry (credentials from ~/.moon/credentials.json). Required-metadata signal observed: "Warning: 'repository' field is not set or empty in module manifest" (warning only, not fatal). The validation flow re-checks the package from the extracted zip, which catches packaging mistakes.

### moon-explain
- conclusion: `moon explain --diagnostic 4020` prints a markdown explainer (# E4020, erroneous example, fix) for any error code, and `moon explain --attribute <name>` documents attributes; handy offline reference.
- command: moon explain --diagnostic 4020; moon explain --attribute deprecated
- result: pass
- notes: `moon check --explain` also exists as a flag to render error-code details inline with diagnostics.

## Summary: doc-vs-reality gaps

1. JSON configs "deprecated in v0.10.4": TRUE that new DSL is current and generated, but moon check/build/run/test emit NO deprecation warning for JSON modules; the deprecation only bites via `moon fmt` (which force-migrates and deletes the JSON files) and via new features (workspaces reject unversioned imports; new DSL refuses path deps). "Removal next release" is not verifiable locally.
2. `moon doc` is BROKEN for new-DSL modules: moondoc still hard-requires moon.mod.json and crashes with an OCaml Sys_error otherwise — the deprecated format is the only one moon doc works with.
3. The agent guide shows moon.mod options via `options("preferred-target": ...)`; `moon new` emits top-level `preferred_target = "..."`. Both parse.
4. Conditional compilation `options(targets: {"file.mbt": ["js"]})` works exactly as documented (backends, debug/release, not/and/or) — verified end-to-end.
5. Local path dependencies have NO new-DSL equivalent; official answer is moon.work workspaces. moon fmt migration of a path-dep module fails loudly (gracefully).
6. `moon fmt --block-style` (in older docs) no longer exists.
7. `-f` on moon test is `--filter` (test-name glob), not a file selector; files are selected positionally.
8. `moon test --doc` is deprecated; doctests run in plain `moon test`.
9. `moon publish --dry-run` is not offline — it contacts the registry after local validation.

## Most surprising behaviors

- `moon fmt` deletes moon.mod.json/moon.pkg.json and writes the DSL replacements (a formatter that migrates configs).
- Directories without moon.pkg are silently invisible — code there is never compiled and no diagnostic exists.
- Exit codes: check/build errors 255, failing tests 2, fmt --check diff 255.
- `-p` package selection matches by path segment (picks up nested packages too).
- Workspace member resolution ignores the declared dependency version (local member always wins; `moon work sync` re-aligns manifests).
- `moon test --patch-file` only works with `-p` selection and is silently ignored otherwise; with `-p` a nonexistent patch path crashes moonc (ICE banner, exit 1).
- `moon bench`: bench = `test "name" (b : @bench.T)` block; plain moon test skips it.
- LLVM target is listed in --target on stable but ICEs (nightly-only backend).
- moon add --bin writes options("bin-deps": {...}) which moon remove cannot remove.

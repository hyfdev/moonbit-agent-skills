# Workspaces and script mode

## Official toolchain topic map

Official headings routed here: Rule; Scripts; postadd script; \[Experimental\] Pre-build config script; Input; Output; Build variables; Rule and dev_build; Running `.mbtx` Scripts; Run a `.mbtx` file; Test a `.mbtx` script; Run a `.mbtx` script from stdin; Workspace Support; Initialize a workspace; Add members; Work at workspace root; Sync member versions.

Two ways to work outside a single published module: `moon.work` ties sibling modules together (the official replacement for local path dependencies), and `.mbtx` scripts run without any module at all. Both verified at the pin.

## moon.work format

```
members = [
  "./base",
  "./app",
]
```

That is the whole format: a `members` array of relative directory paths, each containing a module. Globs are **not** supported (`"./*"` fails with `failed to resolve workspace member`).

## Creating and maintaining a workspace

```sh
moon work init
moon work use base app
moon check
moon work sync
```

- `moon work init` creates `moon.work` with `members = []`; `moon work use <dirs...>` appends validated members.
- Validation is real: `moon work use` refuses a member whose moon.mod `import` block contains an unversioned entry — moon.mod imports must always be `name@version`, even for a sibling that only exists locally.
- A member declares its sibling like any registry dependency: `"mbtskills/base@0.2.0"` in moon.mod plus a normal moon.pkg import of the packages it uses.
- **Resolution rule (verified):** the local member always wins, and the *declared version is ignored* — a deliberate mismatch (app pins `@0.2.0`, base says `version = "0.9.0"`) builds silently, even when the module exists in no registry. The version string is cosmetic until publish time.
- `moon work sync` rewrites member manifests so declared versions match actual member versions (prints `Synced workspace manifests:` plus each rewritten file).

## Where to run commands

`moon check` / `moon test` / `moon build` at the workspace root operate across all members. Running inside a member directory also works and still resolves sibling members through the workspace:

```sh
moon -C app run cmd/main
```

The global `-C <DIR>` option must appear before the subcommand and makes later relative paths resolve from that directory. Use it instead of scripting a directory change; the old `--manifest-path` option no longer exists.

**Documented, not executed from a nested package:** the [0.10.4 release notes](https://www.moonbitlang.com/updates/2026/07/13/moonbit-0-10-4-release) say test and pre-build working directories are now the **module root**, even when the package is nested, and pre-build paths are relative to that root. Scripts that assumed the package directory as the current directory must be updated.

## Script mode: .mbtx

Outside any module, `moon run` executes throwaway code in a temporary project — a one-liner via `-e`, an `.mbtx` (or even bare `.mbt`) file, or stdin via `-`:

```sh
moon run -e 'fn main { println("hi") }'
moon run hello.mbtx
printf 'fn main { println("hi") }' | moon run -
```

Scripts can import packages through a front-matter `import { }` block at the top of the file. Core packages use plain paths; registry packages may pin a version **after the module name**: `user/module@version/package/path` (the trailing-`@version` spelling used in moon.mod is rejected here). Without a version, the script uses the latest version in the local registry index; pin versions for reproducible scripts.

```
import {
  "moonbitlang/core/json",
  "moonbitlang/x@0.4.46/stack",
}

fn main {
  let s : @stack.Stack[Int] = @stack.new()
  s.push(42)
  println(s.peek())
}
```

```sh
moon run pinned.mbtx
```

Verified: registry fetch happens automatically on first run (network needed), then `Some(42)` prints. Build state for scripts goes to a `_build/` directory next to the script.

### Import-all and script tests

An `.mbtx` import may end in `*`, optionally after `@alias`, to bring its definitions into scope. The alias remains usable:

```moonbit
import { "moonbitlang/core/queue" @q * }
fn main {
  let a = Queue([1, 2, 3])
  let b = @q.Queue([4, 5])
  println(a.length() + b.length())
}
```

```sh
moon run import-all.mbtx --deny-warn
moonx import-all.mbtx
moon run unpinned.mbtx --deny-warn
moon test script.mbtx --deny-warn
```

The import-all example prints `5` through both runners. `moonx` standalone scripts always use linear-memory Wasm. The unpinned-import probe imports `moonbitlang/x/stack` successfully without a version selector. Import-all is specific to scripts; regular package imports should keep aliases and use source-level `using` when needed.

**Test a `.mbtx` script:** pass its exact path to `moon test`. The script must define `fn main`, but tests do not execute it. A script path selects that script alone even inside a module, and a package-wide `moon test` ignores `.mbtx` files. A green package test run therefore does not verify nearby script tests. The command manifest proves this with a passing script next to a failing package test, then a failing script next to a passing package test.

### Experimental script policy

A script may restrict runtime access with a leading policy comment. The following header is verified to block a read of an existing local fixture through `moonbitlang/async`'s filesystem API when executed by `moonx`:

```text
// policy:
//   fs:
//     read: []
```

```sh
moonx policy.mbtx
```

The denial exits nonzero and identifies the blocked read. This is an experimental runtime policy, not a claim that arbitrary native code or every Wasm host interface is sandboxed. The executed `moon runwasm --help` limits policy enforcement to `moonbitlang/async` and moonrun-owned unstable FFI and explicitly excludes WASI.

**Documented, not executed — command prefixes:** execution policies can authorize child-process commands by command prefix. The matching configuration includes a program plus argument-prefix rules; end-to-end process authorization was not executed, because the verified script policy only exercises file access. Consult the [pinned release](https://github.com/moonbitlang/website/blob/b6d21ad70b1f2b61de640a8978d84b3315084711/updates/2026-09-21/index.md#moon-and-runtime) and [pinned process-policy implementation](https://github.com/moonbitlang/moon/blob/914d7da08562120ae4d9ef181cdda58c4ff0c191/crates/moonrun/src/policy/process.rs) before using this experimental shape.

**Documented, not executed — inherited policy:** policy restrictions can propagate across nested `moonx` calls. Nested process execution was not exercised in this verification, so do not infer inheritance behavior from the file-read probe alone. Source: [pinned release](https://github.com/moonbitlang/website/blob/b6d21ad70b1f2b61de640a8978d84b3315084711/updates/2026-09-21/index.md#moon-and-runtime) and [pinned inheritance implementation](https://github.com/moonbitlang/moon/blob/914d7da08562120ae4d9ef181cdda58c4ff0c191/crates/moonrun/src/policy/policy_inheritance.rs).

## Pre-build rules

moon.pkg can declare steps that run before `moon check` / `moon build` / `moon test`. Both forms below are verified working at the pin; `$input`/`$output` are placeholders, and commands starting with `:` are built-ins (`:embed` turns a file into a `.mbt` source declaring its contents as a `String`). The generated file lands in the *source tree* (commit or git-ignore it) and is regenerated by plain `moon check`.

Current DSL form — a named, reusable `rule()` applied by `dev_build()`:

```
rule(
  name: "embed_text",
  command: ":embed -i $input -o $output --name greeting_text",
)

dev_build(
  rule: "embed_text",
  input: "greeting.txt",
  output: "greeting.mbt",
)
```

Migrating a legacy `"pre-build"` JSON field instead produces `options("pre-build": [ { "input": ..., "output": ..., "command": ... } ])`, which also still works.

Security restriction (documented, not executed here): the official docs state that when a package is used as a dependency, its pre-build steps "are not triggered for security reasons, so dependencies do not execute arbitrary commands during builds" — https://docs.moonbitlang.com/en/latest/toolchain/moon/package.html.

**Documented, not executed for module hooks:** a module-level `rule(name: "...", command: "...")` is reusable from package-level `dev_build`; `options(scripts: { "postadd": "..." })` runs after the module is added with the module directory as its working directory. Source: [pinned module reference](https://github.com/moonbitlang/moonbit-docs/blob/8d9f3ba206eb17f80ee1836e4c1139068d1351b5/next/toolchain/moon/module.md#scripts).

### Experimental native pre-build config script

The separate module-level `options("--moonbit-unstable-prebuild": "hook.mbtx")` hook accepts a `.mbtx` script. It runs only for the native build target; this restriction does not apply to ordinary package `rule` / `dev_build` steps. The hook itself is compiled to Wasm and run with moonrun. It emits a build-configuration JSON object on stdout; an empty object is valid.

**Documented, not executed for other script extensions:** JavaScript (`.js`, `.cjs`, `.mjs`) and Python (`.py`) remain accepted by the [pinned dispatcher](https://github.com/moonbitlang/moon/blob/914d7da08562120ae4d9ef181cdda58c4ff0c191/crates/moon/src/rr_build/prebuild.rs); this probe executes only MoonBit hooks.

The hook receives these environment variables, all verified by the command manifest: `MOON_MOD`, `MOON_BUILD_DIR`, `MOON_HOST_OS`, `MOON_HOST_ARCH`, `MOON_BACKEND`, `MOON_PROFILE`, and `MOON_JOBS`. A native debug build reports `native` and `debug` respectively for backend and profile. Read the current environment instead of introducing a new dependency on stdin JSON.

**Documented, not executed — legacy prebuild stdin:** compatibility input is still written to stdin by the [pinned implementation](https://github.com/moonbitlang/moon/blob/914d7da08562120ae4d9ef181cdda58c4ff0c191/crates/moon/src/rr_build/prebuild.rs), but its removal is announced in the [pinned release](https://github.com/moonbitlang/website/blob/b6d21ad70b1f2b61de640a8978d84b3315084711/updates/2026-09-21/index.md#moon-and-runtime). The new hook probe reads only environment variables, so stdin compatibility is not an executed guarantee.

**Documented, not executed — prebuild input replacement:** migrate hooks that read build context from stdin to the environment variables above. Their values are executed evidence, but equivalence for a particular legacy hook's full JSON input is not established; compare that hook's required fields before migrating. Source: [pinned release](https://github.com/moonbitlang/website/blob/b6d21ad70b1f2b61de640a8978d84b3315084711/updates/2026-09-21/index.md#moon-and-runtime) and [pinned environment transport](https://github.com/moonbitlang/moon/blob/914d7da08562120ae4d9ef181cdda58c4ff0c191/crates/moon/src/rr_build/prebuild.rs).

Treat the config-script API as experimental and use it only for trusted projects; it executes program code during a build.

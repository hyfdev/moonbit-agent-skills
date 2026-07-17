# Project layout and configuration

Everything below was executed against the pinned toolchain (moon 0.1.20260713 / moonc v0.10.4). The current config format is the `moon.mod` / `moon.pkg` DSL; `moon.mod.json` / `moon.pkg.json` are the deprecated JSON predecessors, which still parse at the pin.

## Module and package model

- A **module** is a directory with a `moon.mod` file (or legacy `moon.mod.json`). It is the unit of versioning and publishing, named `user/name`.
- A **package** is any directory inside the module that contains a `moon.pkg` file. An empty zero-byte `moon.pkg` is enough — presence alone marks the directory as a package. Packages are the unit of compilation and import.
- The module root is itself a package when it has a `moon.pkg`; other packages import it by the bare module name (`"user/name"`). Subpackages are imported as `"user/name/sub/dir"`.
- **Trap — silent invisibility:** a directory *without* `moon.pkg` is not a package. Its `.mbt` files are never compiled, and no command emits any diagnostic about them (`moon check` stays green). When code seems ignored, check for a missing `moon.pkg` first.

## What `moon new` generates

```sh
moon new hello --user mbtskills
```

`--user` is required in non-interactive use. Output: a git repository (`git init` runs), `AGENTS.md`, `.githooks/`, a GitHub workflow under `.github/`, `.gitignore` (ignores `_build/`, `target/`, `.mooncakes/`), `LICENSE`, `README.mbt.md` plus a `README.md` symlink to it, a root library package (`hello.mbt`, `hello_test.mbt`, `hello_wbtest.mbt`, empty `moon.pkg`), and a `cmd/main` executable package. Only new-DSL config files are generated — no JSON anywhere.

## moon.mod

Generated form: bare `key = value` lines with snake_case keys.

```
name = "mbtskills/hello"
version = "0.1.0"
readme = "README.mbt.md"
repository = ""
license = "Apache-2.0"
keywords = []
preferred_target = "wasm-gc"
description = ""
```

Other verified top-level keys:

- `source = "src"` — packages then live under `src/`, but import paths do **not** include the prefix; `moon run` still takes the real directory path (`moon run src/cmd/main`, not `cmd/main`).
- `supported_targets = [ "js", "wasm-gc" ]` — an array at module level (see references/targets-and-conditional-builds.md).

Registry dependencies go in an `import { }` block; every entry must be pinned `name@version` (workspaces reject unversioned entries):

```
import {
  "moonbitlang/x@0.4.46",
}
```

**Duality — both spellings parse.** The generator emits top-level `preferred_target = "..."`; the official agent guide instead puts the same settings in an `options()` block, where plain keys are bare and kebab-case keys must be quoted:

```
options(
  source: "src",
  "preferred-target": "js",
)
```

`moon add --bin` writes a third entry kind, `options("bin-deps": { "moonbitlang/x": "0.4.46" })` — see references/dependencies-and-registry.md for the removal trap.

Local path dependencies have **no** new-DSL form at all. The legacy `"deps": {"m": {"path": "../other"}}` still works in `moon.mod.json`, but migration refuses it: use a `moon.work` workspace instead (references/workspaces-and-scripts.md).

## moon.pkg

Imports list package paths; an alias comes *after* the path with an `@` prefix and no colon. `for "test"` blocks are visible only in `*_test.mbt` files, `for "wbtest"` only in `*_wbtest.mbt`; using a test-only import from normal code fails with E4020 "Package ... not found in the loaded packages". (Blackbox tests auto-import the tested package — test syntax itself is the moonbit-language skill's territory.)

```
import {
  "mbtskills/hello" @lib,
  "mbtskills/hello/util",
}

import {
  "mbtskills/hello/testhelpers",
} for "test"

pkgtype(kind: "executable")
```

Executable packages: both `pkgtype(kind: "executable")` and `options("is-main": true)` are accepted at the pin, and `moon fmt` rewrites the options form **into** `pkgtype` — treat `pkgtype` as canonical. Valid kinds (from the error on an invalid kind): `library`, `executable`, `foreign_library`. Option keys inside `options()` are quoted kebab-case strings (`"is-main"`), unlike moon.mod's snake_case top-level keys.

## Legacy JSON → DSL mapping

| Legacy (`moon.mod.json` / `moon.pkg.json`) | Current DSL |
| --- | --- |
| `"deps": {"moonbitlang/x": "0.4.46"}` | `import { "moonbitlang/x@0.4.46", }` in moon.mod |
| `"deps": {"m": {"path": "../other"}}` | none — use a `moon.work` workspace |
| `"is-main": true` | `pkgtype(kind: "executable")` |
| `"import": [{"path": "u/m/p", "alias": "a"}]` | `import { "u/m/p" @a, }` |
| `"test-import": [...]` / `"wbtest-import": [...]` | `import { ... } for "test"` / `for "wbtest"` |
| `"targets": {...}` | `options(targets: { ... })` |
| `"link": {...}` | `options(link: { ... })` |
| `"native-stub": [...]` | `options("native-stub": [ ... ])` |
| `"supported-targets": [...]` | `supported_targets = [ ... ]` at either level (packages also accept the newer `"<expr>"` string form) |
| `"pre-build": [...]` | `options("pre-build": [ ... ])` |

## Migration behavior (verified)

```sh
moon check
moon fmt
```

- `moon check`, `moon build`, `moon run`, and `moon test` emit **zero** deprecation warnings for a legacy JSON module at the pin, even though the format is documented as deprecated. Do not expect the tools to nag you into migrating.
- `moon fmt` **is** the migration tool: inside a legacy module it converts `moon.mod.json` → `moon.mod` and every `moon.pkg.json` → `moon.pkg`, printing `Warning: Migrating to moon.mod ... deprecated moon.mod.json is removed.` per file. **It deletes the JSON originals** — commit or back up before running it.
- Migration output is not always fmt-clean in one pass (e.g. a missing trailing newline), so the next `moon fmt --check` can still report a diff.
- A legacy module with a path dependency fails migration loudly and gracefully: `moon fmt` errors, nothing is deleted, and the module keeps working on JSON.
- Feeding a legacy config through `moon fmt` is the fastest way to learn a working DSL spelling of any field — most of the mapping table above was produced that way (migration output can lag the newest syntax, e.g. it emits the array form of package-level `supported_targets`, not the string-expression form).

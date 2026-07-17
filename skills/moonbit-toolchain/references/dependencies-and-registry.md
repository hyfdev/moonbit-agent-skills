# Dependencies and the mooncakes registry

Dependency commands need network access (they talk to mooncakes.io); everything in the first sections was executed at the pin. Registry-account operations at the end are **described, not executed** — they change remote state (the one exception: a single `moon publish --dry-run` probe was run once during verification and aborted at the registry's authorization check; nothing was published).

## Adding, removing, inspecting

```sh
moon update
moon add moonbitlang/x
moon add moonbitlang/x@0.4.46
moon tree
moon remove moonbitlang/x
```

- `moon update` refreshes the local registry index (`Registry index updated successfully`).
- `moon add name` picks the latest version; `moon add name@version` pins. Either way the resolved pin is written into moon.mod's `import { }` block as `"moonbitlang/x@0.4.46"`. `-u/--upgrade` bumps an existing entry. Sources are vendored into `.mooncakes/` at the module root.
- Adding the module dependency is only half the job: to call code you must also import a concrete package (e.g. `"moonbitlang/x/uuid"`) in the consuming package's moon.pkg.
- `moon tree` prints an ASCII dependency tree (`└─ moonbitlang/x -> moonbitlang/x@0.4.46`).
- `moon remove name` deletes the moon.mod entry. Removing a dependency some moon.pkg still imports fails at the next resolution with `Cannot find import 'moonbitlang/x/uuid' in ...`.
- **Old pins can stop compiling:** registry dependencies are recompiled from source with your current compiler. Verified: `moonbitlang/x@0.4.6` no longer builds under moonc v0.10.4 (type errors inside `.mooncakes/` sources). Prefer recent versions; a broken build inside `.mooncakes/` means the pinned version predates your compiler.

## Version pinning rules

moon.mod `import` entries must be `name@version` — the DSL rejects unversioned entries when the module participates in a workspace, and there is **no** local-path form. Local development against a sibling module is `moon.work`'s job (references/workspaces-and-scripts.md); the legacy JSON `"path"` deps cannot be migrated.

## The --bin trap

```sh
moon add --bin moonbitlang/x
```

Records a *binary* dependency as `options("bin-deps": { "moonbitlang/x": "0.4.46" })` in moon.mod instead of the import block. Verified trap: **`moon remove` cannot undo it** — it fails with `` Error: the dependency `moonbitlang/x` could not be found `` — you must edit moon.mod by hand. (The rewrite may also print a one-time spurious `ambiguous_braces` warning against moon.mod; it disappears on the next run.)

## Installing binaries globally

```sh
moon install username/module
```

Installs a tool binary globally (source may be a registry name, local path, or git URL per `--help`). Not executed by this repository's CI — it writes outside the project. Bare `moon install` (no args) is deprecated and only prints a pointer to `moon install <package>` / `moon build`.

## Packaging

```sh
moon package
moon package --list
```

Runs `moon check`, then zips the module to `_build/publish/<user>-<mod>-<version>.zip`; `--list` prints the archive contents. Verified: the archive includes `*_test.mbt` files, all configs, `pkg.generated.mbti`, LICENSE and README — test files are **not** stripped from what you publish. Empty `readme`/`repository`/`license` fields produce warnings (not fatal).

## Registry accounts and publishing — never run these unprompted

These commands change account or remote state; this repository's CI never executes them. `register`, `login`, and plain `publish` are described from `--help` and docs only. The one exception: `moon publish --dry-run` was executed **once, manually**, during pin verification — deliberately against a module whose `user/` prefix did not match the logged-in account, so the server rejected it and nothing was published; that probe is the evidence for the warning below.

```sh
moon register
moon login
moon publish
moon publish --dry-run
```

- `moon register` opens account creation for mooncakes.io; `moon login` stores credentials under the moon home; `moon whoami` (safe, local) prints login status.
- `moon publish` re-validates from scratch: metadata warnings → `moon check` → zip → extract to `_build/publish/verify/` → re-check the extracted copy → upload. The re-check of the extracted zip catches packaging mistakes.
- **`--dry-run` is not offline** (proved by the manual probe above): after the local pipeline it still authenticates against the registry server — the probe ended with `Server status: 403 Forbidden ... User mismatch`. Do not run it expecting a purely local check; for a local-only validation use `moon package`.

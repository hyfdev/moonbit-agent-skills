# Dependencies and the mooncakes registry

## Official toolchain topic map

Official headings routed here: `moon add`; `moon remove`; `moon install`; `moon tree`; `moon login`; `moon register`; `moon publish`; `moon package`; `moon update`; Use and publish packages; Setup mooncakes.io account; Setup MoonBit project; Add dependencies; Import packages from module; Remove dependencies; Publish your module; Semantic versioning convention; Readme & metadata; Publishing Files with `.moonignore`; Deprecated `include` and `exclude` fields.

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

## Registry search and metadata

```sh
moon search 'html markdown' --limit 1 --json
moon view moonbitlang/async@0.21.3 --json
moon view moonbitlang/async --versions --json
moon view --help
```

Search and metadata queries are read-only registry requests and work outside a project. `moon search` matches module and package summaries; `--limit` bounds the result count and `--json` returns structured results. `moon view module@version` reports an exact release; `--versions` lists published releases, including deprecated ones. The executed help also documents public user-profile lookup through `moon view username` and the saved-login shortcut `moon view --my`; those two account-selection forms were not executed.

```sh
moon tree --json
moon tree --package
moon tree --package --json
```

The default `moon tree` graph has modules as nodes. `--package` switches to package imports, and its JSON graph records import aliases and kinds. These two JSON shapes differ; do not treat module IDs and package IDs as interchangeable.

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

## Running registry tools without installing

```sh
moonx --help
moon runwasm --help
```

Use `moonx user/module/package[@version|@latest]` for registry executables. An explicit version is pinned, `@latest` refreshes the registry index before resolving, and an unpinned coordinate uses the latest version already known locally. These registry-resolution forms are verified from the executed `moonx --help`; CI does not execute a registry package. Local `.mbtx` inputs are exercised in references/workspaces-and-scripts.md.

**Documented, not executed — deprecated moonx native form:** `moonx --target native user/module/package` is deprecated. A registry executable was not fetched and run under native during verification; use the [pinned release announcement](https://github.com/moonbitlang/website/blob/b6d21ad70b1f2b61de640a8978d84b3315084711/updates/2026-09-21/index.md#moon-and-runtime) and current `moonx --help` to recognize an old invocation.

**Documented, not executed — moonx native replacement:** remove `--target native` and use `moonx user/module/package`, which selects Wasm by default. Registry executable compatibility with Wasm was not tested; check the selected executable before migrating it. Source: [pinned release announcement](https://github.com/moonbitlang/website/blob/b6d21ad70b1f2b61de640a8978d84b3315084711/updates/2026-09-21/index.md#moon-and-runtime).

**Deprecated runwasm form:** `moon runwasm cmd/main` still runs a local package but emits an explicit deprecation warning. The command manifest verifies the old command and its output without publishing or fetching a registry executable.

**Runwasm replacement:** use `moon run --target wasm cmd/main` for a local package. Both commands print the same program result in verification. For registry executables, use `moonx` as described above; `moon runwasm` should no longer be recommended for new commands.

## Packaging

```sh
moon package
moon package --list
```

Runs `moon check`, then zips the module to `_build/publish/<user>-<mod>-<version>.zip`; `--list` prints the archive contents. Verified: the archive includes `*_test.mbt` files, all configs, `pkg.generated.mbti`, LICENSE and README — test files are **not** stripped from what you publish. Empty `readme`/`repository`/`license` fields produce warnings (not fatal).

## Publishing Files with `.moonignore`

Use a `.moonignore` next to `moon.mod` to define publishing exclusions with gitignore-style patterns:

```text
build/
*.log
!fixtures/expected.log
!/.well-known/
!/.well-known/**
```

Verified packaging rules:

- In each directory, `.moonignore` replaces that directory's `.gitignore`; they are not merged. Without `.moonignore`, its `.gitignore` applies. Parent-directory rules remain inherited, and later nested rules can restore matching files with `!` while their parent directory is visible.
- Dot-prefixed files and directories are excluded at every depth by default. Restore a hidden directory and its contents with separate rules, as in the `.well-known` example.
- The module-root `_build/` is always excluded, even with explicit `!` rules. A nested directory such as `examples/_build/` does not receive that fixed exclusion.
- **Documented, not executed for Git tracking and external ignore configuration:** filtering uses project ignore files even for tracked files; Git's `.git/info/exclude` and a user's global Git ignore setting are not consulted, per the [pinned packaging reference](https://github.com/moonbitlang/moonbit-docs/blob/8d9f3ba206eb17f80ee1836e4c1139068d1351b5/next/toolchain/moon/module.md#publishing-files-with-moonignore); the fixture does not initialize a Git repository or modify global Git configuration.
- Inspect the resulting archive with `moon package --list` before publishing.

### Deprecated `include` and `exclude` fields

**Deprecated publishing form:** legacy `options(include: [...], exclude: [...])` emits a build-system deprecation warning. An `include` field is an exhaustive allowlist: it bypasses `exclude`, project ignore files, and default dotfile filtering, while still excluding root `_build/`. This warning remains non-fatal under `moon check --deny-warn`, so warnings-denied compiler checks do not enforce this migration.

**Publishing replacement:** remove both manifest fields and put the complete policy in `.moonignore`. The command manifest exercises the old form with `--deny-warn`, asserts its deprecation warning, then checks the replacement under the same flag and verifies archive inclusions and exclusions. Do not leave a legacy `include` field in place and expect new ignore rules to take effect.

**Documented, not executed — registry name collisions:** mooncakes.io no longer accepts a newly published module whose name differs only by letter case from an existing name. Choose a distinct name instead of changing capitalization. This server-side rejection is not executed because proving it would require publishing account state. Source: [pinned August release](https://github.com/moonbitlang/website/blob/b6d21ad70b1f2b61de640a8978d84b3315084711/updates/2026-08-19/index.md#toolchain-updates).

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

## Deprecating published modules

```sh
moon deprecate --help
```

**Documented, not executed — moon deprecate:** `moon deprecate user/module --reason "reason"` deprecates all existing versions; `--undo` clears their deprecation. A version selector is not accepted, and later published versions start undeprecated. This command changes registry state and requires publishing credentials, so only its help was executed. Deprecation does not change dependency version selection; resolution reports warnings using the local registry index. Source: [pinned September release](https://github.com/moonbitlang/website/blob/b6d21ad70b1f2b61de640a8978d84b3315084711/updates/2026-09-21/index.md#moon-and-runtime) and the executed command help.

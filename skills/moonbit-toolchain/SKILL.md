---
name: moonbit-toolchain
description: Verified operation of the MoonBit toolchain, pinned to exact moon and moonrun versions - creating modules and packages, moon.mod and moon.pkg configuration (plus legacy moon.mod.json / moon.pkg.json), dependencies and mooncakes packages, moon check, build, run, test, fmt, info, doc, coverage, bench, test filtering and snapshot updates, targets (wasm, wasm-gc, js, native), conditional builds, linking, native stubs, workspaces, publishing, and moon ide API queries. Use when running or explaining moon or moonrun commands, editing moon.mod, moon.pkg, or moon.work files, scaffolding MoonBit modules or packages, adding dependencies, configuring targets or CI, or debugging MoonBit build, test, or dependency-resolution failures. Project operation only - for MoonBit syntax and language semantics use moonbit-language; load both for tasks that change code and configuration together.
license: MIT
user-invocable: false
compatibility: Verified only against moon 0.1.20260713 and moonrun 0.1.20260713 (MoonBit v0.10.4, 2026-07-13), Linux x86_64. Network needed for dependency and registry operations; Node.js 24+ runs the bundled environment-report helper.
metadata:
  skill-version: "0.3.1"
  updated-date: "2026-07-19"
  moon-version: "0.1.20260713"
  moonrun-version: "0.1.20260713"
  moonbit-release: "0.10.4"
  verified-date: "2026-07-18"
  verified-platform: "Linux-x86_64"
  verified-targets: "wasm-gc,wasm,js,native"
  source-docs: "https://docs.moonbitlang.com/en/latest/toolchain/ (MoonBit v0.10.4 documentation)"
---

# MoonBit toolchain

## Verification contract

Every command and configuration shape in this skill was executed for real against **moon 0.1.20260713 / moonrun 0.1.20260713** (MoonBit release 0.10.4, build 2026-07-13) on **2026-07-18**, Linux x86_64, exercising targets wasm-gc, wasm, js, native. MoonBit ships install channels (latest, nightly, pre-release), not pinned historical versions, so local installs drift forward automatically.

**Before relying on this skill, run `moon version --all`** (or `node scripts/env_report.ts`, which also checks native-backend prerequisites). If versions differ from the pin:

1. Prefer `moon help <subcommand>` and `moon <subcommand> --help` output over this skill for exact flags.
2. Re-run any load-bearing command in a scratch module (`moon new probe --user tmp`) before promising its behavior.
3. Check https://www.moonbitlang.com/updates/ for toolchain changes since 0.10.4.
4. State the version difference in your answer.

## Non-negotiable working rules

- **Run commands, don't recall them.** Flags and defaults changed repeatedly (build dir is `_build` now, not `target`; `moon ide` exists; `moon explain` exists). If you cannot execute, quote `--help` output or mark the answer unverified.
- **Config formats are mid-migration.** The current formats are the non-JSON `moon.mod` / `moon.pkg` DSL; `moon.mod.json` / `moon.pkg.json` are deprecated in v0.10.4 and scheduled for removal. Both still parse at the pin. Never create new JSON configs; never mix advice between the two formats without labeling which is which. See references/project-layout-and-config.md.
- **Don't guess package or API availability.** Use `moon ide doc '<query>'` for installed APIs and the mooncakes registry for packages; a familiar name from npm/crates is not evidence a MoonBit package exists.
- **Prefer the narrowest verifying command** and show it: `moon check` after config edits, targeted `moon test <path>` for test questions, `moon info` to prove API-surface claims.
- **Never run destructive or account-level commands unprompted**: `moon publish`, `moon register`, `moon login`, `moon upgrade` change global or remote state — describe them instead, and only run them on explicit request.

- **If a command or config contradicts this skill, complete the reporting protocol before the final response rather than merely mentioning the mismatch.** Rebuild it in a scratch module with generic names, prepare a privacy-scrubbed public issue draft, show the user its exact title and body, and provide the issue-template link. Stop there: never submit the issue or invoke GitHub from this skill workflow, even if the user gave blanket or draft-specific permission. A later request for the host agent to send it is a separate outbound action governed by that client's own approval controls. Never edit the installed skill copy or write the draft into the user's repository. Exact protocol: references/reporting-errors.md

## Feature index

Load only what the task needs:

- Module/package layout and Internal Packages; `moon.mod` / `moon.pkg`; deprecated `moon.mod.json` / `moon.pkg.json`; `source`; formatter; `pkgtype`; `#export_name`; virtual packages with `options("virtual")`, `implement`, and `overrides` → references/project-layout-and-config.md
- Everyday `moon new`, `check`, `build`, `run`, `test`, `fmt`, `info`, `doc`, and `clean`; executed-program exit code → references/commands.md
- Test path filtering, snapshots, doc tests, coverage, `moon bench PATH`, and raw benchmark statistics → references/testing-workflows.md
- Dependencies, mooncakes registry, publishing, and packaging → references/dependencies-and-registry.md
- Target selection; `preferred-target`; supported targets; native platform matrix; conditional builds; link options; native stubs → references/targets-and-conditional-builds.md
- Semantic code queries including peek-def, outline, doc search, hover, references, and rename → references/moon-ide.md
- `moon.work` workspaces, `.mbtx` script mode, module-root test and pre-build execution, and pre-build paths → references/workspaces-and-scripts.md
- Build, test, and dependency diagnostics; `moon explain`; warning lists and `--deny-warn` → references/diagnostics-and-recovery.md

Every `moon ...` command line shown in these references is executed against the pinned toolchain by the source repository's CI — the examples are guaranteed to have run, not just to look plausible.
- Toolchain contradicts this skill; minimal reproduction and issue draft → references/reporting-errors.md

## Boundary

This skill owns project operation: configuration files, commands, dependencies, targets, publishing, CI. What MoonBit code means — types, pattern matching, traits, error semantics, FFI declaration syntax — is the moonbit-language skill. For tasks that span both (a new package including its code, FFI declarations plus link configuration, repos broken in both code and config), load both skills.

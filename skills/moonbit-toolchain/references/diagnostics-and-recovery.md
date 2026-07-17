# Diagnostics and recovery

How to read what moon tells you, and what the common failures actually look like at the pin (all messages below are verbatim from real runs).

## Reading diagnostics

```sh
moon check
moon check --no-render
moon check --output-json
```

Default rendering is an error code in brackets plus an ASCII source span:

```
Error: [4020]
   ╭─[ misuse.mbt:3:3 ]
   │
 3 │   @util.helper_tag()
   │   ────────┬───────
   │           ╰───────── Package "util" not found in the loaded packages.
───╯
Failed with 0 warnings, 1 errors.
Error: failed when checking project
```

- `--no-render` gives compact one-liners: `path:2:4-2:17 [E0001] Warning (unused_value): Unused function 'unused_helper'` (a diagnostic can appear twice — once per check flavor of the same file, e.g. package + blackbox test).
- `--output-json` emits one JSON object per diagnostic on stdout: `$message_type`, `level`, `error_code` (number), `path`, `loc` (`"2:4-2:17"`), `message`, `context`. The trailing `Finished...` summary stays plain text.
- `--diagnostic-limit <N>` caps rendered diagnostics; `moon check --explain` renders full error-code explainers inline.

## Explaining codes and attributes offline

```sh
moon explain --diagnostic 4020
moon explain --attribute deprecated
```

Prints a markdown explainer (erroneous example plus fix) for any error code or attribute — works offline; handy before searching the web.

## Warnings: promote, enable, select

```sh
moon check --deny-warn
moon check --warn-list +unnecessary_annotation
```

- `--deny-warn` (also `-d`) turns warnings into errors: exit flips from 0 to 255 and labels become `Error Warning (unused_value): ...`.
- `--warn-list` takes `+name` or `+id` (verified: `+unnecessary_annotation` and `+73` both enable warning 0073). Names come from the parenthesized label in any rendered warning.
- These flags exist on check/build/test/run alike.

## Common failures, verbatim

| Symptom | Message / behavior | Exit |
| --- | --- | --- |
| Compile/check error | rendered diagnostic + `Error: failed when checking project` | 255 |
| Directory missing `moon.pkg` | **nothing** — files silently not compiled, check stays green | 0 |
| Unknown module in an import | `Cannot find import 'someuser/notreal/pkg' in mbtskills/template/textutil@0.1.0` | 255 |
| Import cycle (also self-import) | `Import loop detected: mbtskills/template -> mbtskills/template/textutil -> mbtskills/template` | 255 |
| Removed dep still imported | `Failed to solve package relationship` + `Cannot find import ...` | 255 |
| `moon run` on a library | `` Error: `textutil` is not a main package `` | 255 |
| Malformed moon.pkg | `Unable to read moon.pkg ... Parsing error: UnexpectedToken(STRING((Pos { line: 2, column: 3 }..., "is-main")))` — a raw parser dump, not a rendered diagnostic | 255 |
| Failing tests | per-test diff + `Total tests: N, passed: X, failed: Y.` | 2 |
| No tests found | `Warning: no test entry found.` | 0 |
| Unsupported target (module-level `supported_targets`) | `Finished. moon: no work to do` — silent skip | 0 |

The first two rows are the sharpest traps: a missing `moon.pkg` produces no diagnostic anywhere, and test failures (2) exit differently from build failures (255) — scripts checking `== 1` catch neither.

## Build-state hygiene and offline work

```sh
moon clean
moon check --frozen
```

- `moon clean` deletes the whole `_build/` directory — the first move when build state seems stale or corrupted (cheap: everything regenerates).
- `--frozen` (on check/build/test/run) skips dependency syncing — use it offline or to prove a failure is not registry-related. `--target-dir <dir>` redirects build state elsewhere.
- The registry cache and credentials live under the moon home (`MOON_HOME` redirects the registry side; the compiler/core location is governed separately, e.g. `MOON_CORE_OVERRIDE`).

## When behavior contradicts this skill

```sh
moon version --all --json
```

Check the versions first — this skill is verified only at moon 0.1.20260713 / moonc v0.10.4 (`moon version --all` also prints `Feature flags enabled: rr_moon_mod,rr_moon_pkg`). On a different version, trust `moon <cmd> --help` over any reference file, re-verify load-bearing behavior in a scratch module (`moon new probe --user tmp`), and say so in your answer. `moon upgrade` moves the installed toolchain forward (never run it unprompted — it changes global state).

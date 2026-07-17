# Testing workflows

A test is a `test "name" { ... }` block; write assertions with `assert_eq` / `inspect` — syntax details live in the moonbit-language skill. This file is about *running* tests. Examples use the verification template (root package plus a `textutil` subpackage whose test is named "shout uppercases").

## Selecting what runs

```sh
moon test
moon test textutil
moon test textutil/shout_test.mbt -i 0
moon test -p textutil
moon test -p mbtskills/template/textutil
moon test --filter 'shout*'
moon test --outline
```

- Positional argument = a package **directory path** or a single file. Files are only selectable positionally.
- `-p/--package` matches by path **segment**: `-p liba` selects `liba` *and* a nested `liba/libb`. Only the full package name (`-p user/mod/liba`) is exact. Positional `liba` selects just that directory.
- `-i/--index N` picks one test by index within a single file; a range `0-2` runs indices 0 and 1 (right-exclusive). `-i` implies `--include-skipped`.
- **Trap:** `-f` is `--filter`, a glob on the test **name** — it is *not* a file selector (files go positionally). `-F` is an undocumented alias.
- `moon test --outline` lists every test (package, file:line, index, name) without running anything — the fastest way to find names and indices.

## Failures, exit codes, machine output

```sh
moon test --test-failure-json
```

Failing tests exit **2** (compile errors exit 255 — different code). `--test-failure-json` prints one JSON object per failure: `package`, `filename`, `index` (a JSON *string*), `test_name`, `message`.

## Snapshot updates

```sh
moon test -u
```

An `inspect(expr)` without `content=` fails with a diff; `-u/--update` rewrites the source in place, using multiline-string form even for one line: `inspect(x, content=(#|3\n  ))`. `-l/--limit` caps update passes (default 256) — it is an anti-infinite-loop bound, not a test-count limit.

## Doctests

```sh
moon test textutil/twice.mbt --doc-index 0
```

` ```mbt check ` blocks inside `///` doc comments compile and run as blackbox tests in plain `moon test` (shown as `file.mbt:LINE (#0)`); inside them, refer to the containing package as `@<pkgname>`. `--doc-index N` picks the N-th doctest of a single file. `moon test --doc` still runs but only prints a deprecation warning — doctests are part of plain `moon test` now.

## Virtual test files: --patch-file

```sh
moon test -p mbtskills/template/textutil --patch-file patch.json
```

Schema: `{"drops": ["file.mbt"], "patches": [{"name": "injected_test.mbt", "content": "<source>"}]}` — injects test files that never touch disk. Verified sharp edges:

- Works **only with `-p` selection**. With a positional path the flag is silently ignored (even a nonexistent patch path passes).
- With `-p`, a nonexistent patch path crashes the compiler (internal-compiler-error banner, exit 1).
- `"drops"` did not actually remove the named file in verification; diagnostics inside patched files can point at the on-disk file's source lines. Treat patching as good for *adding* tests, unreliable beyond that.

## Coverage

```sh
moon coverage analyze
```

One command: instruments, runs the tests, and prints annotated uncovered lines directly (`<-- UNCOVERED`). The two-step form gives report formats instead:

```sh
moon test --enable-coverage
moon coverage report -f summary
moon coverage clean
```

`--enable-coverage` drops `moonbit_coverage_*.txt` trace files under `_build/`; `moon coverage report` (a wrapper over `moon_cove_report`) then aggregates them. Formats: `bisect` (default), `caret`, `coveralls` (JSON), `cobertura` (XML), `html`, `summary` (`file: covered/total` lines). `-p <package>` / `-F <file>` scope the output; `--send-to coveralls|codecov` uploads (not executed here). `moon coverage clean` removes the trace files.

## Benchmarks

A benchmark is a `test` block that takes a bench parameter; plain `moon test` **skips** these blocks entirely (they are not counted as tests).

```
// textutil/moon.pkg — @bench comes from core, imported for test files only:
import {
  "moonbitlang/core/bench",
} for "test"
```

```
///|
test "bench shout" (b : @bench.T) {
  b.bench(fn() {
    b.keep(@textutil.shout("moon"))   // b.keep prevents dead-code elimination
  })
}
```

```sh
moon bench textutil
```

Output reports `time (mean ± σ)` and `range (min … max)` per bench block. `moon bench` shares `moon test`'s selection flags (positional path, `--target`, `--release`). Omitting the core/bench import still works at the pin but emits a `core_package_not_imported` deprecation warning.

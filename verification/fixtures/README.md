# Verification fixtures

Each fixture is one directory holding a minimal piece of MoonBit knowledge that cannot be expressed as a checked `.mbt.md` example — mostly *negative* knowledge: code that the current compiler must reject, or accept with a specific behavior that contradicts habits from other languages.

Positive, self-contained language examples do **not** live here. They live inside `skills/moonbit-language/references/*.mbt.md` as `mbt check` fences and are executed directly by `tooling/run_checked_docs.ts`, so the documentation itself is the test.

## Layout

```
verification/fixtures/<fixture-id>/
  fixture.json   # metadata + expectation (schema below)
  code.mbt       # the code under test (self-contained, core stdlib only)
  fixed.mbt      # optional: corrected version that must pass (for *-fail fixtures)
  module/        # alternative to code.mbt: a complete multi-package module,
                 # for knowledge that needs more than one package (e.g.
                 # cross-package visibility); copied wholesale by the runner
```

## fixture.json schema

| Field | Meaning |
| --- | --- |
| `id` | Directory name. Convention: `<skill>-<kind>-<topic>`, e.g. `lang-neg-rust-match-arrow`. |
| `owner_skill` | `moonbit-language` or `moonbit-toolchain`. |
| `knowledge` | The single fact this fixture proves, one sentence. |
| `habit_from` | For negative fixtures: `rust`, `typescript`, `go`, or `stale-moonbit`. Omit otherwise. |
| `expect` | `check-fail` (moon check must fail), `check-pass`, `test-pass` (moon test must pass), or `semantic-trap` (compiles, but behaves unlike the foreign-language expectation; proven by a passing test). |
| `diagnostic_contains` | For `check-fail`: substring(s) that must appear in the compiler output. |
| `fix` | One-line statement of the correct MoonBit way. |
| `targets` | Targets the runner exercises for this fixture (default `["wasm-gc"]`). |
| `source` | Where the knowledge comes from: `observed` (toolchain behavior), plus optional documentation URL. |
| `verified` | Stamped by `vp run run-fixtures -- --stamp`: exact component versions, platform, and date of the last passing run. Never hand-edited. |

## Running

```sh
vp run run-fixtures                                                   # run all fixtures, exit non-zero on any mismatch
vp run run-fixtures -- --stamp --date YYYY-MM-DD                     # additionally record passing runs in fixture.json
vp run run-fixtures -- lang-neg-rust-match-arrow                     # run a subset
```

The runner materializes each fixture into a throwaway module under the system temp directory (`moon.mod` + `moon.pkg` + the fixture code, or a copy of `module/`), so fixtures stay tiny and never share state.

# Tests, snapshots, doc tests, and literate `.mbt.md`

Every `mbt check` block in this file is compiled and run by the repository's verification suite (`tooling/run_checked_docs.ts`). Blocks marked `mbt nocheck` show rejected or deprecated forms and are never compiled. This file is itself a literate `.mbt.md` document — the last section explains what that means.

## Official topic map

Search these exact official documentation topic names to route a question into this reference. A listed name is a discoverability route; the verification labels in the surrounding reference still determine whether its claim was executed or is documentation-only.

- Top-level test syntax: `test`
- Tests and snapshots: Writing Tests; Test Blocks; Snapshot Tests; Snapshotting `Show`; Snapshotting `JSON`; Snapshotting Anything; BlackBox Tests and WhiteBox Tests
- Literate checked documentation: Literate `.mbt.md` Files

## Test blocks and assertions

A test is `test "name" { ... }`; the name is optional, so a bare `test { ... }` is valid too. The built-in assertions are `assert_eq`, `assert_not_eq`, `assert_true`, `assert_false`, and `fail("msg")`. Every assertion **raises** on failure, so test bodies are allowed to raise — no `raise` annotation is needed on a `test` block.

```mbt check
test "tst assertions" {
  assert_eq(2 + 2, 4)
  assert_not_eq(1, 2)
  assert_true(1 < 2)
  assert_false(2 < 1)
}

test {
  assert_eq(1 + 1, 2) // unnamed test block
}
```

## Snapshot tests: `inspect`, `debug_inspect`, `json_inspect`

Snapshot functions capture a value against an expected `content=`. `inspect` needs `Show`, `debug_inspect` needs derived `Debug`, and `json_inspect` needs `ToJson` (its `content=` is a JSON literal, not a string). Running with the `--update` flag fills in or rewrites every `content=` in place from the actual value — that flag is part of the `moon` CLI, so it belongs to the **moonbit-toolchain** skill. The workflow is: write the call with no `content=`, run the update command, and review the diff.

```mbt check
priv struct TstP {
  x : Int
  y : String
} derive(Debug, ToJson)

test "tst snapshots" {
  inspect(1 + 2, content="3")
  inspect("hello", content="hello")
  debug_inspect(TstP::{ x: 1, y: "hi" }, content="{ x: 1, y: \"hi\" }")
  json_inspect(TstP::{ x: 1, y: "hi" }, content={ "x": 1, "y": "hi" })
}
```

## Tests that raise

Because assertions raise, a test can call fallible functions directly and let a real failure abort the test. To assert that a specific call *does* raise, catch it and put the failure signal in the `noraise` arm.

```mbt check
fn tst_may(x : Int) -> Int raise Failure {
  if x < 0 {
    fail("neg")
  }
  x
}

test "tst asserting a raise happened" {
  assert_eq(tst_may(3), 3)
  try tst_may(-1) catch {
    Failure(_) => inspect("caught", content="caught")
  } noraise {
    _ => fail("expected raise")
  }
}
```

## Whitebox vs blackbox test files

Test file names pick the visibility mode; this split spans separate files inside a real package, so it cannot run inside a single checked doc — the shapes below are the verified facts (runnable proof lives in the repository's package fixtures, not in this one-package document):

- `*_wbtest.mbt` (**whitebox**) compiles *inside* the package and can call private symbols with no prefix.
- `*_test.mbt` (**blackbox**) sees only the public API and refers to the tested package as `@<pkgname>` — auto-imported, no `moon.pkg` entry needed. Reaching a private symbol from a blackbox file is Error [4021].

```mbt nocheck
// lib.mbt in package `probeuser/probe`
fn secret_double(x : Int) -> Int { x * 2 } // private
pub fn public_triple(x : Int) -> Int { x * 3 }

// probe_wbtest.mbt — whitebox: private symbol, no prefix
test { assert_eq(secret_double(4), 8) }

// probe_test.mbt — blackbox: public API via @probe
test { assert_eq(@probe.public_triple(5), 15) }
// secret_double(4)  // WRONG: Error [4021] — private symbol invisible to blackbox
```

## Docstring doc tests

A ```` ```mbt check ```` fence inside a `///` doc comment is a doc test: plain `moon test` compiles and runs it (there is no separate `--doc` flag), and `--update` rewrites its `content=` in place inside the comment. Doc tests run in **blackbox** mode, so the documented symbol must be `pub`. The example below is a live doc test on `tst_triple` — it counts as one of this file's tests. (The outer fence uses four backticks so the inner three-backtick fence nests cleanly.)

````mbt check
///|
/// Triple the input.
///
/// ```mbt check
/// test {
///   inspect(tst_triple(3), content="9")
/// }
/// ```
pub fn tst_triple(x : Int) -> Int {
  x * 3
}
````

## Literate `.mbt.md` files and fence semantics

A `.mbt.md` file is executable documentation: `moon check` / `moon test` treat it as a blackbox test file in its package and act on its fenced code blocks. The fence tag decides what happens:

| Fence | Meaning |
| --- | --- |
| ```` ```mbt ```` | compiled into the package, but no test is run from it |
| ```` ```mbt check ```` | compiled **and** run — a real test; snapshots update with `--update` |
| ```` ```mbt nocheck ```` | display only — never compiled (use it for rejected/deprecated forms) |
| ```` ```moonbit ```` | display only — never compiled |

Because `mbt` and `mbt check` blocks are really compiled, a deliberately-broken example must be `mbt nocheck` (or live in a fixture); it can never sit in an `mbt`/`mbt check` fence.

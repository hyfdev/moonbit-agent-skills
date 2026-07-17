# Probe p2 findings: error handling, async, tests, FFI declarations, attributes

Toolchain: moon 0.1.20260713, moonc v0.10.4+ade96c819, moonrun 0.1.20260713 (macOS arm64). Default target wasm-gc unless noted.

### err-declare-suberror
- conclusion: Error types are declared with `suberror` — bare (`suberror EmptyErr`), or enum-style with constructors incl. labeled payloads (`suberror ParseErr { BadChar(Char, pos~ : Int) BadEof }`); the old one-line payload form `suberror MsgErr String` still compiles but warns deprecated_syntax ("Use `suberror E { E(T) }` instead").
- example:
```
///|
suberror EmptyErr

///|
suberror ParseErr {
  BadChar(Char, pos~ : Int)
  BadEof
} derive(Debug)

///|
fn f_empty() -> Int raise EmptyErr {
  raise EmptyErr
}

///|
fn f_parse(s : String) -> Int raise ParseErr {
  if s == "" {
    raise ParseErr::BadEof
  }
  raise ParseErr::BadChar('x', pos=3)
}

///|
test "raise and catch each form" {
  try f_empty() catch {
    EmptyErr => inspect("caught empty", content="caught empty")
  } noraise {
    _ => fail("expected raise")
  }
  try f_parse("a") catch {
    ParseErr::BadChar(c, pos~) => {
      inspect(c, content="x")
      inspect(pos, content="3")
    }
    ParseErr::BadEof => fail("wrong ctor")
  } noraise {
    _ => fail("expected raise")
  }
}
```
- command: moon test t.mbt (wasm-gc)
- result: pass — "Total tests: 1, passed: 1, failed: 0." plus Warning (deprecated_syntax) on `suberror MsgErr String`
- notes: Signature form is `fn f(...) -> T raise E`. Raising is `raise E(...)` / `raise E::Ctor(...)`. Labeled ctor fields use `label~ : Type` at declaration, `label=value` at raise site, `label~` in patterns. Expected-failure test shape is `try f() catch { pat => ... } noraise { _ => fail(...) }`.

### err-legacy-forms
- conclusion: Legacy error syntax status — `type! E` (old declaration), `-> Int!E` (old signature), and `f!(..)` (old call) all still COMPILE but each emits Warning (deprecated_syntax); the old `f(..)?` call suffix is fully REMOVED (parse error).
- example:
```
///|
type! OldErr String            // warns: "The syntax `type! A` for declaring suberror type is deprecated. Use `suberror A` instead."

///|
fn old_sig(x : Int) -> Int!OldErr { x }  // warns: "The syntax `!Err` for error type annotation is deprecated. Use `raise Err` instead."

///|
fn caller_bang() -> Int raise OldErr {
  old_sig!(1)                  // warns: "The syntax `f!(..)` for calling function with error is deprecated. Use `f(..)` instead."
}

///|
fn caller_question() -> Unit {
  let r = old_sig(1)?          // HARD ERROR
  ignore(r)
}
```
- command: moon check (wasm-gc)
- result: first three = warnings only; `old_sig(1)?` fails with Error [4122] "Function with error can only be used inside a function with error types in its signature. Please fix the return type of this function." and Error [3002] "Parse error, unexpected token `?`"
- notes: There is NO Rust-style `?` propagation operator. Propagation is automatic (plain call) when the caller itself declares `raise`.

### err-propagation-and-handlers
- conclusion: Propagation is a plain call inside a function whose signature has `raise E` (specific) or bare `raise` (polymorphic/any Error); handlers are `try expr catch { pat => .. }` (also works without `try` as `expr catch {..}`), `try? expr` gives `Result[T, E]` BUT IS NOW DEPRECATED (see err-tryq-deprecated), `try! expr` aborts on error, and `raise e` inside a catch arm rethrows.
- example:
```
///|
priv suberror E2 {
  E2(String)
} derive(Debug)

///|
fn may2(x : Int) -> Int raise E2 {
  if x < 0 {
    raise E2("neg \{x}")
  }
  x * 10
}

///|
fn prop_specific(x : Int) -> Int raise E2 {
  may2(x) + 1 // plain call propagates
}

///|
fn prop_any(x : Int) -> Int raise {
  may2(x) + 2 // bare `raise` = may raise any Error
}

///|
test "propagation, try?, try!, expr catch, catch-all, rethrow" {
  assert_eq(prop_specific(3), 31)
  assert_eq(prop_any(3), 32)
  let ok : Result[Int, E2] = try? may2(5)
  let err : Result[Int, E2] = try? may2(-5)
  debug_inspect(ok, content="Ok(50)")
  assert_true(err is Err(E2(_)))
  let v = try! may2(7)
  assert_eq(v, 70)
  let w = may2(-1) catch { E2(_) => -99 }
  assert_eq(w, -99)
  fn rethrower(x : Int) -> Int raise {
    try may2(x) catch {
      e => raise e // rethrow
    }
  }
  assert_eq(rethrower(2), 20)
  try rethrower(-3) catch {
    e => inspect(e is E2(_), content="true")
  } noraise {
    _ => fail("expected raise")
  }
}
```
- command: moon test bad.mbt (wasm-gc)
- result: pass — "Total tests: 1, passed: 1, failed: 0."
- notes: `try?` wraps into Result (Ok/Err) — error type parameter is the declared suberror. A caught error binder (`e =>`) has type Error (top type) and can be tested with `e is E2(_)`. Test blocks may call raising functions directly (test bodies can raise). `fail(...)` raises a Failure error and is usable in any raising context, not just tests.

### err-block-try-error-toptype-raise-poly
- conclusion: Block form `try { ...stmts... } catch { pat => .. }` works; `Error` is a first-class top type (function can return `Error`, values match with `e is E3(code=42)`); higher-order functions use `raise?` on both the function-parameter type and the result to be polymorphic over whether the callback raises; `fail(...)` raises `Failure` and works in ordinary functions, not just tests.
- example:
```
///|
priv suberror E3 {
  E3(code~ : Int)
} derive(Debug)

///|
fn classify(x : Int) -> String {
  try {
    if x < 0 {
      raise E3(code=x)
    }
    if x == 0 {
      fail("zero not allowed")
    }
    "ok"
  } catch {
    E3(code~) => "E3:\{code}"
    Failure(_) => "failure"
    _ => "other"
  }
}

///|
fn apply_twice(f : (Int) -> Int raise?, x : Int) -> Int raise? {
  f(f(x))
}

///|
fn make_err() -> Error {
  E3(code=42)
}

///|
test "block try, fail outside test, raise? HOF, Error values" {
  inspect(classify(-2), content="E3:-2")
  inspect(classify(0), content="failure")
  inspect(classify(5), content="ok")
  assert_eq(apply_twice(y => y + 1, 10), 12)
  let r : Result[Int, Error] = try? apply_twice(
    y => if y > 10 { raise E3(code=y) } else { y + 6 },
    5,
  )
  assert_true(r is Err(E3(code=11)))
  let e : Error = make_err()
  assert_true(e is E3(code=42))
}
```
- command: moon test bad.mbt (wasm-gc)
- result: pass — "Total tests: 1, passed: 1, failed: 0."
- notes: stdlib `fail` signature: `pub fn[T] fail(StringView, loc~ : SourceLoc) -> T raise Failure` (builtin/prelude). When a `raise?` HOF is given a non-raising callback the call site needs no handling — verified in a `noraise` context: `fn use_noraise_hof() -> Int noraise { apply_twice(y => y + 1, 10) }` compiles clean; with a raising callback the call becomes fallible. Catch arms can mix specific suberrors, `Failure(_)`, and a `_` catch-all.

### option-result-api
- conclusion: Option is `T?` with `Some/None`; Result uses `Ok/Err`; unwraps that exist today: Option — unwrap / unwrap_or / unwrap_or_default / unwrap_or_else / unwrap_or_error(err) (raises), Result — unwrap / unwrap_err / unwrap_or (#alias `or`) / unwrap_or_default / unwrap_or_else (#alias `or_else`) / unwrap_or_error() (raises E) / to_option; `try? expr` is the raising->Result bridge and `unwrap_or_error` is the Result->raising bridge.
- example:
```
///|
priv suberror E4 {
  E4(String)
} derive(Debug)

///|
test "Option and Result construction + unwraps + conversions" {
  let a : Int? = Some(3)
  let b : Int? = None
  let ok : Result[Int, String] = Ok(1)
  let er : Result[Int, String] = Err("bad")
  assert_eq(a.unwrap(), 3)
  assert_eq(b.unwrap_or(7), 7)
  assert_eq(b.unwrap_or_default(), 0)
  assert_eq(ok.unwrap(), 1)
  assert_eq(er.unwrap_err(), "bad")
  assert_eq(er.or(9), 9)
  assert_true(ok.to_option() is Some(1))
  fn may(x : Int) -> Int raise E4 {
    if x < 0 {
      raise E4("neg")
    }
    x
  }
  let r : Result[Int, E4] = try? may(-1)
  assert_true(r is Err(E4("neg")))
  fn back(r : Result[Int, E4]) -> Int raise E4 {
    r.unwrap_or_error()
  }
  try back(r) catch {
    E4(m) => inspect(m, content="neg")
  } noraise {
    _ => fail("expected raise")
  }
  fn opt_back(o : Int?) -> Int raise E4 {
    o.unwrap_or_error(E4("was none"))
  }
  try opt_back(None) catch {
    E4(m) => inspect(m, content="was none")
  } noraise {
    _ => fail("expected raise")
  }
}
```
- command: moon test bad.mbt (wasm-gc); `moon ide doc 'Option'` / `moon ide doc 'Result'`
- result: pass — "Total tests: 1, passed: 1, failed: 0."
- notes: Signatures from moon ide doc: `Option::unwrap_or_error(T?, Err) -> T raise Err`, `Result::unwrap_or_error(Self[T, E]) -> T raise E`. `Show` impls for Option and Result are #deprecated (use Debug/`debug_inspect`/`to_repr`). There is NO expression-level `?` sugar for Option — `T?` is only type sugar; use `is Some(..)` patterns and methods.

### panic-tests
- conclusion: A test whose name starts with `panic` is an expected-panic test — it passes iff the body panics (`panic()`, `abort("msg")`, out-of-bounds index all count); an unnamed-panic test that panics fails with a stack trace, and a `"panic ..."` test that does NOT panic fails with "failed: panic is expected".
- example:
```
///|
test "panic array out of bounds" {
  let a : Array[Int] = [1, 2, 3]
  ignore(a[10])
}

///|
test "panic explicit panic()" {
  ignore(panic())
}

///|
test "panic abort with message" {
  ignore(abort("deliberate abort"))
}
```
- command: moon test bad.mbt (wasm-gc)
- result: pass — "Total tests: 3, passed: 3, failed: 0."; inverse cases: plain test that panics fails with a wasm stack trace; `test "panic but does not panic" { assert_eq(1,1) }` fails with `failed: panic is expected`
- notes: `panic()` and `abort(msg)` return `[T] T` so wrap with `ignore(...)` to silence unused-value warnings. Panics are NOT catchable by `try/catch` — verified two ways: (a) a test named "panic ..." whose body wraps an out-of-bounds index in `try { .. } catch { _ => -1 }` still passes (the panic escaped the catch), and (b) wrapping a panicking call in try/catch draws `Warning (unused_try): The body of this try expression never raises any error.` and the panic escapes at runtime. Panics abort the process outside tests.

### tests-whitebox-blackbox
- conclusion: `*_wbtest.mbt` (whitebox) compiles inside the package and can call private symbols with no prefix; `*_test.mbt` (blackbox) sees only the public API and refers to the tested package as `@<pkgname>` (auto-imported, no moon.pkg entry needed) — private access from blackbox fails with Error [4021].
- example:
```
// lib.mbt (package probeuser/probe)
///|
fn secret_double(x : Int) -> Int {
  x * 2
}

///|
pub fn public_triple(x : Int) -> Int {
  x * 3
}

// probe_wbtest.mbt
///|
test "whitebox can call private fn directly, no package prefix" {
  assert_eq(secret_double(4), 8)
  assert_eq(public_triple(4), 12)
}

// probe_test.mbt
///|
test "blackbox calls public API via @probe" {
  assert_eq(@probe.public_triple(5), 15)
}
```
- command: moon test (wasm-gc)
- result: pass — "Total tests: 3, passed: 3, failed: 0."; negative: `@probe.secret_double(4)` and bare `secret_double(4)` in probe_test.mbt both fail with Error [4021] (value not found)
- notes: `@probe` in the blackbox file is the module-name's last segment (module `probeuser/probe`, root package). No import stanza needed in either test kind for the tested package itself; extra helper packages go in moon.pkg `import { ... } for "test"` / `for "wbtest"`.

### tests-asserts-and-snapshots
- conclusion: Test blocks are `test "name" { }` (name optional); available asserts: assert_eq, assert_not_eq, assert_true, assert_false, fail("msg"); snapshot functions inspect / debug_inspect / json_inspect take an optional `content=` that `moon test --update` fills in automatically (multi-line `#|` string for inspect/debug_inspect, a Json LITERAL for json_inspect).
- example:
```
///|
priv struct P {
  x : Int
  y : String
} derive(Debug, ToJson)

///|
test "snapshot inspect variants" {
  inspect(1 + 2)
  debug_inspect(P::{ x: 1, y: "hi" })
  json_inspect(P::{ x: 1, y: "hi" })
}
// after `moon test snap.mbt --update` the file is rewritten to:
//   inspect(1 + 2, content=(#|3
//   ))
//   debug_inspect(P::{ x: 1, y: "hi" }, content=(#|{ x: 1, y: "hi" }
//   ))
//   json_inspect(P::{ x: 1, y: "hi" }, content=({"x":1,"y":"hi"}))
```
- command: moon test snap.mbt --update (wasm-gc)
- result: pass — update rewrote the source in place; failing asserts report e.g. `FAILED: `1 != 2``, `FAILED: `false` is not true`, `FAILED: boom`
- notes: assert_* and inspect all raise on failure (test bodies are allowed to raise). `inspect` needs `Show`; `debug_inspect` needs derived `Debug`; `json_inspect` needs `ToJson`. json_inspect's content is an actual Json value, not a string.

### tests-doctests
- conclusion: Docstring code blocks fenced as ```` ```mbt check ```` inside `///` docstrings are compiled and run by plain `moon test` (no separate --doc flag), must contain `test { }` / `async test { }` blocks, may reference the package's symbols either bare or as `@<pkg>.`, and `moon test --update` rewrites `content=` snapshots inside the docstring itself.
- example:
```
///|
/// Triple the input.
///
/// # Example
/// ```mbt check
/// test {
///   inspect(public_triple(3), content="9")
/// }
/// ```
pub fn public_triple(x : Int) -> Int {
  x * 3
}
```
- command: moon test / moon test --update (wasm-gc)
- result: pass — a deliberately wrong `content="WRONG"` failed as `test lib.mbt:11 (#0) failed / expect test failed at ...` proving the doctest executes; `moon test --update` fixed it in place inside the `///` comment
- notes: There is no `moon test --doc` needed; docstring tests are just part of the package's test set. Use ```` ```mbt nocheck ```` for illustrative-only snippets. `*.mbt.md` files in a package work the same way (blackbox test files).

### err-tryq-deprecated
- conclusion: `try? expr` still compiles and returns `Result[T, E]` but emits Warning [0020] "(deprecated): `try?` is deprecated." — the official migration is: expected success -> call directly (let it propagate); expected error -> `try expr catch { e => ... } noraise { _ => fail(...) }`; only build Ok/Err manually when a Result value must actually escape (stored/returned/passed as data).
- example:
```
///|
fn mayx(x : Int) -> Int raise Failure {
  if x < 0 {
    fail("neg")
  }
  x
}

///|
test "tryq" {
  let r : Result[Int, Failure] = try? mayx(1) // Warning [0020]: `try?` is deprecated.
  assert_true(r is Ok(1))
}
```
- command: moon check --output-json (wasm-gc; same warning on native)
- result: compiles + runs, with verbatim warning: "Warning (deprecated): `try?` is deprecated." followed by a migration hint ("Do not mechanically replace this with `try expr |> Ok catch { e => Err(e) }`; ... Only create `Ok`/`Err` when the `Result` value must escape this local expression ...")
- notes: This deprecation is easy to miss in cached builds (warnings only print on fresh compiles). All uses of `try?` in the earlier findings compile but warn. `Result::unwrap_or_error()` remains the non-deprecated Result -> raising bridge.

### async-fn-test-and-runtime
- conclusion: `async fn f(...) { }` and `async test "..." { }` are the declaration forms; there is NO `await` keyword (using it gives Error [4021] "The value identifier await is unbound" — async calls are plain calls); `async test` and `async fn main` both require package moonbitlang/async to be imported (Error [4037] otherwise), so the core stdlib alone cannot run async code — moonbitlang/async IS needed.
- example:
```
// moon.pkg of the package containing blackbox tests:
//   import {
//     "moonbitlang/async",
//   } for "test"

// async_probe_test.mbt
///|
async fn aid(x : Int) -> Int {
  x + 1
}

///|
async test "async sleep and call" {
  @async.sleep(5)
  assert_eq(aid(1), 2)
}
```
- command: moon add moonbitlang/async (installed 0.20.2); moon test async_probe_test.mbt --target native / --target js / (wasm-gc)
- result: native pass (1/1), js pass (1/1) — @async.sleep works on js too; on default wasm-gc the async test is SILENTLY SKIPPED: "Total tests: 0, passed: 0, failed: 0." (async runtime does not support wasm)
- notes: Without the import: Error [4037] "Cannot use `async test`: package moonbitlang/async is not imported." / "Cannot use `async fn main`: ...". Gotcha: a moon.pkg `import { ... } for "test"` block only applies to blackbox `*_test.mbt` files — an async test in a regular `.mbt` file fails with [4020] Package "moonbitlang/async" not found (use a plain import block for that, or put async tests in `*_test.mbt`). An `async` annotation on a function that calls nothing async gives Warning (unused_async): "This `async` annotation is useless."

### async-main-task-group
- conclusion: `async fn main { }` (no parens, no `raise`) is the async entry point; it needs `"moonbitlang/async"` imported in the main package's moon.pkg and a non-wasm target; structured concurrency is `@async.with_task_group(group => { group.spawn_bg(() => {...}) ... })` and it returns the body's value; `group.spawn(...)` returns a handle with `.wait()`.
- example:
```
// cmd/main/moon.pkg:
//   import {
//     "moonbitlang/async",
//   }
//   options(
//     "is-main": true,
//   )

///|
async fn main {
  @async.with_task_group(group => {
    group.spawn_bg(() => {
      @async.sleep(30)
      println("A after 30ms")
    })
    group.spawn_bg(() => {
      @async.sleep(10)
      println("B after 10ms")
    })
  })
  println("done")
}
```
- command: moon run cmd/main --target native
- result: pass — prints "B after 10ms" then "A after 30ms" then "done" (proves real timer-driven concurrency)
- notes: Async functions may raise by default: an async body can call `fail(...)` with no `raise` in its signature; writing `-> T raise` explicitly is also accepted. `noraise` (`async fn f() -> Int noraise`) compiles for bodies that cannot raise.

### async-closure-forms
- conclusion: In async spawns, the idiomatic closure is a plain arrow `() => { ... }` (async-ness inferred); `async fn() { ... }` is the explicit equivalent; a plain `fn() { ... }` closure that does async work compiles but warns deprecated_syntax ("This `fn` is asynchronous but not annotated with `async`, this kind of effect inference is deprecated, use arrow function `(..) => ...` instead or add explicit `async` annotation."); `async () => ...` is a parse error ("unexpected token `(`, you may expect `fn`").
- example:
```
///|
async test "closure forms" {
  let t = @async.with_task_group(group => {
    let h = group.spawn(async fn() {
      @async.sleep(1)
      105
    })
    h.wait()
  })
  assert_eq(t, 105)
}
```
- command: moon test/check --target native
- result: pass for `() =>` and `async fn()`; warning for bare `fn()`; Error [3002] for `async () =>`
- notes: `async` can only prefix `fn`, never an arrow lambda.

### attr-cfg-conditional-compilation
- conclusion: `#cfg(...)` on a top-level declaration (functions, externs, even `test` blocks) conditionally compiles it; predicates are `true`/`false`, `target="js"|"wasm"|"wasm-gc"|"native"|"llvm"`, and combinators `not(...)`, `all(...)`, `any(...)`; gating is real (an `extern "js"` that hard-errors on wasm-gc compiles on wasm-gc when gated with `#cfg(target="js")`, and two same-named functions can coexist under complementary cfgs).
- example:
```
///|
#cfg(target="js")
extern "js" fn js_add(a : Int, b : Int) -> Int = "(a, b) => a + b"

///|
#cfg(target="js")
pub fn use_js() -> Int {
  js_add(1, 2) + 2
}

///|
#cfg(not(target="js"))
pub fn use_js() -> Int {
  5
}

///|
#cfg(target="wasm-gc")
pub fn which_target() -> String {
  "wasm-gc"
}

///|
#cfg(any(target="js", target="native", target="wasm", target="llvm"))
pub fn which_target() -> String {
  "other"
}

// in a _test.mbt file — #cfg works on test blocks too:
///|
#cfg(target="wasm-gc")
test "which target on wasm-gc" {
  inspect(@ffi.which_target(), content="wasm-gc")
}
```
- command: moon test ffi --target js / wasm-gc / wasm / native (all pass); moon test -v confirms only the matching-target test runs
- result: pass on all four targets; ungated `extern "js"` on wasm-gc = Error [4156] "extern \"js\" is unsupported in wasm-gc backend." — gated version checks clean
- notes: GOTCHA: `#cfg(target="bogus")` and unknown keys like `#cfg(feature="x")` are NOT rejected — they silently evaluate to false and the declaration vanishes (a typo silently drops code; the only symptom is "Value ... not found" at use sites). Target value "wasm-gc" is spelled with a hyphen. Doc from `moon explain --attribute cfg` matches: `#cfg(true)`, `#cfg(target="wasm")`, `#cfg(not(target="wasm"))`, `#cfg(all(target="wasm", true))`, `#cfg(any(target="wasm", target="native"))`.

### ffi-extern-js
- conclusion: JS FFI is `extern "js" fn name(args) -> T = "<inline JS expression, usually an arrow function>"`; it compiles and runs with --target js and is a hard error on other targets (Error [4156] "extern \"js\" is unsupported in wasm-gc backend."), so gate it with `#cfg(target="js")` in multi-target packages.
- example:
```
///|
extern "js" fn js_add(a : Int, b : Int) -> Int = "(a, b) => a + b"

///|
extern "js" fn js_floor(x : Double) -> Double = "(x) => Math.floor(x)"

///|
pub fn use_js() -> Int {
  js_add(1, 2) + js_floor(2.9).to_int()
}

///|
test "js ffi" {
  assert_eq(use_js(), 5)
}
```
- command: moon test ffi --target js
- result: pass — "Total tests: 1, passed: 1, failed: 0."; moon check --target wasm-gc on the ungated version fails with [4156]
- notes: The string body is arbitrary JS evaluated as the function — globals like Math work directly.

### ffi-wasm-forms
- conclusion: Wasm FFI has two declaration forms that both compile on wasm/wasm-gc: a host import as a two-string body `pub fn host_pi() -> Double = "env" "get_pi"` (module + import name), and inline WebAssembly text via `pub extern "wasm" fn ... = "(func ...)"`; inline wat actually executes under moonrun; `extern "wasm"` is Error [4156] on the js target.
- example:
```
///|
pub fn host_pi() -> Double = "env" "get_pi"

///|
pub extern "wasm" fn wasm_add(a : Int, b : Int) -> Int =
  #|(func (param i32) (param i32) (result i32)
  #| (i32.add (local.get 0) (local.get 1)))

// _test.mbt:
///|
test "inline wat runs" {
  assert_eq(@ffiw.wasm_add(2, 3), 5)
}
```
- command: moon check/build/test ffiw --target wasm-gc; moon check ffiw --target wasm; moon check ffiw --target native
- result: wasm-gc check + build + test pass ("Total tests: 1, passed: 1, failed: 0."); --target wasm check passes; --target js check fails [4156] on the extern "wasm" decl; --target native check fails with "inline wasm is unsupported in native backend."
- notes: The multiline `#|` string works as the extern body. Actually running the two-string host import needs the embedder to provide env.get_pi (not exercised here); declaration+build verified only. Because extern "wasm" hard-errors on BOTH js ("inline wasm is unsupported in js backend.") and native ("inline wasm is unsupported in native backend."; the two-string import form errors as "import is unsupported in native backend, use extern \"C\" instead."), gate the package: `supported_targets = "wasm+wasm-gc"` in its moon.pkg. The expression syntax is `+`/`-` based — `"wasm or wasm-gc"` is rejected with: invalid `supported_targets` expression ... Valid examples: `js` or `all-js+wasm-gc`. With that line in place, whole-module moon test passes on wasm-gc, js, AND native (verified: 10/10, 12/12, 11/11 — per-target totals differ because gated packages/tests drop out).

### ffi-extern-c-borrow
- conclusion: Native FFI is `extern "C" fn name(args) -> T = "c_symbol"`; `#borrow(param)` marks parameters the foreign side only reads (no refcount transfer); binding directly to libc (`abs`, `strlen`) checks, links, and runs with --target native with no stub files needed for symbols already in libc.
- example:
```
///|
extern "C" fn c_abs(x : Int) -> Int = "abs"

///|
#borrow(b)
extern "C" fn c_strlen(b : Bytes) -> Int = "strlen"

///|
pub fn use_c() -> Int {
  c_abs(-7) + c_strlen(b"hello\x00")
}

// _test.mbt:
///|
test "c ffi runs against libc" {
  assert_eq(@ffic.use_c(), 12)
}
```
- command: moon test ffic --target native
- result: pass — "Total tests: 1, passed: 1, failed: 0." (7 + 5 = 12; Bytes needs explicit NUL for strlen)
- notes: `#owned(param)` is the ownership-transfer counterpart (per `moon explain --attribute borrow`: borrow = foreign side must NOT decref; owned = foreign side must eventually release); `#owned(b)` on an extern "C" decl passes moon check --target native (compile-checked; not linked). Custom C symbols would need stub sources/link config (out of scope here); libc symbols link out of the box.

### ffi-external-type-and-funcref
- conclusion: `#external` above `type X` declares an opaque foreign handle type (externref on wasm targets, `any` on js, `void*` on native); such values can be returned from and passed to externs; callbacks are typed `FuncRef[(Args) -> Ret]` and MUST be capture-free — a capturing closure fails with Error [4151] "This function is expected to be a capture-free because its expected type is `FuncRef`, but it captures k."
- example:
```
///|
#external
#cfg(target="js")
type JsDate

///|
#cfg(target="js")
extern "js" fn js_new_date(ms : Double) -> JsDate = "(ms) => new Date(ms)"

///|
#cfg(target="js")
extern "js" fn js_year(d : JsDate) -> Int = "(d) => d.getUTCFullYear()"

///|
#cfg(target="js")
extern "js" fn js_apply(x : Int, f : FuncRef[(Int) -> Int]) -> Int = "(x, f) => f(x)"

///|
#cfg(target="js")
pub fn use_external_and_callback() -> Int {
  let d = js_new_date(0)
  js_year(d) + js_apply(10, x => x * 2)
}

// _test.mbt:
///|
#cfg(target="js")
test "external type + FuncRef callback" {
  assert_eq(@ffi.use_external_and_callback(), 1990)
}
```
- command: moon test ffi --target js
- result: pass (1970 + 20 = 1990); capturing variant rejected with [4151]
- notes: `FuncRef` is a compiler builtin — `moon ide doc 'FuncRef'` finds nothing. Non-capturing arrow lambdas coerce to FuncRef implicitly. Attribute order (`#external` + `#cfg` stacked) is fine.

### attr-catalog-and-verified-semantics
- conclusion: `moon explain --attribute` lists: #alert, #alias, #as_free_fn, #borrow/#owned, #callsite, #cfg, #coverage.skip, #deprecated, #doc, #external, #inline, #internal, #label_migration, #module, #must_implement_one, #skip, #visibility, #warnings — and the important ones verified by compilation behave as documented.
- example:
```
///|
#deprecated("Use new_add instead")
pub fn old_add(a : Int, b : Int) -> Int {
  a + b
}

///|
#alias(plus, deprecated)
pub fn new_add(a : Int, b : Int) -> Int {
  a + b
}

///|
#inline
pub fn add_one(x : Int) -> Int {
  x + 1
}

///|
#inline(never)
pub fn add_two(x : Int) -> Int {
  x + 2
}

///|
#coverage.skip
pub fn not_covered() -> Int {
  9
}

///|
#warnings("-unused_value")
fn has_unused() -> Int {
  let x = 42
  7
}

///|
#alert(experimental, "This API may change.")
pub fn experimental_api(x : Int) -> Int {
  x
}

// _test.mbt:
///|
#skip("demonstrating skip")
test "this test is skipped" {
  fail("never runs")
}
```
- command: moon check attr --output-json; moon test attr
- result: using old_add warns "Warning (deprecated): Use new_add instead"; using `plus` warns "Warning (deprecated): `plus` is deprecated, use `new_add` instead"; `plus` and `new_add` both callable; #skip test never runs (suite total excludes it) while still type-checked; #warnings("-unused_value") suppresses the unused-let warning; #inline/#inline(never)/#coverage.skip compile silently; using experimental_api warns "Warning (alert_experimental): This API may change."
- notes: GOTCHA: `#alert(unsafe, ...)` produces NO warning by default — `moon explain --diagnostic alert` says "default alert exceptions: alert_unsafe=off"; enable with `--warn-list "+alert_unsafe"` (then: "Warning (alert_unsafe): This function is unsafe."). #warnings prefixes: `+` enable, `-` disable, `@` warning-as-error. #alias also does operator overloading with the string form (`#alias("_[_]")` etc.) and accepts `visibility="pub|priv"`.

### main-and-init-blocks
- conclusion: The initializer form today is `fn init { }` (multiple allowed per package; imported packages' inits run before the main package's init, which runs before `fn main`); the old bare `init { }` block is REMOVED — it is a parse error, `init` is not even in the parser's top-level keyword list.
- example:
```
// initlib/l.mbt (library package)
///|
fn init {
  println("initlib: init 1")
}

///|
fn init {
  println("initlib: init 2")
}

///|
pub fn lib_val() -> Int {
  41
}

// cmd/main/main.mbt (imports initlib)
///|
fn init {
  println("main pkg: init")
}

///|
fn main {
  println("main: \{@initlib.lib_val() + 1}")
}
```
- command: moon run cmd/main (wasm-gc)
- result: prints, in order: "initlib: init 1" / "initlib: init 2" / "main pkg: init" / "main: 42"; bare `init { ... }` = Error [3002] "Parse error, unexpected token id (lowercase start), you may expect `pub`, `priv`, `type`, `suberror`, `extenum`, `typealias`, `async`, `fn`, `fnalias`, `struct`, `enum`, `let`, `const`, `extern`, `test`, `impl`, `trait`, `traitalias`, `enumview`, `#attribute`, `using` or `extend`."
- notes: The expected-token list is also a handy inventory of ALL current top-level starters (note `extenum`, `enumview`, `extend`, `fnalias`, `using` exist; `init` does not).

### main-diagnostics-and-raise
- conclusion: `fn main { }` (no parameter list) is mandatory — `fn main() {}` is Error [3003] "Unused parameter list for the main function. The syntax is `fn main { ... }`"; `fn main` in a package without `"is-main": true` is Error [4069] "Unexpected main function in the non-main package."; `fn main raise { }` is valid, lets raising calls propagate with no handler, and an uncaught raise aborts the program at runtime (exit code 1, "RuntimeError: unreachable" via abort on wasm-gc).
- example:
```
///|
fn parse_positive(x : Int) -> Int raise Failure {
  if x < 0 {
    fail("negative")
  }
  x
}

///|
fn main raise {
  println(parse_positive(7)) // raising call, propagates out of main
  println("main raise ok")
}
```
- command: moon run cmd/main (wasm-gc)
- result: prints "7" then "main raise ok"; failing variant (`fail("boom")` in main raise) exits 1 with a RuntimeError trace
- notes: For async entry points use `async fn main` instead (needs moonbitlang/async; see async-main-task-group). Correction from review: string slicing `s[1:3]` does NOT raise — `String::sub` (aliased `_[_:_]`) has no `raise` in its signature and out-of-bounds slicing PANICS (an `ignore(s[1:3])` body passes inside a `noraise` fn; `ignore("hi"[0:5])` passes an expected-panic test).

### err-catch-exhaustiveness-noraise
- conclusion: When catching a call whose signature raises a specific suberror, the catch arms must be exhaustive over that suberror's constructors — a missing case is "Error Warning (partial_match): Partial match" (warning treated as error) listing the missing constructor; `noraise` is also valid on ordinary sync functions (`fn f(x : Int) -> Int noraise`); caught error values render via Debug/`to_repr` when the suberror derives Debug.
- example:
```
///|
priv suberror TwoErr {
  A
  B(hint~ : String)
} derive(Debug)

///|
fn certainly(x : Int) -> Int noraise {
  x + 1
}

///|
fn may3(x : Int) -> Int raise TwoErr {
  if x == 0 {
    raise TwoErr::A
  }
  if x == 1 {
    raise TwoErr::B(hint="one")
  }
  x
}

///|
test "noraise fn, error debug output" {
  assert_eq(certainly(1), 2)
  try may3(1) catch {
    err => inspect(to_repr(err), content="B(hint=\"one\")")
  } noraise {
    _ => fail("expected raise")
  }
  let v = may3(5) catch {
    TwoErr::A => -1
    TwoErr::B(hint~) => hint.length()
  }
  assert_eq(v, 5)
}
```
- command: moon test bad.mbt (wasm-gc); non-exhaustive variant via moon check
- result: pass; non-exhaustive `catch { TwoErr::A => -1 }` = "Error Warning (partial_match): Partial match, some hints: B"
- notes: A bare binder arm (`err => ...`) is always exhaustive. `to_repr(err)` gives the constructor-shaped rendering (`B(hint="one")`).

### async-ffi-negative
- conclusion: There is NO language-level async extern declaration — both `extern "js" async fn ...` and `async extern "js" fn ...` are rejected (parse errors), so a JS Promise cannot be bound as an async MoonBit function directly at the extern declaration level.
- example:
```
///|
extern "js" async fn js_delay(ms : Int) -> Int = "(ms) => new Promise(r => setTimeout(() => r(ms), ms))"
// Error [3002] parse error at `async`

///|
async extern "js" fn js_delay(ms : Int) -> Int = "..."
// Error [4074] + [3002] parse errors
```
- command: moon check ffi --target js
- result: fail (both orderings) — extern bodies must be plain sync functions
- notes: Async interop with the host goes through the moonbitlang/async runtime library machinery, not extern declarations.

### tests-misc-unnamed-skip-cli
- conclusion: Unnamed `test { }` blocks are valid; `#skip("reason")` on a test excludes it from the run (it is still type-checked) and `moon test --include-skipped` re-includes skipped tests; there is no `moon test --doc` flag — docstring tests run in the normal test pass, with `--doc-index <N>` available to run a single doc test of a file; a package-level `supported_targets = "native"` line in moon.pkg makes whole-module `moon check` on other targets skip that package cleanly.
- example:
```
///|
test {
  assert_eq(1 + 1, 2)
}
```
- command: moon test bad.mbt; moon test --help; moon check (wasm-gc with a native-only extern "C" package present)
- result: pass — unnamed test runs; help shows `--doc-index` and `--include-skipped`, no `--doc`; module-wide check = "0 errors" once ffic/moon.pkg has supported_targets = "native" (without it, wasm-gc check of the extern "C" package fails [4156] "extern \"C\" is unsupported in wasm-gc backend.")
- notes: `supported_targets` is a top-level moon.pkg line (not inside options(...)).

# Errors, raise, try/catch, Option and Result

Every `mbt check` block in this file is compiled and run by the repository's verification suite (`tooling/run_checked_docs.ts`). Blocks marked `mbt nocheck` show rejected or deprecated forms and are never compiled.

## Official topic map

Search these exact official documentation topic names to route a question into this reference. A listed name is a discoverability route; the verification labels in the surrounding reference still determine whether its claim was executed or is documentation-only.

- Checked errors and recovery: Error handling; Error Types; Failure; Throwing Errors; Error Polymorphism; Handling Errors; Try ... Catch; Transforming to Result; Panic on Errors; Error Inference

## Declaring error types

Error types are declared with `suberror`. A bare `suberror EhEmpty` has no payload. The enum-style form gives it constructors, each with positional or labeled fields exactly like an enum variant — `label~ : Type` at the declaration, matched with `label~`. The old one-line payload form `suberror MsgErr String` still compiles but warns; write the constructor form instead.

```mbt check
suberror EhEmpty

suberror EhParse {
  BadChar(Char, pos~ : Int)
  BadEof
} derive(Debug)
```

```mbt nocheck
type! OldErr String        // DEPRECATED (deprecated_syntax): write `suberror OldErr { ... }`
suberror MsgErr String     // DEPRECATED (deprecated_syntax): "Use `suberror E { E(T) }` instead"
```

## Signatures, raising, and propagation

A fallible function is `fn f(...) -> T raise E`; a bare `raise` (no type) means "may raise any `Error`". Raise a value with `raise E` / `raise E::Ctor(...)`. Inside a function whose signature already has `raise`, a **plain call** to another raising function propagates automatically — there is no `?` propagation operator.

```mbt check
fn err_empty() -> Int raise EhEmpty {
  raise EhEmpty
}

fn err_parse(s : String) -> Int raise EhParse {
  if s == "" {
    raise EhParse::BadEof
  }
  raise EhParse::BadChar('x', pos=3)
}

suberror EhE2 {
  E2(String)
} derive(Debug)

fn err_may2(x : Int) -> Int raise EhE2 {
  if x < 0 {
    raise EhE2::E2("neg \{x}")
  }
  x * 10
}

fn err_prop(x : Int) -> Int raise EhE2 {
  err_may2(x) + 1 // plain call propagates
}

fn err_prop_any(x : Int) -> Int raise {
  err_may2(x) + 2 // bare `raise` = may raise any Error
}
```

## Handling: try / catch / noraise

`try expr catch { pat => ... }` handles errors; the optional `noraise { pat => ... }` arm runs when no error was raised. Catch arms over a specific suberror must be exhaustive over its constructors (a missing case is the `partial_match` error), but a bare binder arm (`e => ...`) is always exhaustive and binds `e : Error` (the top type). `raise e` inside a catch arm rethrows. A `try` block may also wrap statements: `try { ...stmts... } catch { ... }`. The `try!` form aborts the program on error and yields the value on success.

```mbt check
fn err_to_result(x : Int) -> Result[Int, Error] {
  try {
    Ok(err_may2(x))
  } catch {
    e => Err(e) // e : Error, the top type
  }
}

test "err handling forms" {
  try err_empty() catch {
    EhEmpty => inspect("caught", content="caught")
  } noraise {
    _ => fail("expected raise")
  }
  try err_parse("a") catch {
    EhParse::BadChar(c, pos~) => inspect("\{c}@\{pos}", content="x@3")
    EhParse::BadEof => fail("wrong ctor")
  } noraise {
    _ => fail("expected raise")
  }
  assert_eq(err_prop(3), 31)
  assert_eq(err_prop_any(3), 32)
  let v = try! err_may2(7) // aborts on error
  assert_eq(v, 70)
  assert_true(err_to_result(5) is Ok(50))
  assert_true(err_to_result(-5) is Err(_))
}
```

The catch may also be written **without** `try`, directly on an expression, and a catch arm may rethrow with `raise`:

```mbt check
fn err_rethrow(x : Int) -> Int raise {
  try err_may2(x) catch {
    e => raise e // rethrow the caught error
  }
}

test "expression-form catch and rethrow" {
  let w = err_may2(-1) catch { E2(_) => -99 } // no leading `try`
  assert_eq(w, -99)
  assert_eq(err_rethrow(2), 20)
}
```

## Polymorphic `raise?` and `noraise`

A higher-order function that should be fallible **only when its callback is** annotates both the callback type and its own result with `raise?`. `noraise` is the opposite marker: a function that cannot raise. Both are ordinary (non-async) markers.

```mbt check
fn err_apply_twice(f : (Int) -> Int raise?, x : Int) -> Int raise? {
  f(f(x))
}

fn err_certain(x : Int) -> Int noraise {
  x + 1
}

test "raise? HOF and noraise" {
  assert_eq(err_apply_twice(y => y + 1, 10), 12) // non-raising callback: no handler needed
  assert_eq(err_certain(5), 6)
}
```

## Deprecated and removed error syntax

The pre-0.10 `!`-based error syntax still compiles but warns; the `?` call suffix was removed outright.

```mbt nocheck
fn old_sig(x : Int) -> Int!OldErr { x }  // DEPRECATED: "The syntax `!Err` ... is deprecated. Use `raise Err` instead."
old_sig!(1)                              // DEPRECATED: "The syntax `f!(..)` ... is deprecated. Use `f(..)` instead."
let r : Result[Int, E] = try? may(1)     // DEPRECATED [0020]: "`try?` is deprecated." — catch, or build Ok/Err by hand
let r = old_sig(1)?                       // REMOVED: Error [3002] parse error, unexpected token `?`
```

## Option and Result

`Option` is `T?` with `Some` / `None`; `Result` is `Ok` / `Err`. `T?` is type sugar only — there is no expression-level `?`; reach into values with `is Some(..)` patterns and the methods below. `unwrap_or_error` is the bridge from a `Result`/`Option` back to a raising context (it raises on `Err` / `None`); handling a raising call and building `Ok`/`Err` by hand (as `err_to_result` above) is the bridge the other way.

```mbt check
test "Option and Result methods" {
  let some : Int? = Some(3)
  let none : Int? = None
  assert_eq(some.unwrap(), 3)
  assert_eq(none.unwrap_or(7), 7)
  assert_eq(none.unwrap_or_default(), 0)
  let ok : Result[Int, String] = Ok(1)
  let er : Result[Int, String] = Err("bad")
  assert_eq(ok.unwrap(), 1)
  assert_eq(er.unwrap_err(), "bad")
  assert_eq(er.or(9), 9) // unwrap_or, aliased `or`
  assert_true(ok.to_option() is Some(1))
}
```

## Failure, `fail`, and panics

`fail("msg")` raises the builtin `Failure` error and works in any raising context, not only tests. Panics are a separate, non-recoverable mechanism: `panic()`, `abort("msg")`, and out-of-bounds indexing abort the process and are **not** catchable by `try`/`catch`. A test whose name **starts with `panic`** is an expected-panic test: it passes only if its body panics.

```mbt check
fn err_pos(x : Int) -> Int raise Failure {
  if x < 0 {
    fail("negative") // raises Failure
  }
  x
}

test "Failure via fail" {
  assert_eq(err_pos(4), 4)
  try err_pos(-1) catch {
    Failure(_) => inspect("failed", content="failed")
  } noraise {
    _ => fail("expected raise")
  }
}

test "panic err array out of bounds" {
  let a : Array[Int] = [1, 2, 3]
  ignore(a[10]) // panics; passes because the test name starts with `panic`
}
```

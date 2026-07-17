# Declarations, functions, and methods

Every `mbt check` block in this file is compiled and run by the repository's verification suite (`tooling/run_checked_docs.py`). Blocks marked `mbt nocheck` show rejected or deprecated forms and are never compiled.

## Program structure

- The entry point is `fn main { ... }` — **no parameter list**. `fn main() { ... }` is a hard error (E3003), not a style issue.
- Initialization blocks are `fn init { ... }` (the bare `init { ... }` from old tutorials is a parse error). All `fn init` blocks run before `main`.
- `///|` lines separate top-level blocks. They are a formatting convention, not syntax: code compiles without them and `moon fmt` inserts them. Blocks can be reordered freely; declaration order does not matter.
- Doc comments are `///` lines; `//` is a plain comment.

```mbt nocheck
fn main() { ... }   // WRONG: E3003 — write `fn main { ... }`
init { ... }        // WRONG: parse error — write `fn init { ... }`
```

## Top-level bindings

Top-level `let` is allowed; top-level `let mut` is a parse error. There are no mutable globals — use a `Ref[T]` cell, constructed with `Ref(value)` (`Ref::new` is deprecated).

```mbt check
let answer : Int = 42

let hits : Ref[Int] = Ref(0)

test "mutable global state goes through Ref" {
  hits.val = hits.val + 1
  assert_eq(answer + hits.val, 43)
}
```

## Functions

Top-level functions must annotate every parameter type and the return type; omitting `-> T` is E4074. The last expression is the returned value; `return` exists but is rarely needed. Local functions inside a body may omit annotations.

```mbt check
fn scale(x : Int, factor : Int) -> Int {
  x * factor
}

test "top-level and local functions" {
  fn twice(n) {
    n * 2 // local fn: types inferred
  }

  assert_eq(scale(3, 4), 12)
  assert_eq(twice(21), 42)
}
```

Anonymous functions come in two current forms — `fn(x : Int) -> Int { ... }` and arrow lambdas `x => expr` / `(a, b) => expr` (parameter types inferred from context):

```mbt check
fn apply2(f : (Int, Int) -> Int) -> Int {
  f(3, 4)
}

test "lambda forms" {
  let inc = fn(x : Int) -> Int { x + 1 }
  let tenfold = x => x * 10
  assert_eq(inc(1), 2)
  assert_eq(tenfold(3), 30)
  assert_eq(apply2((a, b) => a + b), 7)
}
```

The `_` partial-application shorthand `f(a, _)` is deprecated (warning `deprecated_syntax`); write the arrow lambda instead. Scala-style bare `_ * 2` lambdas never existed (E4116).

## Pipeline operator

`x |> f(a)` pipes `x` into the **first** argument: it means `f(x, a)`.

```mbt check
fn add2(x : Int, y : Int) -> Int {
  x + y
}

test "pipeline feeds the first argument" {
  assert_eq(5 |> add2(10), 15)
}
```

## Methods

Methods are standalone declarations `fn TypeName::method(self : Self, ...) -> T`. There are **no `impl Type { ... }` blocks** (E3023 — `impl` is reserved for traits), and the old prefix-less `fn meth(self : Type)` form is deprecated. A method without a `self` parameter is a static method, called `Type::name(...)`.

```mbt check
priv struct Counter {
  mut n : Int
}

fn Counter::create() -> Self {
  Counter::{ n: 0 }
}

fn Counter::add(self : Self, k : Int) -> Unit {
  self.n = self.n + k
}

fn Counter::value(self : Self) -> Int {
  self.n
}

test "methods and static methods" {
  let c = Counter::create()
  c.add(1)
  assert_eq(c.value(), 1)
  assert_eq(Counter::value(c), 1) // qualified call also works
}
```

```mbt nocheck
impl Counter {          // WRONG: E3023 — Rust habit; declare fn Counter::add(...) instead
  fn add(...) { ... }
}
```

A package may add methods to types it does not own, including builtins (visible package-locally):

```mbt check
fn Int::doubled(self : Int) -> Int {
  self * 2
}

test "extension method on a builtin" {
  assert_eq((21).doubled(), 42)
}
```

## Cascade calls

`x..f()..g().h()` calls `f`, `g` for effect on `x` (each `..` step returns `x`). The chain must end with a plain `.method()` (or discard explicitly) — ending on `..f()` is deprecated because its result would be silently ignored.

```mbt check
test "cascade keeps the receiver" {
  let buf = StringBuilder::new()
  buf..write_string("a")..write_string("b").write_string("c")
  assert_eq(buf.to_string(), "abc")
}
```

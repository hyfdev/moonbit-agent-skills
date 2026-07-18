# Declarations, functions, and methods

Every `mbt check` block in this file is compiled and run by the repository's verification suite (`tooling/run_checked_docs.ts`). Blocks marked `mbt nocheck` show rejected or deprecated forms and are never compiled.

## Official topic map

Search these exact official documentation topic names to route a question into this reference. A listed name is a discoverability route; the verification labels in the surrounding reference still determine whether its claim was executed or is documentation-only.

- Program structure and entry points: Introduction; Expressions and Statements; Variable Binding; Program entrance; `init` and `main`
- Naming and keyword status: Naming conventions; Keywords; Reserved Keywords
- Fundamentals entry: Fundamentals
- Functions, arguments, aliases, and recursion: Functions; Top-Level Functions; Local Functions; Function Applications; Partial Applications; Labelled arguments; Optional arguments; Optional arguments without default values; Autofill arguments; Function alias
- Special syntax overview and pipelines: Special Syntax; Pipelines; Cascade Operator
- TODO placeholder: TODO syntax
- Methods and aliases: Method and Trait; Method system; Local method; Alias methods as functions
- Comments and doc comments: Comments and Documentation; Comments; Doc Comments
- Callsite autofill attribute: Callsite Attribute

## Program structure

- The entry point is `fn main { ... }` — **no parameter list**. `fn main() { ... }` is a hard error (E3003), not a style issue.
- Initialization blocks are `fn init { ... }` (the bare `init { ... }` from old tutorials is a parse error). All `fn init` blocks run before `main`.
- `///|` lines separate top-level blocks. They are a formatting convention, not syntax: code compiles without them and `moon fmt` inserts them. Blocks can be reordered freely; declaration order does not matter.
- Doc comments are `///` lines; `//` is a plain comment.

```mbt nocheck
fn main() { ... }   // WRONG: E3003 — write `fn main { ... }`
init { ... }        // WRONG: parse error — write `fn init { ... }`
```

## Comments and documentation

Use `//` for an ordinary comment. Use `///` immediately before a top-level `fn`, `let`, `enum`, `struct`, or `type` for a Markdown Doc Comment; every line of a multi-line doc comment starts with `///`. A bare `///|` is an empty doc-comment line commonly used to separate top-level blocks, and `moon fmt` inserts it as a boundary.

An `mbt check` fence inside a doc comment is a document test. `moon check` compiles it and `moon test` runs it; wrap its contents in `test { ... }` when assertions are needed. Document tests currently run as blackbox tests, so they cannot access private definitions. Use `mbt nocheck` or another language identifier for illustrative code that must not be compiled. Literate `.mbt.md` files and the full fence matrix are in tests-and-checked-docs.mbt.md.

```mbt check
/// Return one more than `n`.
///
/// ```mbt check
/// test {
///   assert_eq(decl_documented_increment(1), 2)
/// }
/// ```
pub fn decl_documented_increment(n : Int) -> Int {
  n + 1 // an ordinary implementation comment
}
```

## Names and keywords

Value and function identifiers begin with lowercase `a-z`; types, enum constructors, and constants begin with uppercase `A-Z`. Both forms may continue with letters, digits, underscores, and non-ASCII Unicode characters. Use `snake_case` for values/functions and `PascalCase` or `SCREAMING_SNAKE_CASE` for types/constants.

Keywords are syntax and cannot be identifiers at this pin: `as`, `else`, `extern`, `fn`, `fnalias`, `if`, `let`, `const`, `match`, `using`, `mut`, `type`, `typealias`, `struct`, `enum`, `extenum`, `trait`, `traitalias`, `derive`, `while`, `break`, `continue`, `import`, `return`, `throw`, `raise`, `try`, `catch`, `pub`, `priv`, `proof_assert`, `proof_let`, `readonly`, `true`, `false`, `_`, `test`, `loop`, `for`, `in`, `impl`, `with`, `guard`, `async`, `is`, `suberror`, `and`, `letrec`, `enumview`, `noraise`, `defer`, `lexmatch`, `lexscan`, `where`, `declare`, and `nobreak`.

Reserved Keywords still parse in some identifier positions but warn because they may become syntax. The pinned official list includes `module`, `move`, `ref`, `static`, `super`, `unsafe`, `use`, `await`, `dyn`, `abstract`, `do`, `final`, `macro`, `override`, `typeof`, `virtual`, `yield`, `local`, `method`, `alias`, `assert`, `package`, `recur`, `isnot`, `define`, `downcast`, `inherit`, `member`, `namespace`, `upcast`, `void`, `lazy`, `include`, `mixin`, `protected`, `sealed`, `constructor`, `atomic`, `volatile`, `anyframe`, `anytype`, `asm`, `comptime`, `errdefer`, `export`, `opaque`, `orelse`, `resume`, `threadlocal`, `unreachable`, `dynclass`, `dynobj`, `dynrec`, `var`, `finally`, `noasync`, `assume`, and `extend`. The compiler is authoritative if that list drifts. In particular, rename an identifier called `extend` and use it only for explicit trait-method attachment; the `lang-dep-extend-identifier` fixture proves the warning and replacement with warnings denied.

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

## Function arguments, declarations, aliases, and recursion

Labelled parameters use `name~ : Type` and calls use `name=value` (or `name~` when forwarding a same-named local). Optional parameters use `name? : Type = default`; without a default, the parameter has type `Type?` and receives `None`. Forward an existing option without wrapping it again as `name?=option`. `#callsite(autofill(param))` supplies supported location types such as `SourceLoc` when a caller omits the labelled argument.

`declare fn` separates a top-level signature from its matching implementation. Mutually recursive local functions use `letrec ... and ...`; an ordinary local `fn` may only call itself and earlier local functions.

```mbt check
fn decl_render(name~ : String, count? : Int = 1, suffix? : String) -> String {
  let suffix = suffix.unwrap_or("")
  "\{name}:\{count}\{suffix}"
}

#callsite(autofill(loc))
fn decl_call_location(loc~ : SourceLoc) -> SourceLoc {
  loc
}

declare fn decl_sum(x : Int, y : Int) -> Int

fn decl_sum(x : Int, y : Int) -> Int {
  x + y
}

test "labelled, optional, autofill, declare, and letrec" {
  assert_eq(decl_render(count=2, name="x", suffix="!"), "x:2!")
  assert_eq(decl_render(name="x"), "x:1")
  let suffix : String? = Some("?")
  assert_eq(decl_render(name="x", suffix?=suffix), "x:1?")
  ignore(decl_call_location())
  assert_eq(decl_sum(20, 22), 42)
  letrec even = x => x == 0 || odd(x - 1)
  and odd = x => x != 0 && even(x - 1)
  assert_true(even(42))
}
```

Function aliases use `#alias(other_name)` on the original declaration; the full attribute behavior is owned by attributes.mbt.md. The old standalone `fnalias original as alias` form still parses but is deprecated.

```mbt nocheck
fnalias original as alias // DEPRECATED: use #alias(alias) on `original`
```

## Pipeline operator

`x |> f(a)` pipes `x` into the **first** argument: it means `f(x, a)`. Reverse pipe supplies the final argument: `f(a) <| x` means `f(a, x)`.

```mbt check
fn add2(x : Int, y : Int) -> Int {
  x + y
}

test "pipeline feeds the first argument" {
  assert_eq(5 |> add2(10), 15)
  assert_eq(add2(10) <| 5, 15)
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

## TODO placeholders

`...` is an unfinished-expression placeholder that can inhabit any expected type, but it emits warning `todo`. It is useful while sketching and must not survive a warnings-denied check. The `lang-warning-todo-placeholder` fixture proves the warning and a completed replacement.

```mbt nocheck
pub fn unfinished() -> Int {
  ... // Warning [0028] todo: unfinished code
}
```

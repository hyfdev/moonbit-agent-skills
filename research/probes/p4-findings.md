# P4 findings: negative examples (foreign-language habits vs current MoonBit)

Toolchain: moon 0.1.20260713, moonc v0.10.4+ade96c819, wasm-gc default target. Every entry below was produced by running the exact code through `moon check` (or `moon test` for behavior proofs) in a fresh minimal package (`moon.mod` name `mbtprobe/case`, empty `moon.pkg`, code as `lib.mbt`). Each entry references a verified standalone case directory under `p4-cases/<id>/` containing `code.mbt` + `meta.json` (with a compiling `fixed_code`). All 52 case dirs were machine-verified by `p4/build_cases.py`: wrong code fails (or warns/behaves as recorded) AND the fixed code passes.

## CRITICAL: foreign or stale syntax the compiler ACCEPTS

### accepted-rust-let-mut-and-friends
- conclusion: `let mut x = ...` for a reassignable local, statement semicolons, and `return y;` are all valid current MoonBit — Rust-style bodies largely compile unchanged.
- example:
```
///|
pub fn f(x : Int) -> Int {
  let mut y = x + 1;
  y = y + 1;
  return y;
}
```
- command: moon check (fresh pkg)
- result: pass, exit 0, no warnings
- notes: BUT see `rust-unneeded-let-mut` below — `mut` that is never reassigned is a hard ERROR, so blind Rust-style `let mut` breaks builds.

### accepted-c-style-for
- conclusion: C/Go-style `for i = 0; i < 3; i = i + 1 { ... }` compiles (it is MoonBit's functional for with a post-update); no `let`/parens needed.
- example:
```
///|
pub fn f() -> Int {
  let mut s = 0
  for i = 0; i < 3; i = i + 1 {
    s = s + i
  }
  s
}
```
- command: moon check
- result: pass, exit 0
- notes: loop variables are per-iteration functional state, updated via the post-update or `continue`.

### accepted-defer-but-block-scoped (case: trap-go-defer-block-scoped)
- conclusion: MoonBit HAS a `defer stmt` statement, but it runs at the end of the ENCLOSING BLOCK (LIFO within the block), not at function return like Go.
- example: see p4-cases/trap-go-defer-block-scoped/code.mbt
- command: moon test
- result: pass; observed order `body-1, inner-body, deferred-inner, body-2, deferred-second, deferred-first` (Go would give `..., body-2, deferred-second, deferred-inner, deferred-first`)
- notes: an inner-block defer fires when that block exits. Go-trained models will mis-place cleanup.

### accepted-ts-dollar-interpolation-as-literal (case: trap-ts-dollar-interpolation)
- conclusion: `"Hello ${name}"` compiles with ZERO warnings and produces the literal text `Hello ${name}` — `${}` is not interpolation; MoonBit interpolation is `\{expr}`.
- example: see p4-cases/trap-ts-dollar-interpolation/code.mbt
- command: moon test
- result: pass; `inspect("Hello ${name}", content="Hello ${name}")` holds
- notes: the single most silent TS trap found; no diagnostic at all.

### accepted-null-as-json
- conclusion: bare `null` IS a valid MoonBit expression — it is the Json null literal (`fn f() -> Json { null }` compiles); used where a non-Json type is expected it fails with "has type : Json".
- example:
```
///|
pub fn f() -> Json {
  null
}
```
- command: moon check
- result: pass for Json context; for `-> String? { null }` fail: `Expr Type Mismatch has type : Json wanted : String?` (case ts-null-literal)
- notes: error message mentioning Json confuses models expecting "null is not defined". Fix is `None`.

### accepted-deprecated-legacy-error-syntax (cases: stale-bang-call-deprecated, stale-bang-error-type-deprecated, stale-type-bang-error-decl)
- conclusion: the pre-2025 error syntax STILL COMPILES with Warning [0027] deprecated_syntax: `g!()` calls, `-> Int!Error` return annotations, and `type! MyError String` declarations all pass `moon check` (exit 0).
- example:
```
///|
type! MyError String
```
- command: moon check
- result: pass, exit 0; `Warning (deprecated_syntax): The syntax `type! A` for declaring suberror type is deprecated. Use `suberror A` instead.` (plus a second warning steering `suberror E T` payload shorthand to `suberror E { E(T) }`)
- notes: models must not EMIT these, but they will not be caught by exit codes — only by warning text. Current forms: plain call for propagation, `-> T raise [E]`, `suberror E { ... }`.

### accepted-deprecated-for-infinite (case: stale-for-infinite-loop)
- conclusion: `for { ... }` (Go-style infinite loop, also old MoonBit) still compiles but is deprecated; current form is `for ;; { ... }`.
- command: moon check
- result: pass, exit 0; `Warning (deprecated_syntax): The syntax `for { ... }` for infinite loop is deprecated. Use `for ;; { ... }` instead.`

### accepted-fn-init
- conclusion: `fn init { ... }` (function form) is valid in any package; only the bare `init { ... }` block from old tutorials is gone (parse error — `init` is no longer a keyword).
- example:
```
///|
fn init {
  println("starting")
}
```
- command: moon check
- result: pass, exit 0 (bare `init {` fails: `Parse error, unexpected token id (lowercase start)`; case stale-init-block)

### accepted-array-make-and-misc-stdlib
- conclusion: `Array::make(3, 0)` still exists and compiles; `physical_equal(a, b)` is the current identity comparison (prelude); `String` has `char_length()`, `get_char(i) -> Char?`.
- command: moon check / moon ide doc
- result: pass
- notes: `String::from` does NOT exist (case rust-string-from).

## Semantic traps proven by passing tests

### trap-rust-string-length-utf16
- conclusion: `String::length()` counts UTF-16 code units (like JS `.length`), not bytes (Rust `len()`) nor characters; `"\u{10348}".length() == 2`, `.char_length() == 1`.
- command: moon test — passes with those pinned contents (p4-cases/trap-rust-string-length-utf16)

### trap-int-division
- conclusion: `7 / 2` on Int compiles silently and is `3` (truncating integer division), not 3.5 as a TS/JS-trained model predicts.
- command: moon test — `inspect(7 / 2, content="3")` passes (p4-cases/trap-int-division)

### trap-string-index-code-unit
- conclusion: `"abc"[0]` compiles and is the NUMBER 97 (`UInt16` code unit), not `"a"` (TS) and not a compile error (Rust); use `s.get_char(0) is Some('a')` for characters.
- command: moon test — `inspect("abc"[0], content="97")` passes (p4-cases/trap-string-index-code-unit)
- notes: comparing `s[0] == someCharVariable` does not typecheck; char-literal overloading only works against literals.

## Rejected foreign syntax — Rust habits (all verified check-fail, fixed_code verified pass)

### rust-fn-main-parens
- conclusion: `fn main() { }` is rejected in an is-main package with a purpose-built diagnostic.
- result: `Error [3003]: Unused parameter list for the main function. The syntax is `fn main { ... }``
- notes: fix `fn main { ... }`. Case run with moon.pkg `options("is-main": true)` (meta has pkg_is_main).

### rust-ref-param / rust-lifetime-annotation
- conclusion: `&T` parameter types fail with `The type Int is not a trait` because `&X` is MoonBit's TRAIT OBJECT syntax (e.g. `&Logger` is legal); lifetimes fail at the lexer (`unrecognized character "'"`).
- notes: misleading diagnostic — models should learn `&` = trait object, never borrow.

### rust-str-type
- conclusion: `s : &str` fails: `Expected upper case identifier for trait name, found lower case identifier.` Fix: `String` / `StringView`.

### rust-vec-angle-generics / rust-generic-fn-angle
- conclusion: angle-bracket generics are rejected everywhere: `Vec<Int>` gives `The type Vec is undefined` + `Parse error, unexpected token infix 1`; `fn first<T>(...)` gives `Missing parameters list. Add `()` if function `first` has 0 parameter.` Fixes: `Array[Int]`, `fn[T] first(...)`.

### rust-derive-attribute
- conclusion: `#[derive(Debug)]` fails: `Lexing error: unrecognized character "#"` (MoonBit attributes are `#name` on their own line, e.g. `#deprecated`, and derive goes AFTER the type body: `struct P { ... } derive(Debug, Eq)`).

### rust-impl-trait-block
- conclusion: a grouped `impl Show for Point { fn output... }` block fails with an explicit teaching diagnostic: `Invalid grouped `impl` declarations. To implement a trait for a type, declare `impl` separately like `impl T1 for T2 with f(){ ... }`.`
- notes: `impl Show for Point with output(self, logger) { ... }` verified to compile (parameter types inferred).

### rust-match-arm-commas / rust-struct-field-commas / rust-enum-lowercase-types
- conclusion: commas after match arms, struct fields, or enum variants are rejected: `Expecting a newline or `;` here, but encountered `,`.`; Rust type names (f64, i32) additionally fail `Expected upper case identifier for type name`.
- notes: newline (or `;`) separated; this is one of the most likely Rust-model syntax errors.

### rust-mod-declaration / rust-use-import
- conclusion: `mod x { }` fails (generic parse error listing all legal top-level tokens); `use path` fails and warns `The word `use` is reserved for possible future use` — namespaces are directories with moon.pkg, imports live in moon.pkg only.

### rust-question-propagation
- conclusion: `g()?` is rejected (3 errors incl. `Parse error, unexpected token `?``); propagation is a PLAIN call inside a function declaring `raise`.
- notes: this also kills the old MoonBit `f(..)?` legacy form; interestingly `f!(..)` (bang) still compiles deprecated but `?` does not.

### rust-if-let
- conclusion: `if let Some(x) = o` fails: `Using let statement in `let` directly is not allowed. Consider moving the let binding into a curly braces block.` Fix: `if o is Some(x)`.

### rust-println-macro
- conclusion: `println!("x = {}", x)` fails amusingly: the `!` parses as legacy error-call syntax → `The attribute `!` cannot be used on application that is not aysnc nor raise error` (typo "aysnc" is in the compiler) + arity error. Fix: `println("x = \{x}")`.

### rust-string-from
- conclusion: `String::from("hi")` fails: `Type String has no method from.` Literals are already String.

### rust-immutable-field-assign
- conclusion: assigning to a struct field not declared `mut` fails: `The record field count is immutable.` Mutability is per-field in the struct declaration, not per-binding.

### rust-unneeded-let-mut
- conclusion: `let mut arr = xs` followed only by `arr.push(1)` FAILS the build: `Error [0015] Error Warning (unused_mut): The mutability of 'arr' is never used, try remove `mut`.` — unused_mut is error-level by default.
- notes: interior mutation (push, field set, map insert) does not need `mut`; `mut` is strictly for rebinding. Rust defensive `let mut` breaks `moon check`.

## Rejected foreign syntax — TypeScript habits

### ts-function-keyword / ts-interface-decl / ts-class-decl
- conclusion: `function`, `interface`, `class` are not keywords; all die with `Parse error, unexpected token id (lowercase start), you may expect `pub`, `priv`, `type`, `suberror`, `extenum`, `typealias`, `async`, `fn`, `fnalias`, `struct`, `enum`, `let`, `const`, `extern`, `test`, `impl`, `trait`, `traitalias`, `enumview`, `#attribute`, `using` or `extend`.`
- notes: that token list is a useful inventory of ALL current top-level keywords (note `enumview`, `extenum`, `fnalias`, `using`, `extend`; no `init`). Fixes: `fn` / `trait` / `struct`.

### ts-template-literal
- conclusion: backtick strings fail: `Lexing error: unrecognized character "`" (U+0060)`. Fix: `"Hello \{name}"`. (And `${}` inside normal quotes silently does NOT interpolate — see trap above.)

### ts-null-literal
- conclusion: `null` where `String?` is wanted fails with `has type : Json` (see accepted-null-as-json). Fix: `None`.

### ts-lowercase-primitive-type
- conclusion: `x : number` fails: `Expected upper case identifier for type name, found lower case identifier.` Fix: `Double`/`Int`/`String`/`Bool`.

### ts-import-statement
- conclusion: `import { readFile } from "fs"` fails with a dedicated diagnostic: `Invalid import declaration here. Hint: Add the package path to the `moon.pkg.json` file...` (hint still says moon.pkg.json even though the config file is now `moon.pkg`).

### ts-export-keyword
- conclusion: `export fn` fails; warning `The word `export` is reserved for possible future use`. Fix: `pub fn`.

### ts-await-keyword
- conclusion: `await g()` fails: `The value identifier await is unbound.` plus warning that `await` is reserved. Async calls are plain calls; asyncness propagates via `async fn`.

### ts-const-lowercase
- conclusion: `const max_size = 100` fails with a teaching diagnostic: `Expected upper case identifier for name of `const`, found lower case identifier. Did you mean `let`?` — `const` names must start uppercase.

### ts-optional-chaining
- conclusion: `o?.length()` fails (`Parse error, unexpected token `?``). Fix: `o.map(s => s.length())` or `if o is Some(s)`.

### ts-throw-undeclared
- conclusion: raising without declaring fails: `raise can only be used inside a function with error types in its signature. Please fix the return type of this function.` Errors are checked; add `raise MyError` to the signature.

## Rejected foreign syntax — Go habits

### go-func-keyword
- conclusion: `func` fails with the generic top-level parse error. Fix: `fn`.

### go-short-var-decl
- conclusion: `x := 42` fails: `The value identifier x is unbound.` + `Parse error, unexpected token `:``. Fix: `let x = 42`.

### go-type-struct-decl
- conclusion: `type Point struct { ... }` fails: `Parse error, unexpected token `struct`, you may expect `;`, `end of file` or derive.` — because MoonBit `type A B` is a NEWTYPE declaration; structs are `struct Point { ... }`.

### go-package-decl
- conclusion: `package main` fails; warning `The word `package` is reserved for possible future use.` Packages come from directories + moon.pkg.

### go-range-loop
- conclusion: `for _, v := range xs` fails: `Parse error, unexpected token `:`, you may expect `in`.` Fix: `for v in xs` / `for i, v in xs`.

### go-increment-op
- conclusion: `i++` fails with the memorable `The value identifier ~+ is unbound.` Fix: `i += 1`.

### go-exported-uppercase-fn
- conclusion: `fn Add(...)` fails (`The type Add is undefined.` + `unexpected token `(`, you may expect `::``) — uppercase identifiers after `fn` are parsed as a TYPE for a `Type::method`; function names must be lower_snake, visibility comes from `pub`.

## Rejected stale MoonBit syntax

### stale-init-block
- conclusion: bare `init { ... }` no longer parses (`init` is not a keyword); function form `fn init { ... }` is the current equivalent.

### stale-tilde-prefix-label
- conclusion: old prefix labels `fn f(~x : Int)` fail at the lexer: `Lexing error: unrecognized character "~" (U+007E)`. Current syntax is suffix `x~ : Int`.

### stale-paren-interpolation
- conclusion: old `"\(x)"` interpolation fails with a perfect hint: `Invalid escape sequence: \(. Hint: Use `\{x}` for string interpolation.`

### stale-pub-readonly
- conclusion: `pub(readonly)` fails: `The pub(readonly) modifier is not supported here` — plain `pub` is readonly-outside now; `pub(all)` allows external construction.

### stale-triple-eq
- conclusion: `a === b` no longer parses (`Parse error, unexpected token `=``); identity comparison is `physical_equal(a, b)` (verified in prelude).

## Meta-observations
- The generic top-level parse error enumerates every legal top-level starter token — handy ground truth: `pub, priv, type, suberror, extenum, typealias, async, fn, fnalias, struct, enum, let, const, extern, test, impl, trait, traitalias, enumview, #attribute, using, extend`.
- `package`, `export`, `await`, `use` are explicitly reserved words (Warning 0035 reserved_keyword).
- Several "warnings" are error-level by default (observed: 0015 unused_mut fails the build), so `moon check` exit code is stricter than the word Warning suggests.
- Deprecated syntax (Warning 0027) NEVER fails `moon check` — legacy `!` error syntax, `type!`, `for { }` all still build; linting must key off warning text.
- All wrong/fixed pairs live in `p4-cases/<id>/` (52 dirs) and were re-verified end-to-end by `p4/build_cases.py` (52/52).

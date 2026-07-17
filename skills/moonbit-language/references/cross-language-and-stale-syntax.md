# Cross-language habits and stale syntax

Habits carried over from Rust, TypeScript, and Go, plus outdated MoonBit syntax, that models keep writing in `.mbt` files. Each line reads "wrong habit -> current MoonBit way"; where the compiler rejects the wrong form, the distinctive part of its message is quoted in backticks.

## Coming from Rust

- `fn main() { ... }` with a parameter list -> `fn main { ... }` — main takes no parens, and only a package whose `moon.pkg` sets `is-main` may define it. Rejected: `Unused parameter list for the main function`.
- One `impl Show for Point { fn output(...) ... }` block -> one top-level item per method: `impl Show for Point with output(self, logger) { ... }`. Rejected: ``Invalid grouped `impl` declarations``.
- `g()?` to propagate an error -> declare `raise E` on the caller's signature and just call `g()`. Rejected: ``unexpected token `?` ``.
- `if let Some(x) = o` -> `if o is Some(x) { ... }`. Rejected: ``Using let statement in `let` directly is not allowed``.
- Commas after match arms (and after struct fields) -> newline-separated, one `pattern => expr` or `name : Type` per line. Rejected: ``Expecting a newline or `;` here, but encountered `,` ``.
- `fn first<T>(xs)` -> `fn[T] first(xs : Array[T]) -> T` — type parameters sit on `fn` in square brackets. Rejected: `Missing parameters list`.
- `Vec<Int>` -> `Array[Int]` — the type is called Array, and all type arguments use square brackets. Rejected: `The type Vec is undefined`.
- `use std::collections::HashMap` -> no in-file imports; declare imports in `moon.pkg` and call `@alias.f`. Rejected: ``The word `use` is reserved``.
- `mod geometry { ... }` -> a package is a directory with a `moon.pkg` file; there are no in-file namespaces. Rejected: `unexpected token id (lowercase start)`.
- Lifetimes and borrows (`<'a>`, `&'a String`, `&Int`, `*x`, `&str`) -> MoonBit is garbage-collected; pass `String` and other values directly (`&X` is trait-object syntax, so `&Int` fails with `The type Int is not a trait`). Rejected: `unrecognized character "'"`.
- `#[derive(Debug, Clone)]` above the type -> `derive(...)` after the type body's closing brace: `struct Point { ... } derive(Debug, Eq)`. Rejected: `unrecognized character "#"`.
- `println!("x = {}", x)` -> `println("x = \{x}")` — println is a plain function and formatting is string interpolation. Rejected: ``The attribute `!` cannot be used on application``.
- `let mut arr = ...` just to call `arr.push(..)` -> plain `let` — Arrays, Maps, and `mut` fields mutate through ordinary bindings, and an unused `mut` is a hard error: `The mutability of 'arr' is never used`. `let mut` is only for reassigning the variable itself.
- Assigning `c.count = ...` because the binding "is mutable" -> the field itself must be declared `mut count : Int` in the struct. Rejected: `The record field count is immutable`.
- `String::from("hi")` -> just write `"hi"`; a string literal already is a `String`. Rejected: `Type String has no method from`.
- `Circle(f64), Rect(f64, f64),` enum variants -> `Circle(Double)` and `Rect(Double, Double)` on their own lines; Rust primitive names (`f64`, `i32`) do not exist. Rejected: `Expected upper case identifier for type name`.

## Coming from TypeScript

- `interface Shape { ... }` -> `pub trait Shape { area(Self) -> Double }`. Rejected: `unexpected token id (lowercase start)`.
- `import { readFile } from "fs"` -> imports live in `moon.pkg`'s `import { ... }` block, never in `.mbt` files. Rejected: `Invalid import declaration here`.
- `` `Hello ${name}` `` template literal -> `"Hello \{name}"` — there are no backtick strings. Rejected: ``unrecognized character "`"``.
- Throwing without declaring it -> errors are checked; a raising function declares them: `fn f(x : Int) -> Int raise MyError`. Rejected: `raise can only be used inside a function with error types`.
- `function add(...)` -> `fn add(...)`. Rejected: `unexpected token id (lowercase start)`.
- `export fn add` -> `pub fn add`. Rejected: ``The word `export` is reserved``.
- `class Counter { ... }` -> `struct Counter { ... }` plus separate `fn Counter::method(...)` definitions; there are no classes. Rejected: `unexpected token id (lowercase start)`.
- `number` / `string` / `boolean` -> `Int` or `Double` / `String` / `Bool` — type names are UpperCamel. Rejected: `Expected upper case identifier for type name`.
- `null` for an absent value -> `None` (an Option, `T?`). Bare `null` does parse — as a `Json` literal — so it fails later with a type mismatch mentioning `has type : Json`.
- `o?.length()` optional chaining -> `o.map(s => s.length())`, or pattern match with `if o is Some(s)`. Rejected: ``unexpected token `?` ``.
- `const max_size = 100` -> `const MAX_SIZE = 100` — `const` is top-level only and the name must start uppercase; locals use `let`. Rejected: ``Expected upper case identifier for name of `const` ``.
- `await g()` -> there is no `await` keyword; inside an `async fn`, call async functions plainly and asyncness propagates. Rejected: `The value identifier await is unbound`.

## Coming from Go

- `func add(...)` -> `fn add(...)`. Rejected: `unexpected token id (lowercase start)`.
- `x := 42` -> `let x = 42`. Rejected: ``unexpected token `:` ``.
- `i++` -> `i += 1`; there is no `++` or `--`. Rejected: `The value identifier ~+ is unbound`.
- `package main` at the top of the file -> delete it; the directory plus its `moon.pkg` define the package. Rejected: ``The word `package` is reserved``.
- `for i, v := range xs` -> `for v in xs` (or `for i, v in xs` for index and value). Rejected: ``you may expect `in` ``.
- `type Point struct { ... }` -> `struct Point { ... }` — MoonBit's `type` keyword declares a newtype instead. Rejected: ``unexpected token `struct` ``.
- Capitalizing `Add` to export it -> `pub fn add` — visibility comes from `pub`, and function names stay lower_snake (uppercase names parse as types). Rejected: `The type Add is undefined`.

## Stale MoonBit you will see in old tutorials and model memory

These no longer parse:

- Bare `init { ... }` block -> `fn init { ... }` (or `fn main { ... }` in an is-main package). Rejected: `unexpected token id (lowercase start)`.
- `"value is \(x)"` interpolation -> `"value is \{x}"`. Rejected: ``Use `\{x}` for string interpolation``.
- `pub(readonly)` -> plain `pub` (already readonly from outside the package); `pub(all)` to also allow external construction. Rejected: `The pub(readonly) modifier is not supported here`.
- `~x : Int` prefix-tilde label -> the tilde is now a suffix: `fn f(x~ : Int)`, called as `f(x=1)` or `f(x~)`. Rejected: `unrecognized character "~"`.
- `a === b` identity comparison -> `physical_equal(a, b)` for identity, `==` for structural equality. Rejected: ``unexpected token `=` ``.

These still compile, but only as deprecated legacy syntax (`moon check` passes with a warning) — never write them:

- `g!()` bang call -> plain `g()` inside a function declaring a compatible `raise`. Warning: ``The syntax `f!(..)` for calling function with error is deprecated``.
- `-> Int!Error` return annotation -> `-> Int raise` (or `raise SomeError`). Warning: ``The syntax `!Err` for error type annotation is deprecated``.
- `for { ... }` infinite loop -> `for ;; { ... }`. Warning: ``The syntax `for { ... }` for infinite loop is deprecated``.
- `type! MyError String` -> `suberror MyError { MyError(String) }`. Warning: ``The syntax `type! A` for declaring suberror type is deprecated``.

## Silent traps: code that compiles but does something else

- `7 / 2` is `3` — `/` on Int truncates (a JS/TS habit expects `3.5`) -> convert first: `7.0 / 2.0` or `x.to_double() / y.to_double()`.
- `s.length()` counts UTF-16 code units, like JS `.length` — not bytes (Rust) and not characters: `"\u{10348}".length()` is `2` -> use `s.char_length()` for the number of Unicode characters.
- `"abc"[0]` is the number `97` (a `UInt16` code unit), not the string `"a"` -> use `s.get_char(0)`, which returns `Char?`.
- `"Hello ${name}"` compiles with zero warnings and keeps `${name}` as literal text -> MoonBit interpolation is `"Hello \{name}"`.
- `defer` exists, but it runs at the end of the enclosing block, not at function return as in Go; within one block, defers run LIFO at that block's end.

---

Every behavior in this file was verified against the real toolchain; the highest-value cases are pinned as fixtures under `verification/fixtures/` — `lang-neg-*` for rejected syntax, `lang-dep-*` for deprecated-but-still-compiling forms, `lang-trap-*` for silent traps.

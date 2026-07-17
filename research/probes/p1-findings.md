# MoonBit core language — verified findings (battery p1)

Toolchain: moon 0.1.20260713, moonc v0.10.4+ade96c819, moonrun 0.1.20260713 (macOS arm64, target wasm-gc unless noted). Probe module: `probeuser/p1core` created with `moon new p1core --user probeuser` (config files are the non-JSON `moon.mod` / `moon.pkg`).

### main-no-parens
- conclusion: The entry point is `fn main { ... }` with NO parameter list; `fn main() { ... }` is a hard error (code 3003 "Unused parameter list for the main function").
- example:
```
fn main {
  println("hi")
}
```
- command: `moon run -e 'fn main { println("hi") }'` (and the `fn main() {...}` variant)
- result: pass, prints `hi`; parens variant fails: `Error: [3003] ... Unused parameter list for the main function. The syntax is `fn main { ... }``
- notes: Rust/Go/TS programmers will write `fn main()` — it is rejected outright, not just a warning.

### init-blocks
- conclusion: Initialization blocks are written `fn init { ... }` (bare `init { ... }` is a parse error); multiple `fn init` blocks are allowed and all run before `main`, in file order.
- example:
```
fn init {
  println("init 1")
}

fn init {
  println("init 2")
}

fn main {
  println("main")
}
```
- command: `moon run - <<EOF ...`
- result: pass, prints `init 1`, `init 2`, `main` in that order
- notes: Bare `init {` gives `Error [3002] Parse error, unexpected token id` — `init` is not even a keyword; the expected-token list is `pub, priv, type, suberror, extenum, typealias, async, fn, fnalias, struct, enum, let, const, extern, test, impl, trait, traitalias, enumview, #attribute, using, extend`. Older docs showing bare `init { }` are stale.

### toplevel-let
- conclusion: Top-level `let` bindings are allowed and type annotation is optional when inferable; top-level `let mut` is a PARSE ERROR — globals are immutable, use a `Ref[T]` (constructed as `Ref(0)`; `Ref::new` is deprecated) for mutable global state.
- example:
```
let answer = 42

let counter : Ref[Int] = Ref(0)

fn main {
  counter.val = counter.val + 1
  println(answer + counter.val)
}
```
- command: `moon run - <<EOF` (plus the failing `let mut counter : Int = 0` variant)
- result: pass, prints `43`; `let mut` at top level fails: `Error: [3002] Parse error, unexpected token `mut``
- notes: Unlike Rust `static mut`/Go package vars, there is no mutable global binding at all. `Ref::new(0)` still works but emits deprecation warning 0020 "use `Ref` instead".

### block-separators
- conclusion: `///|` top-level block separators are a formatting convention, not a syntax requirement — code without them compiles cleanly and `moon fmt` inserts them automatically before every top-level declaration.
- example:
```
fn helper_a() -> Int {
  1
}

fn helper_b() -> Int {
  helper_a() + 1
}
```
- command: `moon check` then `moon fmt` in the package
- result: pass (only an unused-function warning); after `moon fmt` each declaration is prefixed with a `///|` line
- notes: Doc comments are `///` lines under the `///|` marker. `//` is a normal comment.

### fn-declaration
- conclusion: Top-level functions require full annotations: parameter types and the `-> ReturnType`; omitting the return type is error 4074 "Missing type annotation for the return value" (local functions inside a body may omit types).
- example:
```
fn add(x : Int, y : Int) -> Int {
  x + y
}

fn main {
  println(add(1, 2))
}
```
- command: `moon run - <<EOF`
- result: pass, prints `3`; the same `fn add(x : Int, y : Int) { ... }` without `-> Int` fails with `Error: [4074] Missing type annotation for the return value.`
- notes: Last expression is the return value; no `return` needed (like Rust). Unlike TS, no inference of top-level return types.

### lambdas
- conclusion: Anonymous functions come in two syntaxes, both current: `fn(x : Int) -> Int { ... }` and arrow lambdas `x => expr`, `(a, b) => expr`, `(x : Int) => { block }`; arrow parameter types are inferred from context.
- example:
```
fn apply(f : (Int, Int) -> Int) -> Int {
  f(3, 4)
}

fn main {
  fn double(n : Int) -> Int {
    n * 2
  }
  let f = fn(x : Int) -> Int { x + 1 }
  let g = x => x * 10
  println(double(5)) // 10
  println(f(1)) // 2
  println(g(3)) // 30
  println(apply((a, b) => a + b)) // 7
}
}
```
- command: `moon run - <<EOF`
- result: pass, prints 10, 2, 30, 7
- notes: `async` goes before `fn` only; `async x => ...` is invalid. TS programmers: `=>` works but there is no `function` keyword and no implicit `this`.

### pipeline-operator
- conclusion: `x |> f(a)` passes `x` as the FIRST argument, i.e. it means `f(x, a)`.
- example:
```
fn add(x : Int, y : Int) -> Int {
  x + y
}

fn main {
  println(5 |> add(10)) // add(5, 10)
}
```
- command: `moon run - <<EOF`
- result: pass, prints `15`
- notes: Different from F#/Elixir-style "last argument" pipes in some languages — MoonBit pipes into the first positional argument (like Elixir, unlike OCaml/F# where `x |> f` requires currying).

### partial-application-deprecated
- conclusion: The `_` partial-application shorthand `f(a, _)` still compiles but is DEPRECATED (warning 0027: "The syntax `f(a, _, b)` for partial application is deprecated. Use `x => f(a, x, b)` instead."); `_ * 2` as a bare lambda never worked (`_` only allowed in argument positions of calls/constructors).
- example:
```
fn add(x : Int, y : Int) -> Int {
  x + y
}

fn main {
  let inc = x => add(1, x) // current idiom
  println(inc(41))
}
```
- command: `moon run - <<EOF` (deprecated form `let inc = add(1, _)` also run)
- result: pass, prints `42`; `add(1, _)` warns 0027 deprecated_syntax; `arr.map(_ * 2)` errors: `[4116] Invalid _ here. The _ can only be used in argument positions within functions or constructor applications.`
- notes: Scala-style `_ * 2` lambdas don't exist. Any older MoonBit code using `f(_, b)` should migrate to arrow lambdas.

### method-declaration
- conclusion: Methods are declared as standalone `fn TypeName::method(self : Self, ...) -> T` (there are NO Rust-style `impl Type { }` blocks — error 3023 — and the old prefix-less `fn meth(self : Type)` form is deprecated warning 0027); a method without `self` is a static method called `Type::name(...)`, and `Self` is accepted both as the self parameter type and the return type.
- example:
```
struct Counter {
  mut n : Int
}

fn Counter::create() -> Self {
  Counter::{ n: 0 }
}

fn Counter::add(self : Self, k : Int) -> Unit {
  self.n = self.n + k
}

fn Counter::value(self : Counter) -> Int {
  self.n
}

test "methods" {
  let c = Counter::create()
  c.add(1)
  assert_eq(c.value(), 1)
  assert_eq(Counter::value(c), 1) // qualified call form also works
}
```
- command: `moon test methods_probe.mbt`
- result: pass (1 test); `impl P { fn get... }` fails: `Error: [3023] Invalid grouped `impl` declarations. To implement a method for a type, declare `fn` separately like `fn Type::f(arg1 : Self, arg2 : T2) -> T3 { ... }`.`
- notes: Rust programmers will reach for `impl` blocks — MoonBit reserves `impl` for traits only. `moon check` also lints package-private types with warning missing_priv ("consider marking it as `priv`") when they don't appear in the public API.

### extension-methods-on-foreign-types
- conclusion: A package can define local methods on types it does not own, including builtins: `fn Int::double(self : Int) -> Int` compiles and `(21).double()` works.
- example:
```
fn Int::double(self : Int) -> Int {
  self * 2
}

test "ext" {
  assert_eq((21).double(), 42)
}
```
- command: `moon test methods_probe.mbt`
- result: pass
- notes: Like Kotlin/C# extension methods; unlike Rust's orphan rule for inherent impls. Visible package-locally.

### cascade-operator
- conclusion: `x..f()..g()` (cascade) calls methods for effect and keeps returning `x`, but the chain must END with a plain `.h()` (or explicit ignore) — ending with `..f()` is deprecated warning 0027 "Result of `x..f()` cannot be silently ignored".
- example:
```
struct Counter {
  mut n : Int
}

fn Counter::add(self : Self, k : Int) -> Unit {
  self.n = self.n + k
}

fn Counter::value(self : Counter) -> Int {
  self.n
}

test "cascade" {
  let c = Counter::{ n: 0 }
  c..add(1)..add(2).add(4)
  assert_eq(c.value(), 7)
}
```
- command: `moon test methods_probe.mbt`
- result: pass with no warnings in this form; `c..add(1)..add(2)` alone warns deprecated_syntax
- notes: Dart-style cascades. The `..`-vs-`.` closing rule is new and easy to trip on.

### visibility-levels
- conclusion: Verified cross-package semantics (package `vis` accessed as `@vis` from a sibling package in the same module): no modifier on a type = ABSTRACT (type name visible, fields/constructors hidden); `pub` type = READ-ONLY (fields readable, external construction rejected); `pub(all)` = fully open (external construct + mutate `mut` fields); `priv` = name entirely invisible; plain `fn` = package-private; `pub fn` = callable externally; `pub(readonly)` is no longer supported at all.
- example:
```
// vis/vis.mbt
struct DefaultStruct { x : Int }
pub struct ReadStruct { x : Int }
pub(all) struct AllStruct { mut x : Int }
priv struct PrivStruct { x : Int }
fn secret() -> Int { 1 }
pub fn open_fn() -> Int { 2 }
pub fn make_default() -> DefaultStruct { { x: 10 } }
pub fn make_read() -> ReadStruct { { x: 20 } }

// client package
test "vis: allowed operations" {
  assert_eq(@vis.open_fn(), 2)
  let d : @vis.DefaultStruct = @vis.make_default() // name usable
  ignore(d)
  let r = @vis.make_read()
  assert_eq(r.x, 20) // pub: read OK
  let a : @vis.AllStruct = { x: 1 } // pub(all): construct OK
  a.x = 5 // pub(all): mutate OK
  assert_eq(a.x, 5)
}
```
- command: `moon check` + `moon test vis_client.mbt` (violations run separately)
- result: pass. Violations, verbatim: `@vis.secret()` -> `[4021] Value secret not found in package `vis``; `d.x` on abstract -> `[4028] ... which is a abstract type and not a struct`; `{ x: 99 } : @vis.ReadStruct` -> `[4036] Cannot create values of the read-only type`; `@vis.PrivStruct` -> `[4032] The type @vis.PrivStruct is undefined`; `pub(readonly)` -> `[4002] The pub(readonly) modifier is not supported here`
- notes: Four levels for types: priv < (default abstract) < pub (readonly) < pub(all). Rust programmers: bare `pub` on a struct does NOT allow construction from outside; that needs `pub(all)`.

### trait-visibility
- conclusion: A `pub trait` is "readonly"/closed — external packages can USE it but cannot implement it (error 4145); `pub(open)` is required for external implementations.
- example:
```
// vis/vis.mbt
pub(open) trait OpenTrait {
  f(Self) -> Int
}
pub trait ClosedTrait {
  g(Self) -> Int
}

// client package
struct Mine {
  v : Int
}
impl @vis.OpenTrait for Mine with f(self) {
  self.v
}
test "impl open trait externally" {
  assert_eq(Mine::{ v: 7 }.f(), 7)
}
```
- command: `moon test vis_client.mbt`; then `impl @vis.ClosedTrait for Mine2 with g(self)` via `moon check`
- result: pass for OpenTrait; ClosedTrait impl fails: `Error: [4145] Cannot implement trait '@probeuser/p1core/vis.ClosedTrait' because it is readonly.`
- notes: Rust has no closed/open trait distinction — any visible trait is implementable. In MoonBit the default `pub` is sealed-by-default.

### struct-basics
- conclusion: Structs use newline-separated fields (no commas needed), `mut` per field for mutability; construction works as plain literal `{ x: 1, y: 2 }` when the type is known, as qualified `Pt::{ x, y, ... }` (with field punning), and spread-update is `{ ..base, y: 9 }`.
- example:
```
priv struct Pt {
  x : Int
  y : Int
  mut tag : String
} derive(Eq, Compare, Hash, Debug, ToJson, Default)

test "struct construct, punning, update, mut field" {
  let x = 1
  let y = 2
  let a = Pt::{ x, y, tag: "a" }
  let b : Pt = { x: 1, y: 2, tag: "a" }
  assert_eq(a, b)
  let c = { ..a, y: 9 }
  assert_eq(c.y, 9)
  c.tag = "c" // no `let mut` needed: field mutation via reference
  assert_eq(c.tag, "c")
  let d = Pt::default()
  json_inspect(d, content={ "x": 0, "y": 0, "tag": "" })
}
```
- command: `moon test struct_probe.mbt`
- result: pass (1 test)
- notes: Spread comes FIRST (`{ ..base, y: 9 }`), like modern Rust struct-update but with leading position (Rust puts `..base` last; leading `..base` is also how JS spread reads). Mutating a `mut` field needs no `let mut` on the binding.

### derives
- conclusion: Working derives verified: `Eq, Compare, Hash, Debug, ToJson, FromJson, Default, Arbitrary`; `derive(Show)` compiles but is DEPRECATED (warning 0027: "Use `derive(Debug)` or manually implement the `Show` trait instead"); `derive(Clone)` fails — there is no Clone trait at all.
- example:
```
struct S {
  x : Int
} derive(Eq, Compare, Hash, Debug, ToJson, FromJson, Default, Arbitrary)
```
- command: `moon run -` per derive variant
- result: pass for the listed set; `derive(Clone)` -> `Error: [4023] The trait Clone is not found.`; `derive(Show)` -> deprecation warning 0027
- notes: The debugging story moved from Show to Debug (`debug_inspect`, `to_repr`). Rust programmers: no Clone/Copy — everything is a GC reference.

### enum-basics
- conclusion: Enum variants are newline-separated (no commas), payloads can be positional `Circle(Double)` or labeled `Rect(w~ : Double, h~ : Double)` (labeled fields use `label~ : Type`, constructed/matched as `label=value` / `label~`); generic enums `enum MyList[T]` work; constructors are usable unqualified when the type is known.
- example:
```
priv enum Shape {
  Point
  Circle(Double)
  Rect(w~ : Double, h~ : Double)
} derive(Debug, Eq)

priv enum MyList[T] {
  Nil
  Cons(T, MyList[T])
} derive(Debug)

fn area(s : Shape) -> Double {
  match s {
    Point => 0
    Circle(r) => 3.14 * r * r
    Rect(w~, h~) => w * h
  }
}

test "enums" {
  assert_eq(area(Circle(1.0)), 3.14)
  assert_eq(area(Rect(w=2.0, h=3.0)), 6.0)
  let l : MyList[Int] = Cons(1, Cons(2, Nil))
  debug_inspect(l, content="Cons(1, Cons(2, Nil))")
}
```
- command: `moon test enum_probe.mbt`
- result: pass (1 test)
- notes: Rust-style `Rect { w: f64 }` record variants do not exist; labeled payload is `w~ : Double`, NOT `w: Double`. `0` literal in a `Double` context is fine (literal overloading).

### constant-enums
- conclusion: Constant enums with explicit integer values (`enum Flags { A = 1; C = 4 }`, including auto-continuation `North = 0` then bare `East`) parse and compile, but there is NO automatic `to_int` conversion method.
- example:
```
enum Direction {
  North = 0
  East = 1
  South = 2
  West = 3
} derive(Eq, Debug)

fn main {
  println(Direction::South is South)
}
```
- command: `moon run -`; `C.to_int()` variant checked separately
- result: pass; `C.to_int()` fails: `Error: [4015] Type Flags has no method to_int.`
- notes: C/TS programmers expect enum-to-int conversion for free; the `= N` values affect representation only, define your own accessor if needed.

### newtypes
- conclusion: The newtype idiom is a tuple struct `struct UserId(Int)` with positional access `u.0`; the OLD `type UserId Int` newtype syntax is a PARSE ERROR today, and bare `type Handle` (no payload) declares an opaque/abstract type.
- example:
```
struct UserId(Int) derive(Eq, Debug)

struct Pair(Int, String) derive(Debug)

fn main {
  let u = UserId(42)
  println(u.0) // 42
  let p = Pair(1, "a")
  println(p.1) // a
}
```
- command: `moon run -`
- result: pass, prints `42` then `a`; `type UserId Int` fails: `Error: [3002] Parse error, unexpected token id (uppercase start), you may expect `;`, `end of file` or derive.`
- notes: Rust-style tuple structs with `.0`/`.1` access. Old MoonBit tutorials using `type X Int` + `._` are obsolete.

### type-aliases
- conclusion: The current type-alias syntax is `type Alias = Type` (e.g. `type Name = String`); BOTH older forms are deprecated — `typealias Type as Alias` warns "deprecated ... Use `type Alias = Type` instead" (per the warning shown on `typealias Name = String`) and still compiles, while `typealias Name = String` itself is parsed as the deprecated `as` form and then fails.
- example:
```
type Name = String

fn main {
  let n : Name = "hi"
  println(n)
}
```
- command: `moon run -`
- result: pass, prints `hi`; `typealias String as Name` compiles with `Warning (deprecated_syntax): The syntax `typealias B as A` ... is deprecated. Use `#alias(A)` on the declaration of `B` instead.`
- notes: Confusing triple-generation history: `typealias X as Y` (deprecated) -> `type Y = X` (current). `type` is now overloaded: `type A = B` alias, `type A` opaque, `struct A(B)` newtype.

### trait-alias
- conclusion: There is NO `trait X = Y` syntax (parse error "unexpected token `=`, you may expect `{`"); `traitalias Printable as Desc` still works but is deprecated; the current way is the `#alias(Desc)` attribute on the trait declaration, and `#alias(name)` also works on functions.
- example:
```
#alias(Desc)
trait Printable {
  describe(Self) -> String
}

fn[T : Desc] show_it(x : T) -> String {
  x.describe()
}

impl Printable for Int with describe(self) {
  "int \{self}"
}

fn main {
  println(show_it(3))
}
```
- command: `moon run -`
- result: pass, prints `int 3`; `traitalias B as A` warns deprecated_syntax; `trait Desc = Show + Eq` is a parse error
- notes: No Rust-style trait alias or bound alias. `#alias` supports `visibility="pub|priv"` and `deprecated` arguments (per `moon explain --attribute alias`), and also overloads indexing via `#alias("_[_]")` etc.

### match-patterns
- conclusion: `match` arms use `=>` with NO commas/newline separators between arms; verified in one file: guards (`x if x < 0 =>`), or-patterns (`1 | 2 | 3`), inclusive ranges `4..=9`, exclusive ranges `10..<100`, array patterns with rest in any position (`[first, .. mid, last]` — rest binds an ArrayView), string literal patterns, string prefix patterns (`[.. "pre", .. rest]`), char-range patterns on strings (`['a'..='z', ..]`), and map patterns with required key `{ "a": va, .. }` and optional key `"b"? : mb` (binds `Int?`).
- example:
```
fn classify(n : Int) -> String {
  match n {
    0 => "zero"
    1 | 2 | 3 => "small"
    4..=9 => "medium"
    10..<100 => "large"
    x if x < 0 => "negative"
    _ => "huge"
  }
}

fn str_shape(s : String) -> String {
  match s {
    "exact" => "exact-literal"
    [.. "pre", .. rest] => "prefix, rest=\{rest}"
    ['a'..='z', ..] => "starts-lower"
    _ => "other"
  }
}

fn map_shape(m : Map[String, Int]) -> String {
  match m {
    { "a": va, "b"? : mb, .. } => "a=\{va} b=\{to_repr(mb)}"
    _ => "no-a"
  }
}

test "patterns" {
  assert_eq(classify(50), "large")
  assert_eq(str_shape("prefix!"), "prefix, rest=fix!")
  assert_eq(map_shape({ "a": 1, "b": 2 }), "a=1 b=Some(2)")
}
```
- command: `moon test match_probe.mbt`
- result: pass (all 16 assertions in the full file)
- notes: Rest pattern is `.. name` (space, no `..name`-vs-`name @ ..` Rust forms). Map/string patterns don't exist in Rust/Go at all. Map patterns need the trailing `..`.

### is-expression-and-guard
- conclusion: `expr is Pattern` is a Bool-valued expression whose bindings flow into the rest of the condition and the taken branch (`if x is Some(v) && v > 10`, `while cur is Some(n) && n > 0`); `guard cond else { fallback }` and `guard x is Pattern else { ... }` work as early-exit statements, and `guard x is Pattern` without `else` crashes on mismatch.
- example:
```
fn describe(x : Int?) -> String {
  if x is Some(v) && v > 10 {
    "big \{v}"
  } else {
    "other"
  }
}

fn first_or(xs : Array[Int], default : Int) -> Int {
  guard xs is [first, ..] else { default }
  first
}

test "is and guard" {
  assert_eq(describe(Some(11)), "big 11")
  assert_eq(first_or([9, 8], 0), 9)
  assert_eq(first_or([], 0), 0)
  assert_true("hello" is ['h', ..])
}
```
- command: `moon test is_guard_probe.mbt`
- result: pass
- notes: Like Rust `let ... else` + `matches!` merged into one operator; TS/Go have nothing comparable. `Int?` is sugar for `Option[Int]`.

### generics
- conclusion: Type parameters go BEFORE the function name — `fn[T] id(...)`, `fn[T : Compare] max3(...)`, multiple bounds with `+` (`fn[T : Show + Eq] ...`), and generic methods are `fn[T] Box::wrap(...)`; the old postfix `fn id[T](...)` still compiles but warns deprecated_syntax "Use fn[..] f instead".
- example:
```
priv struct Box[T] {
  value : T
} derive(Debug)

fn[T] Box::wrap(v : T) -> Box[T] {
  { value: v }
}

fn[T : Show + Eq] same_str(a : T, b : T) -> String {
  if a == b {
    "eq"
  } else {
    "\{a}!=\{b}"
  }
}

test "generics" {
  assert_eq(Box::wrap(5).value, 5)
  assert_eq(same_str("a", "b"), "a!=b")
}
```
- command: `moon test generics_probe.mbt`
- result: pass; `fn id[T](x : T) -> T` warns: `Warning (deprecated_syntax): The syntax fn f[..] for declaring polymorphic function is deprecated. Use fn[..] f instead.`
- notes: Rust programmers will write `fn id<T>` or `fn id[T]` — both wrong/deprecated; the bracket group is a prefix: `fn[T] id`. Constraint syntax is `:` and `+` like Rust, but square brackets throughout.

### trait-declaration-and-defaults
- conclusion: Trait methods are signatures WITHOUT the `fn` keyword and with Self as an unnamed first parameter type (`name(Self) -> String`); a method can have a default implementation ONLY if the trait marks it `= _`, and the default body is supplied separately as `impl Trait with method(self) { ... }` (no `for Type`); types can override the default with their own `impl Trait for Type with method`.
- example:
```
priv trait Animal {
  name(Self) -> String
  greet(Self) -> String = _ // has a default
}

impl Animal with greet(self) {
  "hi, I am \{self.name()}"
}

priv struct Dog(String)

impl Animal for Dog with name(self) {
  self.0
}

test "default method" {
  let d : &Animal = Dog("rex")
  assert_eq(d.greet(), "hi, I am rex")
}
```
- command: `moon test traits_probe.mbt`
- result: pass; without `= _` the default impl fails: `Error: [4167] The method `greet` is not marked with `= _` in the declaration of `Animal`, although a default implementation is defined.`
- notes: Very different from Rust, where the default body lives inside the trait block. The `= _` opt-in marker has no Rust/TS/Go analogue.

### trait-impl-and-dot-call
- conclusion: `impl Trait for Type with method(...)` is the only impl form (one method per impl item); the implemented method is dot-callable on types OWNED by the package (`Dog("rex").name()` works) but NOT on foreign types (`(3).describe()` fails with "Type Int has no method describe" even with `impl Printable for Int` in scope) — foreign-type impls are reachable only via trait constraints, trait objects, or `Trait::method(value)`.
- example:
```
trait Printable {
  describe(Self) -> String
}

impl Printable for Int with describe(self) {
  "int \{self}"
}

fn[T : Printable] show_it(x : T) -> String {
  x.describe()
}

fn main {
  println(show_it(3)) // ok: via constraint
  println(Printable::describe(3)) // ok: qualified
}
```
- command: `moon run -`
- result: pass, prints `int 3` twice; the `(3).describe()` variant fails: `Error: [4015] Type Int has no method describe.`
- notes: Rust programmers expect `use Trait` to enable dot-calls on any impl'd type; MoonBit restricts dot-call sugar to the type-owning package.

### operator-overloading
- conclusion: Operators are overloaded by implementing builtin traits — verified `impl Add for V` gives `+`, `Neg` gives unary `-`, `Compare` gives `< > <= >=`, `Eq` (derive) gives `==`; stdlib also has Sub, Mul, Div, Mod, BitAnd, BitOr, BitXOr, Shl, Shr (no `Not` trait found); the OLD `op_add` method convention no longer enables `+` (fails with "does not implement trait Add").
- example:
```
priv struct V(Int) derive(Eq, Debug)

impl Add for V with add(self, other) {
  V(self.0 + other.0)
}

impl Neg for V with neg(self) {
  V(-self.0)
}

impl Compare for V with compare(self, other) {
  self.0.compare(other.0)
}

test "operator traits" {
  assert_eq(V(1) + V(2), V(3))
  assert_eq(-V(5), V(-5))
  assert_true(V(1) < V(2))
}
```
- command: `moon test traits_probe.mbt`
- result: pass; `fn V::op_add(...)` + `V(1) + V(2)` fails: `Error: [4018] ... does not implement trait Add`
- notes: `Add::add(Self, Self) -> Self` per `moon ide doc`. Indexing operators are overloaded differently: `#alias("_[_]")` / `#alias("_[_]=_")` / `#alias("_[_:_]")` attributes on methods (per `moon explain --attribute alias`). Old MoonBit `op_add`/`op_get` code is broken today.

### trait-objects-supertraits-statics
- conclusion: Trait objects are `&Trait` (`Array[&Animal]`, upcast with `value as &Animal`); super traits use `trait Loud : Animal` and supertrait methods are callable through the subtrait object; static trait methods (no Self parameter, e.g. `zero() -> Self`) work and are called as `T::zero()` inside a `[T : HasZero]` generic.
- example:
```
priv trait HasZero {
  zero() -> Self
}

priv struct V(Int) derive(Eq, Debug)

impl HasZero for V with zero() {
  V(0)
}

fn[T : HasZero] make_zero() -> T {
  T::zero()
}

test "static trait method" {
  let z : V = make_zero()
  assert_eq(z, V(0))
}
```
- command: `moon test traits_probe.mbt` (trait-object test in same file also passed: `let animals : Array[&Animal] = [Dog("rex") as &Animal, Cat("tom")]; animals[0].greet()`)
- result: pass (2 tests)
- notes: `&Trait` looks like a Rust reference but is just the trait-object type (no lifetimes/borrowing). Go programmers: closest to interface values, but impls are explicit.

### pub-open-is-trait-only
- conclusion: `pub(open)` is only valid on traits — `pub(open) struct` is rejected with error 4002 "The pub(open) modifier is not supported here".
- example:
```
pub(open) struct S {
  x : Int
}
```
- command: `moon run -`
- result: fail: `Error: [4002] ... The pub(open) modifier is not supported here` (same error class as the removed `pub(readonly)`)
- notes: Modifier matrix: types take `priv`/default/`pub`/`pub(all)`; traits take `priv`/default/`pub`/`pub(open)`.

### cross-target-confirmation
- conclusion: The entire probe suite (10 tests covering methods, structs, enums, patterns, is/guard, generics, traits, operators, visibility) passes identically on wasm-gc, js, and native backends.
- example:
```
(all test files in probeuser/p1core listed above)
```
- command: `moon test --target wasm-gc` / `--target js` / `--target native`
- result: pass — `Total tests: 10, passed: 10, failed: 0.` on each target
- notes: No core-language behavior differences observed across backends for this battery.

# Traits and generics

Every `mbt check` block in this file is compiled and run by the repository's verification suite (`tooling/run_checked_docs.ts`). Blocks marked `mbt nocheck` show rejected or deprecated forms and are never compiled.

## Official topic map

Search these exact official documentation topic names to route a question into this reference. A listed name is a discoverability route; the verification labels in the surrounding reference still determine whether its claim was executed or is documentation-only.

- Generics: Generics
- Operators and traits: Operator Overloading; Trait system; Extending traits; Implementing traits; Attaching trait methods with `extend`; Using traits; Invoke trait methods directly; Trait objects; Builtin traits; Deriving builtin traits

## Type parameters come before the name

Generics are `fn[T] name(...)`, constraints use `:` and `+` — `fn[T : Show + Eq]`. Generic methods put the brackets first too: `fn[T] Crate::of(...)`.

```mbt check
priv struct Crate[T] {
  value : T
}

fn[T] Crate::of(v : T) -> Crate[T] {
  { value: v }
}

fn[T : Show + Eq] eq_note(a : T, b : T) -> String {
  if a == b {
    "eq"
  } else {
    "\{a}!=\{b}"
  }
}

test "prefix type parameters and constraints" {
  assert_eq(Crate::of(5).value, 5)
  assert_eq(eq_note("a", "b"), "a!=b")
}
```

```mbt nocheck
fn id[T](x : T) -> T { x } // DEPRECATED: postfix brackets warn deprecated_syntax — write fn[T] id
fn id<T>(x : T) -> T { x } // WRONG: E3002 parse error — angle brackets are not MoonBit syntax
```

## Declaring traits

Trait methods are signatures without `fn`, with `Self` as an unnamed first parameter type. A method may have a default implementation **only** if the trait marks it `= _`; the default body lives outside the trait, as `impl Trait with method(self) { ... }` (no `for Type`). Types override the default with their own `impl ... for ...`.

```mbt check
priv trait Greeter {
  name(Self) -> String
  greet(Self) -> String = _ // opts into a default body
}

impl Greeter with greet(self) {
  "hi, I am \{self.name()}"
}

priv struct Robot(String)

priv struct Kiosk(String)

impl Greeter for Robot with name(self) {
  self.0
}

impl Greeter for Kiosk with name(self) {
  self.0
}

extend Robot with Greeter::{greet}
extend Kiosk with Greeter::{greet}

test "trait defaults and implementations" {
  assert_eq(Robot("r2").greet(), "hi, I am r2")
  assert_eq(Kiosk("k1").greet(), "hi, I am k1")
}

pub trait PublicGreeter {
  public_greet(Self) -> String
}

pub(all) struct PublicRobot(String)

impl PublicGreeter for PublicRobot with public_greet(self) {
  "public \{self.0}"
}

pub extend PublicRobot with PublicGreeter::{public_greet}

test "public extend syntax" {
  assert_eq(PublicRobot("robot").public_greet(), "public robot")
}
```

```mbt nocheck
priv trait T2 {
  greet(Self) -> String // no `= _` here...
}
impl T2 with greet(self) { ... } // WRONG: E4167 — a default body requires `= _` in the declaration
```

## Explicit `extend` controls dot-call methods

An `impl Trait for Type` establishes trait conformance; it should not be relied on to attach the trait's methods to an owned type. MoonBit 0.10.4 deprecated that implicit attachment. Add `extend Type with Trait::{method}` for each method that should support dot calls, and use `pub extend` when the attached method must be visible outside the package. This explicit list prevents a new upstream default method from silently changing a type's method set.

The release notes call this migration warning `implicit_impl_as_method` (79). The initial 2026-07-13 compiler made it opt-in, but the pinned 2026-07-15 compiler includes it in the default deprecated-warning set, so `--deny-warn` is sufficient; the repository fixture `lang-dep-implicit-impl-as-method` proves both the deprecated form and the `extend` fix at the current pin. Methods reached through a type constraint or trait object still support dot calls when they belong directly to that trait. The qualified `Trait::method(value)` form is always explicit.

Library authors who need to preserve a former dot-call method temporarily while steering callers away from it can put `#deprecated("message")` on the corresponding `extend` declaration. The `lang-dep-deprecated-extend` fixture proves that the dot call emits the deprecation while the qualified trait call remains available as the replacement.

At this pin, `extend` is a soft keyword: old code may still use it as an identifier, but doing so warns because it is scheduled to become reserved. Rename such identifiers now.

On a foreign type (like `Int` below), a local `impl` alone does not create a dot-call method (E4015); call it through a constraint, a trait object, or the qualified form.

```mbt check
priv trait Describable {
  describe(Self) -> String
}

impl Describable for Int with describe(self) {
  "int \{self}"
}

fn[T : Describable] described(x : T) -> String {
  x.describe() // ok: via constraint
}

test "foreign-type impls need constraint, object, or qualified call" {
  assert_eq(described(3), "int 3")
  assert_eq(Describable::describe(4), "int 4")
  let d = 5 as &Describable
  assert_eq(d.describe(), "int 5")
}
```

```mbt nocheck
(3).describe() // WRONG: E4015 — Int is not owned by this package, so no dot-call sugar
// DEPRECATED: relying on `impl Greeter for Robot` alone to make Robot.greet() a method;
// add `extend Robot with Greeter::{greet}`.
```

## Trait objects and supertraits

The trait-object type is `&Trait`; upcast a concrete value with `value as &Trait`. Supertraits are `trait Loud : Greeter`. Call supertrait methods with the qualified form `Greeter::greet(x)` — dot-calling them through a type parameter or a subtrait object still compiles but is deprecated (warnings 0083 / 0020).

```mbt check
priv trait Loud : Greeter {
  volume(Self) -> Int
}

impl Loud for Robot with volume(_self) {
  11
}

fn[T : Loud] announce(x : T) -> String {
  "\{Greeter::greet(x)} at volume \{x.volume()}"
}

test "trait objects, upcasts, supertraits" {
  let all : Array[&Greeter] = [Robot("r2") as &Greeter, Kiosk("k1")]
  assert_eq(all[0].greet(), "hi, I am r2")
  assert_eq(all[1].greet(), "hi, I am k1")
  assert_eq(announce(Robot("r2")), "hi, I am r2 at volume 11")
  let l : &Loud = Robot("r2") as &Loud
  assert_eq(Greeter::greet(l), "hi, I am r2")
}
```

## Static trait methods

A trait method without a `Self` parameter is static; inside a generic it is called as `T::method()`.

```mbt check
priv trait HasZero {
  zero() -> Self
}

priv struct Volt(Int) derive(Eq, Debug)

impl HasZero for Volt with zero() {
  Volt(0)
}

fn[T : HasZero] fresh() -> T {
  T::zero()
}

test "static trait methods" {
  let z : Volt = fresh()
  assert_eq(z, Volt(0))
}
```

## Builtin traits

The common builtin contracts are:

- `Eq`: equality through `==` / `!=`.
- `Compare : Eq`: three-way `compare`, which also supplies `<`, `<=`, `>`, and `>=`.
- `Hash`: feeds values into a `Hasher`, allowing them to serve as hash-map/set keys.
- `Show`: user-facing output through `output` / `to_string`; it is distinct from structural debugging.
- `Debug`: structural diagnostic rendering used by `debug_inspect` and `to_repr`.
- `Default`: the static `default() -> Self` constructor.
- `Add`, `Sub`, `Mul`, `Div`, `Mod`, `Neg`, the bitwise traits, and shift traits: operator semantics.

### Deriving builtin traits

`derive(...)` generates implementations when the type and all required fields support the requested trait. The current useful set includes `Eq`, `Compare`, `Hash`, `Debug`, `Default`, `ToJson`, `FromJson`, and `Arbitrary`. Do not write `derive(Show)` for diagnostics; it is deprecated at this pin, and `Debug` is the replacement. The exact field/case order, enum-default restriction, JSON styles, Option representation, and container/case/field arguments live in types-structs-enums.mbt.md.

## Operator overloading

Operators come from builtin traits: `Add` gives `+`, `Neg` gives unary `-`, `Compare` gives `< > <= >=`, `Eq` (usually derived) gives `==`. The stdlib also has `Sub, Mul, Div, Mod, BitAnd, BitOr, BitXOr, Shl, Shr`. The old `op_add` method convention is dead — it no longer enables `+` (E4018).

```mbt check
impl Add for Volt with add(self, other) {
  Volt(self.0 + other.0)
}

impl Neg for Volt with neg(self) {
  Volt(-self.0)
}

impl Compare for Volt with compare(self, other) {
  self.0.compare(other.0)
}

test "operator traits" {
  assert_eq(Volt(1) + Volt(2), Volt(3))
  assert_eq(-Volt(5), Volt(-5))
  assert_true(Volt(1) < Volt(2))
}
```

```mbt nocheck
fn Volt::op_add(self : Volt, other : Volt) -> Volt { ... } // WRONG: E4018 — `+` needs `impl Add for Volt`
```

## Trait aliases

There is no `trait X = Y` syntax (parse error), and `traitalias` is deprecated. The current way is the `#alias(Name)` attribute on the trait declaration; the alias works in constraints.

```mbt check
#alias(Brief)
priv trait Summarizable {
  brief(Self) -> String
}

impl Summarizable for Int with brief(self) {
  "#\{self}"
}

fn[T : Brief] brief_of(x : T) -> String {
  x.brief()
}

test "trait alias via #alias" {
  assert_eq(brief_of(9), "#9")
}
```

```mbt nocheck
trait Brief = Summarizable          // WRONG: parse error — no `trait X = Y` form
traitalias Summarizable as Brief    // DEPRECATED: use #alias(Brief) on the trait declaration
```

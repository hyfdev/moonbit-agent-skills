# Structs, enums, newtypes, and aliases

Every `mbt check` block in this file is compiled and run by the repository's verification suite (`tooling/run_checked_docs.py`). Blocks marked `mbt nocheck` show rejected or deprecated forms and are never compiled.

## Structs

Fields are newline-separated — no commas. `mut` marks a mutable field. Three construction forms: qualified `Pixel::{ ... }` (supports field punning), a plain literal `{ x: 1, ... }` where the expected type is already known, and spread-update `{ ..base, y: 9 }` — the spread comes **first**, not last as in Rust. Mutating a `mut` field goes through any binding; no `let mut` needed.

```mbt check
priv struct Pixel {
  x : Int
  y : Int
  mut tag : String
} derive(Eq, Debug)

test "struct construction: punning, plain literal, spread update" {
  let x = 1
  let y = 2
  let a = Pixel::{ x, y, tag: "a" } // punning: local x, y fill same-named fields
  let b : Pixel = { x: 1, y: 2, tag: "a" }
  assert_eq(a, b)
  let c = { ..a, y: 9 } // spread FIRST, then overrides
  assert_eq(c.y, 9)
  c.tag = "c" // mut field: the binding itself needs no `let mut`
  assert_eq(c.tag, "c")
}
```

## Derives

The working set is `Eq, Compare, Hash, Debug, ToJson, FromJson, Default, Arbitrary`. There is **no `Clone`** (E4023) — values are GC references, and MoonBit generates no copying machinery. `derive(Show)` still compiles but is deprecated outright (warning 0027); for debugging use `Debug` (`debug_inspect`, `to_repr`) instead. `derive(FromJson)` and `derive(Arbitrary)` work too, but their traits live in `moonbitlang/core/json` and `moonbitlang/core/quickcheck`, and using them without listing those packages in the `moon.pkg` imports is deprecated (warning E0071) — so they stay out of the compiled fence below.

```mbt check
pub struct ScoreCard { // pub only so every derived impl counts as used
  points : Int
} derive(Eq, Compare, Hash, Debug, ToJson, Default)

test "derives: Default and ToJson in action" {
  let s = ScoreCard::default()
  json_inspect(s, content={ "points": 0 })
}
```

```mbt nocheck
priv struct P { x : Int } derive(Clone) // WRONG: E4023 — the trait Clone does not exist
priv struct Q { x : Int } derive(Show)  // DEPRECATED: use derive(Debug) or implement Show manually
```

## Enums

Variants are newline-separated. Payloads are positional `Disc(Double)` or labeled `Frame(w~ : Double, h~ : Double)` — labeled fields are declared `label~ : Type`, constructed as `label=value`, and matched with `label~` punning. Rust-style record variants do not exist.

```mbt check
priv enum Figure {
  Dot
  Disc(Double)
  Frame(w~ : Double, h~ : Double)
}

test "enum payloads: positional and labeled" {
  fn area(f : Figure) -> Double {
    match f {
      Dot => 0
      Disc(r) => 3.14 * r * r
      Frame(w~, h~) => w * h
    }
  }

  assert_eq(area(Dot), 0)
  assert_eq(area(Disc(1.0)), 3.14)
  assert_eq(area(Frame(w=2.0, h=3.0)), 6.0)
}
```

```mbt nocheck
enum E {
  Frame { w : Double }  // WRONG: no Rust record variants — write Frame(w~ : Double)
}
```

Enums can be generic:

```mbt check
priv enum Chain[T] {
  End
  Link(T, Chain[T])
} derive(Debug)

test "generic enum" {
  let l : Chain[Int] = Link(1, Link(2, End))
  debug_inspect(l, content="Link(1, Link(2, End))")
}
```

## Constant enums

Variants may carry explicit integer values (`North = 0`); later bare variants continue counting. The values affect representation only — there is **no generated `to_int`** (E4015); write your own accessor if you need the number.

```mbt check
priv enum Direction {
  North = 0
  East
  South
  West
}

test "constant enum variants are ordinary variants" {
  fn code(d : Direction) -> Int { // the accessor you write yourself
    match d {
      North => 0
      East => 1
      South => 2
      West => 3
    }
  }

  assert_true(Direction::West is West)
  assert_eq(code(North), 0)
  assert_eq(code(East), 1)
  assert_eq(code(South), 2)
}
```

```mbt nocheck
Direction::South.to_int() // WRONG: E4015 — no method to_int; `= N` values do not generate conversions
```

## Newtypes are tuple structs

Wrap a type with `struct UserId(Int)` and read fields positionally with `.0`, `.1`, .... The old `type UserId Int` newtype syntax is a parse error today (E3002).

```mbt check
priv struct UserId(Int)

priv struct NamePair(Int, String)

test "newtypes use positional access" {
  let u = UserId(42)
  assert_eq(u.0, 42)
  let p = NamePair(1, "a")
  assert_eq(p.0, 1)
  assert_eq(p.1, "a")
}
```

```mbt nocheck
type UserId Int // WRONG: E3002 parse error — old newtype syntax; write `struct UserId(Int)`
```

## Type aliases and opaque types

The current alias syntax is `type Alias = Type`. The old `typealias Old as New` spelling still compiles but is deprecated; `typealias New = Old` is rejected outright (parsed as the deprecated `as` form, then fails). A bare `type Handle` with no payload declares an opaque/abstract type.

```mbt check
type Label = String

pub type OpaqueHandle // pub only to mark it used; a bare `type OpaqueHandle` is the same form

test "type alias is interchangeable with its target" {
  let l : Label = "hi"
  assert_eq(l, "hi")
}
```

```mbt nocheck
typealias String as Label // DEPRECATED: compiles with a warning — write `type Label = String`
typealias Label = String  // WRONG: parsed as the deprecated `as` form, then rejected
```

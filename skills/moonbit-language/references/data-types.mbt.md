# Data types: numbers, text, and collections

Every `mbt check` block in this file is compiled and run by the repository's verification suite (`tooling/run_checked_docs.ts`). Blocks marked `mbt nocheck` show rejected or deprecated forms and are never compiled.

## Official topic map

Search these exact official documentation topic names to route a question into this reference. A listed name is a discoverability route; the verification labels in the surrounding reference still determine whether its claim was executed or is documentation-only.

- Built-in data and overloaded literals: Built-in Data Structures; Unit; Boolean; Number; String; Char; Byte(s); Choosing a Byte Container; Tuple; Ref; Option and Result; Array; ArrayView; Map; Json; Overloaded Literals; Escape Sequences in Overloaded Literals
- Spread operator: Spread Operator
- Lexical conventions and literals: Lexical Conventions; Common Lexical Classes; String Literals; Interpolation; Multiline String Literals; Bytes Literals; Character Literals; Byte Literals

## Core values, mutable cells, and failure containers

`Unit` is a real type with one value, `()`, used when no meaningful result is returned. `Boolean` values have type `Bool`, are `true` or `false`, and use `!value` (or `not(value)`) for negation. A `Ref[T]` is a mutable cell: construct it with `Ref(value)` and read or assign its `.val` field. `Option[T]` (`T?`) represents a missing-or-present value; `Result[T, E]` represents `Ok(T)` or `Err(E)`. Checked language errors and conversions between errors, Option and Result are covered in errors-and-error-handling.mbt.md.

```mbt check
test "core values, Bool, Ref, Option, Result, and Json" {
  let unit : Unit = ()
  ignore(unit)
  let enabled : Bool = !false
  assert_true(enabled)
  let cell : Ref[Int] = Ref(1)
  cell.val = cell.val + 1
  assert_eq(cell.val, 2)
  let maybe : Int? = Some(3)
  assert_true(maybe is Some(3))
  let result : Result[Int, String] = Ok(4)
  assert_true(result is Ok(4))
  let object : Json = { "ok": true }
  json_inspect(object, content={ "ok": true })
}
```

## Numbers

Literal suffixes pin the type: `L` = Int64, `U` = UInt, `UL` = UInt64, `F` = Float, `N` = BigInt. An unsuffixed integer literal is `Int`; an unsuffixed decimal literal is `Double`. A plain literal also **overloads** to whatever the context expects — `42` fits Int64/UInt/Byte/BigInt, an integer literal fits a `Double`, and `3.14` fits a `Float`. `1_000_000` digit separators and `0x`/`0o`/`0b` radix prefixes work. BigInt is built in with arbitrary precision.

```mbt check
test "data types: number literals and overloading" {
  let b : Int64 = 42L
  let c : UInt = 42U
  let e : Float = 3.14F
  let g : BigInt = 42N
  inspect(b, content="42")
  inspect(c, content="42")
  inspect(e, content="3.140000104904175") // Float's Show prints the double-widened value
  inspect(g, content="42")
  let overload : Byte = 42 // plain literal overloads by context
  let as_double : Double = 42 // integer literal usable where Double is wanted
  inspect(overload, content="b'\\x2A'")
  inspect(as_double, content="42")
  inspect(1_000_000, content="1000000")
  inspect(0xFF, content="255")
  inspect(0o77, content="63")
  inspect(0b1010, content="10")
  let big : BigInt = 12345678901234567890N
  inspect(big * big, content="152415787532388367501905199875019052100")
}
```

There is **no implicit numeric conversion**: mixing widths is a compile error, so convert explicitly with `.to_int64()`, `.to_double()`, `Float::from_int(...)`, `.reinterpret_as_uint()`, etc.

```mbt nocheck
let a : Int = 1
let b : Int64 = 2
let c = a + b // WRONG: E4014 — Int + Int64 does not compile; write a.to_int64() + b
```

Integer `/` truncates toward zero and `%` takes the dividend's sign (like C/Go, unlike Python). Fixed-width overflow **wraps silently** (two's complement) — no panic, no checked arithmetic. Integer division by zero panics; float division by zero gives `Infinity`/`NaN`.

```mbt check
test "data types: division, overflow, and float specials" {
  inspect(7 / 2, content="3")
  inspect(-7 / 2, content="-3")
  inspect(-7 % 2, content="-1")
  let max : Int = 2147483647
  inspect(max + 1, content="-2147483648") // wraps, no panic
  inspect((4294967295U) + 1U, content="0")
  inspect(1.0 / 0.0, content="Infinity")
  let nan = 0.0 / 0.0
  inspect(nan, content="NaN")
  inspect(nan == nan, content="false")
}

test "panic data types: integer division by zero" {
  let zero = 0
  ignore(1 / zero) // a test named `panic ...` expects the panic
}

test "data types: explicit conversions" {
  let i = 65
  inspect(i.to_double(), content="65")
  inspect(i.to_byte(), content="b'\\x41'")
  debug_inspect(i.to_char(), content="Some('A')") // to_char returns Char?
  inspect(Float::from_int(i), content="65") // Int::to_float() is deprecated
  inspect((3.99).to_int(), content="3") // truncates toward zero
  inspect((-1).reinterpret_as_uint(), content="4294967295") // Int::to_uint() is deprecated
}
```

## Char and String

Char literals are `'A'`, `'\n'`, and `'\u{...}'`; `c.to_int()` gives the code point and char range patterns like `'A'..='Z'` work. A `String` is **immutable UTF-16**: `s[i]` returns a `UInt16` code unit (not a `Char`), `s.length()` counts UTF-16 code units, `s.char_length()` counts code points, and `s.get_char(i)` returns `Char?` (`None` mid-surrogate). Iterating with `for c in s` yields code points as `Char`.

```mbt check
test "data types: chars and UTF-16 string indexing" {
  let c : Char = 'A'
  inspect(c.to_int(), content="65")
  inspect('\u{1F319}'.to_int(), content="127769")
  assert_true(c is ('A'..='Z'))
  let s = "héllo🌙"
  let u : UInt16 = s[0] // a code unit, NOT a Char
  inspect(u, content="104")
  inspect(s.length(), content="7") // surrogate pair counts as 2
  inspect(s.char_length(), content="6")
  debug_inspect(s.get_char(5), content="Some('🌙')")
  debug_inspect(s.get_char(6), content="None") // mid-surrogate position
}

test "data types: string iterates by code point" {
  let s = "a🌙b"
  let chars : Array[Char] = []
  for ch in s {
    chars.push(ch)
  }
  debug_inspect(chars, content="['a', '🌙', 'b']")
  let pairs : Array[(Int, Char)] = []
  for i, ch in s.iter2() { // (code-point index, Char)
    pairs.push((i, ch))
  }
  debug_inspect(pairs, content="[(0, 'a'), (1, '🌙'), (2, 'b')]")
}

test "data types: 0.10.4 core convenience APIs" {
  assert_true("abc".all(c => c.is_ascii_lowercase()))
  assert_true("abc1".any(c => c.is_ascii_digit()))
  assert_true("moon".contains_code_unit(111))
  inspect((0 : Int16).lnot(), content="-1")
  inspect((0x0000 : UInt16).lnot().to_int(), content="65535")
  json_inspect(Json::empty_object(), content=Json::empty_object())
}
```

Interpolation is `"\{expr}"` (backslash-brace, **not** `${...}`). Multiline strings are `#|` lines — fully raw, so they double as the raw-string form (there is no `r"..."`); `$|` lines process only `\{...}` interpolation. Lines join with `\n`.

```mbt check
test "data types: interpolation and multiline strings" {
  let name = "Moon"
  inspect("hi \{name}, \{1 * 2 + 1}", content="hi Moon, 3")
  let raw =
    #|no \n escapes "here" \{1+1}
    #|second
  inspect(
    raw,
    content=(
      #|no \n escapes "here" \{1+1}
      #|second
    ),
  )
  let interp =
    $|sum=\{1 + 1}
    $|end
  assert_eq(interp, "sum=2\nend")
}
```

### Lexical and escape details

String and Char literals accept simple escapes such as `\n`, `\r`, `\t`, `\b`, `\f`, `\\`, `\"`, `\'`, and `\/`, plus Unicode escapes `\u5154` and `\u{1F600}`. Byte and Bytes literals accept the simple escapes and one-byte `\xHH` / `\oDDD` escapes; Unicode escapes are invalid there. An unescaped Byte literal is ASCII, while non-ASCII text inside a Bytes literal contributes its UTF-8 bytes. There is no multiline Bytes literal.

Interpolation expressions are nonempty and may nest ordinary literals, but they cannot contain a newline, `//` comment, attribute, or multiline string. Raw `#|` lines never interpolate; `$|` lines recognize `\{...}` but otherwise keep their text literal. A Character literal contains exactly one Unicode scalar value; a Byte literal contains one ASCII character or byte escape.

```mbt check
test "literal escape families" {
  assert_eq("\f\/".length(), 2)
  assert_eq(b"\x41\o102", b"AB")
  assert_eq(b"月", b"\xe6\x9c\x88")
  assert_eq('\u{1F600}'.to_int(), 0x1F600)
}
```

Common methods: `has_prefix` (not the deprecated `starts_with`), `trim` with a labeled `chars?`, `contains`, `find` (returns the code-unit index as `Int?`). `s[a:b]` slices by UTF-16 index into a zero-copy `StringView`; `.to_owned()` copies it out. Slicing an invalid boundary **panics**. Build strings with `StringBuilder`; `<+` streams an interpolated template into a builder, and `<?` does the same through an `Option[writer]`, skipping `None`.

```mbt check
test "data types: string methods and views" {
  let s = "  Hello, World  "
  inspect(s.trim(), content="Hello, World")
  inspect("hello".has_prefix("he"), content="true")
  debug_inspect("hello".find("l"), content="Some(2)")
  let v : StringView = s[2:7]
  inspect(v, content="Hello")
  inspect(v.to_owned(), content="Hello")
}

test "data types: StringBuilder and streaming macros" {
  let sb = StringBuilder()
  sb.write_string("ab")
  sb.write_object(3) // any Show value
  inspect(sb.to_string(), content="ab3")
  let out = StringBuilder()
  out <+ "value=\{1 + 2}"
  inspect(out.to_string(), content="value=3")
  let some : StringBuilder? = Some(StringBuilder())
  some <? "n=\{7}" // written; a None target would be skipped
  guard some is Some(w)
  inspect(w.to_string(), content="n=7")
}

test "panic data types: slicing a string mid-surrogate" {
  ignore("🌙x"[0:1]) // panics, not a checked error
}
```

## Bytes

`b"..."` is immutable `Bytes` and `b'a'` is a `Byte`; an array literal overloads to `Bytes`. Since 0.10.4, Bytes literals support the same `\{expr}` interpolation as String and encode the rendered text as UTF-8. `b[i]` returns a `Byte`; writing `b[0] = ...` does not compile. `b[a:b]` gives a zero-copy `BytesView`, and both pattern-match like arrays.

Choosing a Byte Container depends on ownership, mutability, and size changes:

| Need | Type |
| --- | --- |
| Owned immutable bytes | `Bytes` |
| Borrowed immutable slice without copying | `BytesView` |
| Owned mutable, growable storage | `Array[Byte]` |
| Owned mutable, fixed-size storage | `FixedArray[Byte]` |
| Borrowed readonly or mutable array slice | `ArrayView[Byte]` / `MutArrayView[Byte]` |
| Incremental byte builder | `Buffer` (the official API is in `moonbitlang/core/buffer`) |

```mbt check
test "data types: bytes and views" {
  let b : Bytes = b"ab\x00\xff"
  inspect(b.length(), content="4")
  let x : Byte = b[0]
  inspect(x, content="b'\\x61'")
  let b2 : Bytes = [0x01, 0x02] // array literal overloads to Bytes
  inspect(b2, content="b\"\\x01\\x02\"")
  let v : BytesView = b"hello"[1:3]
  inspect(v, content="b\"el\"")
  assert_true(b"hello" is [b'h', .. rest] && rest.length() == 4)
  let answer = 42
  let interpolated : Bytes = b"value=\{answer}"
  inspect(interpolated, content="b\"value=42\"")
  let utf8 : Bytes = b"\{"月🌙"}"
  assert_eq(utf8, b"月🌙")
  let buf = Buffer()
  buf <+ b"value=\{answer}; text=\{"月🌙"}"
  assert_eq(buf.contents(), b"value=42; text=月🌙")
}
```

```mbt nocheck
let b : Bytes = b"ab"
b[0] = b'x' // WRONG: "Type Bytes has no method op_set" — Bytes is immutable; use Array[Byte]
```

## Arrays, views, and FixedArray

`[1, 2, 3]` is a mutable, growable `Array[Int]` with reference semantics: `push` and `a[i] = x` need no `let mut` (that only rebinds the variable). `a.get(i)` returns an `Option`; `a[i]` panics out of bounds. Spread is two dots `..a`; since 0.10.4, `..if condition { values }` conditionally includes a spread. Combinators (`map`, `filter`, `fold`, `search`) are eager and `fold` takes a labeled `init=`. `a[i:j]` gives a zero-copy `ArrayView` that aliases the parent (sees later mutation); `.to_owned()` copies out. View operators no longer accept negative indices in 0.10.4. `FixedArray` has mutable elements but a fixed length.

```mbt check
test "data types: arrays, spread, combinators, and views" {
  let a = [1, 2, 3]
  a.push(4)
  a[0] = 10
  debug_inspect(a, content="[10, 2, 3, 4]")
  debug_inspect(a.get(99), content="None")
  debug_inspect([0, ..a, 3], content="[0, 10, 2, 3, 4, 3]")
  debug_inspect([0, ..if true { a }, 5], content="[0, 10, 2, 3, 4, 5]")
  debug_inspect([0, ..if false { a }, 5], content="[0, 5]")
  debug_inspect(a.map(x => x * 2), content="[20, 4, 6, 8]")
  inspect(a.fold(init=0, (acc, x) => acc + x), content="19")
  debug_inspect(a.search(2), content="Some(1)") // index Option (named search)
  let v : ArrayView[Int] = a[1:3]
  a[1] = 99 // the view sees the mutation
  debug_inspect(v, content="<ArrayView: [99, 3]>")
  debug_inspect(v.to_owned(), content="[99, 3]")
  let fixed : FixedArray[Int] = FixedArray::make(3, 0)
  fixed[0] = 7
  debug_inspect(fixed, content="<FixedArray: [7, 0, 0]>")
}
```

## Maps and sets

`{ "k": v }` is a `Map` literal. `m.get(k)` returns an `Option`; `m[k]` in read position **panics** on a missing key (like Python's `dict[k]`), and `m[k] = v` inserts or updates. Membership is `contains`, not `contains_key`. Iteration and `.keys()` keep insertion order. An empty map is `Map([])` — a bare `{}` now warns (ambiguous among map, block, struct, and JSON). Use `Json::empty_object()` for an empty JSON object, `Type::{}` for an empty record value, and `()` (or remove a redundant empty block) when the intended value is Unit. `Set[T]` is in the prelude (no `{1, 2}` literal); construct it as `Set([...])`, which deduplicates and keeps insertion order.

```mbt check
priv struct EmptyDataRecord {}

test "data types: explicit empty record and Unit" {
  let record : EmptyDataRecord = EmptyDataRecord::{}
  ignore(record)
  let unit : Unit = ()
  ignore(unit)
}
```

```mbt check
test "data types: map literal and Option access" {
  let m : Map[String, Int] = { "b": 2, "a": 1 }
  debug_inspect(m.get("a"), content="Some(1)")
  debug_inspect(m.get("zz"), content="None")
  inspect(m["a"], content="1")
  m["c"] = 3
  debug_inspect(m.keys().collect(), content="[\"b\", \"a\", \"c\"]")
  inspect(m.contains("c"), content="true")
}

test "panic data types: map index on a missing key" {
  let m : Map[String, Int] = { "a": 1 }
  ignore(m["missing"])
}

test "data types: set deduplicates and keeps order" {
  let s : Set[Int] = Set([3, 1, 2, 3])
  inspect(s.length(), content="3")
  s.add(10)
  s.remove(1)
  debug_inspect(s.to_array(), content="[3, 2, 10]")
}
```

Do not confuse the mutable prelude `Set` above with the immutable container packages. In 0.10.4, `@immut/hashmap.HashMap`, `@immut/hashset.HashSet`, `@immut/sorted_map.SortedMap`, and `@immut/sorted_set.SortedSet` gained type-named constructors, and their `from_array` methods are deprecated. Import the package in `moon.pkg` and construct, for example, `@hashset.HashSet([1, 2, 1])`. The fixtures `lang-dep-immutable-hashset-from-array` and `lang-immutable-hashset-constructor` compile both sides with warnings denied. The mutable `Set::from_array` is still an alias at this pin, but `Set([...])` is the current constructor style.

## Tuples and Option

Tuples are `(a, b, c)` with positional access `.0`/`.1` and `let (a, b) = t` destructuring, including nested patterns. `T?` is the shorthand for `Option[T]` (and `T??` nests); `Some`/`None` infer, and `x is Some(3)` is a Bool test.

```mbt check
test "data types: tuples and Option sugar" {
  let t : (Int, String, Bool) = (1, "two", true)
  inspect(t.0, content="1")
  let (a, b, c) = t
  inspect("\{a}/\{b}/\{c}", content="1/two/true")
  let ((x, y), z) = ((1, 2), 3)
  inspect(x + y + z, content="6")
  let opt : Int? = Some(3)
  inspect(opt.unwrap_or(0), content="3")
  inspect((None : Int?).unwrap_or(7), content="7")
  debug_inspect(opt.map(v => v + 1), content="Some(4)")
  assert_true(opt is Some(3))
}
```

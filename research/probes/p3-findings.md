# Probe 3 findings: data types and control flow

Toolchain: moon 0.1.20260713, moonc v0.10.4+ade96c819, target wasm-gc unless noted.

### num-literal-suffixes
- conclusion: Literal suffixes are `L` (Int64), `U` (UInt), `UL` (UInt64), `F` (Float), `N` (BigInt); unsuffixed integer literals are Int, unsuffixed decimal literals are Double.
- example:
```
test "integer literal suffixes and types" {
  let a : Int = 42
  let b : Int64 = 42L
  let c : UInt = 42U
  let d : UInt64 = 42UL
  let e : Double = 3.14
  let f : Float = 3.14F
  let g : BigInt = 42N
  inspect(a, content="42")
  inspect(b, content="42")
  inspect(c, content="42")
  inspect(d, content="42")
  inspect(e, content="3.14")
  inspect(f, content="3.140000104904175")
  inspect(g, content="42")
}
```
- command: moon test num1_test.mbt
- result: pass
- notes: Float's Show prints the double-widened value (`3.14F` shows as `3.140000104904175`), unlike Rust's `3.14f32` display. Rust programmers should not expect `i32`/`u64`-style suffixes.

### num-overloaded-literals
- conclusion: Plain literals overload to the expected type from context: `42` works as Int64/UInt/UInt64/Byte/Int16/UInt16/BigInt/Double, and `3.14` works as Float; out-of-range literals are compile errors.
- example:
```
test "overloaded literals without suffix" {
  let a : Int64 = 42
  let b : UInt = 42
  let c : UInt64 = 42
  let d : Byte = 42
  let e : Int16 = 42
  let f : UInt16 = 42
  let g : Float = 3.14
  let h : BigInt = 42
  let i : Double = 42 // int literal usable as Double
  inspect(d, content="b'\\x2A'")
  inspect(g, content="3.140000104904175")
  inspect(i, content="42")
}
```
- command: moon test num1_test.mbt
- result: pass
- notes: An integer literal can be used where Double is expected (`let i : Double = 42`), unlike Rust. Byte's Show prints `b'\x2A'` form.

### num-radix-and-separators
- conclusion: `1_000_000` separators and `0x`/`0o`/`0b` radix literals all work.
- example:
```
test {
  inspect(1_000_000, content="1000000")
  inspect(0xFF, content="255")
  inspect(0o77, content="63")
  inspect(0b1010, content="10")
}
```
- command: moon test num1_test.mbt
- result: pass
- notes: —

### num-no-implicit-conversion
- conclusion: There is no implicit numeric conversion: `Int + Int64` is a compile error (Expr Type Mismatch, error 4014); convert explicitly with `.to_int64()`, `.to_double()`, etc.
- example:
```
test "mixed arithmetic should not compile" {
  let a : Int = 1
  let b : Int64 = 2
  let c = a + b // Error [4014]: has type Int64, wanted Int
  ignore(c)
}
```
- command: moon check
- result: fail (as expected): `Error: [4014] ... Expr Type Mismatch / has type : Int64 / wanted   : Int`
- notes: Same discipline as Rust/Go. TS programmers must un-learn "it's all number".

### num-overflow-wraps
- conclusion: Fixed-width integer overflow wraps around silently (two's complement) on wasm-gc — no panic, no checked arithmetic by default.
- example:
```
test "int overflow wraps" {
  let max : Int = 2147483647
  inspect(max + 1, content="-2147483648")
  let max64 : Int64 = 9223372036854775807L
  inspect(max64 + 1L, content="-9223372036854775808")
  let umax : UInt = 4294967295U
  inspect(umax + 1U, content="0")
}
```
- command: moon test num2_test.mbt
- result: pass
- notes: Unlike Rust debug builds (which panic on overflow); like Go/Java wrapping.

### num-division-semantics
- conclusion: Integer `/` truncates toward zero and `%` takes the dividend's sign (like Rust/Go/C, unlike Python); `7/2 == 3`, `-7/2 == -3`, `-7 % 2 == -1`.
- example:
```
test "integer division and modulo semantics" {
  inspect(7 / 2, content="3")
  inspect(-7 / 2, content="-3")
  inspect(-7 % 2, content="-1")
  inspect(7.0 / 2.0, content="3.5")
}
```
- command: moon test num2_test.mbt
- result: pass
- notes: —

### num-div-by-zero-panics
- conclusion: Integer division by zero panics at runtime (test must be named `test "panic ..."` to expect it); float division by zero gives Infinity/NaN.
- example:
```
test "panic int division by zero" {
  let zero = 0
  ignore(1 / zero)
}

test "double special values" {
  inspect(1.0 / 0.0, content="Infinity")
  inspect(-1.0 / 0.0, content="-Infinity")
  let nan = 0.0 / 0.0
  inspect(nan, content="NaN")
  inspect(nan == nan, content="false")
}
```
- command: moon test num2_test.mbt / num4_test.mbt
- result: pass (panic expected and observed; float specials print `Infinity`/`NaN`)
- notes: Double prints `Infinity`/`NaN` — same strings as JS's `String(1/0)`, unlike Rust's `inf`.

### num-bigint
- conclusion: BigInt is built in with `N`-suffixed (or overloaded) literals and arbitrary-precision arithmetic.
- example:
```
test "bigint arithmetic" {
  let a : BigInt = 12345678901234567890N
  inspect(a * a, content="152415787532388367501905199875019052100")
}
```
- command: moon test num2_test.mbt
- result: pass
- notes: —

### num-conversion-method-names
- conclusion: Conversions are explicit methods: `to_double()`, `to_int64()`, `to_byte()`, `to_char() -> Char?`, `Double::to_int()` truncates; `Int::to_uint()` and `Int::to_float()` are deprecated in favor of `reinterpret_as_uint()` and `Float::from_int()`.
- example:
```
test "conversion method names" {
  let i = 65
  inspect(i.to_double(), content="65")
  inspect(i.to_int64(), content="65")
  inspect(i.to_uint64(), content="65")
  inspect(i.to_byte(), content="b'\\x41'")
  debug_inspect(i.to_char(), content="Some('A')")
  inspect(Float::from_int(i), content="65") // i.to_float() is deprecated
  let d = 3.99
  inspect(d.to_int(), content="3") // truncation
  inspect((-3.99).to_int(), content="-3")
  let big : BigInt = 42N
  inspect(big.to_int(), content="42")
  inspect((-1).reinterpret_as_uint(), content="4294967295")
}
```
- command: moon test num4_test.mbt
- result: pass; separate probes of the deprecated names produced `Warning (deprecated): Use `reinterpret_as_uint` instead` for `i.to_uint()` and `Warning (deprecated): Use `Float::from_int` instead` for `i.to_float()`
- notes: `to_char()` returns `Char?` (Option), not a Char — invalid code points give None. Show on Option is deprecated for debugging; use `debug_inspect` (prints `Some('A')` with quotes, while `inspect`'s Show prints `Some(A)`).

### str-indexing-returns-uint16
- conclusion: `s[i]` on String returns a UInt16 UTF-16 code unit (not Char, not Int); `s.get_char(i)` returns `Char?` (None mid-surrogate); `s.length()` counts UTF-16 code units while `s.char_length()` counts code points.
- example:
```
test "string indexing returns UInt16 code unit" {
  let s = "héllo🌙"
  let u : UInt16 = s[0]
  inspect(u, content="104")
  inspect(s.length(), content="7") // surrogate pair counts as 2
  debug_inspect(s.get_char(5), content="Some('🌙')")
  debug_inspect(s.get_char(6), content="None") // low-surrogate position
  inspect(s.char_length(), content="6")
}
```
- command: moon test str1_test.mbt
- result: pass
- notes: Big drift trap: `s[0] == someCharVariable` will not compile (UInt16 vs Char); comparing against a *literal* works because char literals overload to UInt16. Rust programmers: no `.chars()` needed for iteration (see next), and indexing is O(1) UTF-16, not bytes.

### str-iteration-by-char
- conclusion: `for c in s` iterates by Unicode code point (Char, surrogate-safe); `for i, c in s.iter2()` gives (code-point-index, Char) pairs, not UTF-16 offsets.
- example:
```
test "string iteration is by Char (code point)" {
  let s = "a🌙b"
  let chars : Array[Char] = []
  for c in s {
    chars.push(c)
  }
  debug_inspect(chars, content="['a', '🌙', 'b']")
  let pairs : Array[(Int, Char)] = []
  for i, c in s.iter2() {
    pairs.push((i, c))
  }
  debug_inspect(pairs, content="[(0, 'a'), (1, '🌙'), (2, 'b')]")
}
```
- command: moon test str1_test.mbt
- result: pass
- notes: Iteration index (1 for 🌙's successor 'b' is 2) counts chars, so it does NOT match `s[i]` code-unit positions on non-BMP text.

### char-literals
- conclusion: Char literals are `'A'`, escapes `'\n'`, unicode `'\u{1F319}'`; `c.to_int()` gives the code point; char range patterns `c is ('A'..='Z')` work.
- example:
```
test "char literals and properties" {
  let c : Char = 'A'
  inspect(c.to_int(), content="65")
  inspect('\u{1F319}'.to_int(), content="127769")
  inspect(c.is_ascii(), content="true")
  assert_true(c is ('A'..='Z'))
}
```
- command: moon test str1_test.mbt
- result: pass
- notes: Char literals also overload to Int and UInt16 when the context expects those types (warning-free); using a char literal as a Byte still compiles but warns deprecated — write the byte literal `b'a'` instead.

### str-interpolation
- conclusion: String interpolation is `"\{expr}"` (backslash-brace, not `${}` or `{}`), supports arbitrary single-line expressions including nested string literals.
- example:
```
test "string interpolation" {
  let name = "Moon"
  let n = 3
  inspect("hi \{name}, \{n * 2 + 1}", content="hi Moon, 7")
  inspect("x\{"y" + "z"}", content="xyz")
}
```
- command: moon test str2_test.mbt
- result: pass
- notes: TS programmers will type `${}` by reflex; that is a literal `$` plus braces in MoonBit.

### str-multiline-and-raw
- conclusion: Multiline strings are lines prefixed `#|` (fully raw, no escapes — this doubles as the raw-string syntax; there is no `r"..."`), and `$|` lines where only `\{...}` interpolation is processed.
- example:
```
test "multiline strings" {
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

test "trailing #| adds trailing newline" {
  let s =
    #|x
    #|
  inspect(s.length(), content="2") // "x\n"
}

test "raw-ish strings: escapes in normal vs multiline" {
  inspect("a\tb".length(), content="3")
  let raw2 =
    #|a\tb
  inspect(raw2.length(), content="4") // a, backslash, t, b
}
```
- command: moon test str2_test.mbt / str3_test.mbt
- result: pass
- notes: A trailing `#|` line adds a trailing newline; lines are joined with `\n`. No triple-quote strings.

### str-stringbuilder-and-stream-macros
- conclusion: `StringBuilder()` plus `write_string`/`write_object`/`to_string` works, and the `<+` macro streams an interpolated template into a builder; `<?` does the same through an `Option[writer]`, skipping None.
- example:
```
test "conditional streaming with <? on optional writer" {
  let some : StringBuilder? = Some(StringBuilder())
  let none : StringBuilder? = None
  some <? "value=\{1 + 2}"
  none <? "never written \{42}"
  guard some is Some(sb)
  inspect(sb.to_string(), content="value=3")
}
```
- command: moon test str3_test.mbt (also str2_test.mbt for `<+`)
- result: pass
- notes: RHS of `<+`/`<?` must be a template string or map literal, not any expression.

### str-slicing-panics-not-raises
- conclusion: `s[a:b]` slices by UTF-16 code-unit index into a zero-copy StringView, and on an invalid boundary (mid-surrogate) it PANICS — the current `String::sub` signature has no `raise`, so `try?` around it warns "never raises" (drift from older docs that said it raises).
- example:
```
test "string view slicing" {
  let s = "hello world"
  let v : StringView = s[0:5]
  inspect(v, content="hello")
  inspect(s[6:], content="world")
  assert_true(s is [.. "hello", .. _rest])
  inspect("🌙x"[0:2], content="🌙")
}

test "panic slicing mid-surrogate" {
  ignore("🌙x"[0:1]) // panics, not a checked error
}
```
- command: moon test str2_test.mbt
- result: pass (panic test observed the panic; `try? t[0:1]` produced Warning [0023] unused_try "The body of this try expression never raises any error")
- notes: The official agent guide still says "s[a:b] may raise ... use try!"; on moonc v0.10.4 it panics instead. `moon ide doc String::sub` confirms: `pub fn String::sub(String, start? : Int, end? : Int) -> StringView` with "# Panics".

### str-method-renames
- conclusion: Current stdlib String methods: `trim()` takes an optional labeled `chars?` param (no positional arg), `has_prefix` replaces deprecated `starts_with`, `StringView::to_owned()` replaces deprecated `to_string()` for owning a slice, and `split` returns an Iter of StringView.
- example:
```
test "common string methods" {
  let s = "  Hello, World  "
  inspect(s.trim(), content="Hello, World")
  inspect(s.trim(chars=" H"), content="ello, World")
  inspect("a,b,c".split(",").map(v => v.to_owned()).to_array().length(), content="3")
  inspect("hello".contains("ell"), content="true")
  debug_inspect("hello".find("l"), content="Some(2)")
  inspect("HELLO".to_lower(), content="hello")
  inspect("hello".has_prefix("he"), content="true")
  inspect("hello".rev(), content="olleh")
}
```
- command: moon test str2_test.mbt
- result: pass
- notes: `s.trim(" ")` is a compile error (Error 4080: requires 1 positional argument, given 2). `find` returns `Int?` of the code-unit index.

### bytes-literals-and-immutability
- conclusion: `b"..."` makes immutable Bytes, `b'a'` a Byte; array literals overload to Bytes; `b[i]` returns Byte; writing `b[0] = ...` is a compile error ("Type Bytes has no method op_set").
- example:
```
test "bytes literals and indexing" {
  let b : Bytes = b"ab\x00\xff"
  inspect(b.length(), content="4")
  let x : Byte = b[0]
  inspect(x, content="b'\\x61'")
  let b2 : Bytes = [0x01, 0x02]
  inspect(b2, content="b\"\\x01\\x02\"")
  inspect(b'a'.to_int(), content="97")
}
```
- command: moon test bytes1_test.mbt; mutation probe via moon check
- result: pass; mutation fails with `Type Bytes has no method op_set.`
- notes: Go programmers: `Bytes` is immutable (unlike `[]byte`); use `Array[Byte]` or `@buffer.Buffer` for mutable byte buffers. Bytes' Show prints printable ASCII as chars (`b"el"`), non-printables as `\xNN`.

### bytes-view-and-patterns
- conclusion: `b[1:3]` gives a zero-copy BytesView; Bytes/BytesView pattern-match like arrays including `b'h'` literals and `..` rest; `Bytes::from_array`/`to_array` convert; `to_unchecked_string()` exists (UTF-16 reinterpret, unchecked).
- example:
```
test "bytes view and pattern matching" {
  let b : Bytes = b"hello"
  let v : BytesView = b[1:3]
  inspect(v, content="b\"el\"")
  assert_true(b is [b'h', .. rest] && rest.length() == 4)
  let arr : Array[Byte] = b.to_array()
  let back : Bytes = Bytes::from_array(arr)
  assert_true(back == b)
}
```
- command: moon test bytes1_test.mbt
- result: pass
- notes: For real text conversion use `@encoding/utf8.encode/decode`, not to_unchecked_string.

### array-reference-semantics
- conclusion: `let a = [1,2,3]` is a mutable, growable `Array[Int]`; `a.push`/`a[0] = x` need no `mut` (references by default; `let mut` is only for rebinding); `a.get(i)` returns Option, `a[i]` panics out of bounds.
- example:
```
test "array basics and mutation without let mut" {
  let a = [1, 2, 3]
  a.push(4)
  a[0] = 10
  debug_inspect(a, content="[10, 2, 3, 4]")
  debug_inspect(a.get(99), content="None")
}

test "panic array index out of bounds" {
  let a = [1, 2, 3]
  let i = 5
  ignore(a[i])
}
```
- command: moon test arr1_test.mbt
- result: pass
- notes: Rust programmers: no `let mut` for interior mutation, no borrow checker; this is F#/Java-style reference semantics with GC.

### array-combinators
- conclusion: Combinators are eager methods on Array: `map`, `filter`, `fold(init=..., f)` (init is a labeled arg), `rev_fold`, `contains`, `search` (returns index Option — the `index_of`/`position` name is `search`), `eachi` for indexed iteration.
- example:
```
test "array combinators" {
  let a = [1, 2, 3, 4]
  debug_inspect(a.map(x => x * 2), content="[2, 4, 6, 8]")
  debug_inspect(a.filter(x => x % 2 == 0), content="[2, 4]")
  inspect(a.fold(init=0, (acc, x) => acc + x), content="10")
  inspect(a.rev_fold(init=0, (acc, x) => acc * 10 + x), content="4321")
  debug_inspect(a.search(3), content="Some(2)")
  let out = StringBuilder()
  a.eachi((i, x) => out.write_string("\{i}:\{x} "))
  inspect(out.to_string(), content="0:1 1:2 2:3 3:4 ")
}
```
- command: moon test arr1_test.mbt
- result: pass
- notes: `fold` requires the labeled `init=` argument — positional `a.fold(0, f)` is not the signature. Lambdas are `x => expr` / `(i, x) => expr`.

### array-spread
- conclusion: Array spread `..arr` works inside array literals: `[0, ..a, 3]`.
- example:
```
test "array spread in literals" {
  let a = [1, 2]
  let b = [0, ..a, 3]
  debug_inspect(b, content="[0, 1, 2, 3]")
}
```
- command: moon test arr1_test.mbt
- result: pass
- notes: Two dots (`..a`), not three (`...a` as in JS).

### array-views-and-fixedarray
- conclusion: `a[1:3]` gives zero-copy `ArrayView[Int]` that aliases the array (sees later mutation); `.to_owned()` copies out (`.to_array()` deprecated); `FixedArray` has mutable elements but fixed length; Debug output wraps them as `<ArrayView: [...]>` / `<FixedArray: [...]>`.
- example:
```
test "array views and slicing" {
  let a = [1, 2, 3, 4, 5]
  let v : ArrayView[Int] = a[1:3]
  debug_inspect(v, content="<ArrayView: [2, 3]>")
  a[1] = 99
  debug_inspect(v, content="<ArrayView: [99, 3]>")
  let owned : Array[Int] = v.to_owned()
  debug_inspect(owned, content="[99, 3]")
}
```
- command: moon test arr1_test.mbt
- result: pass
- notes: Views are aliases, not copies — mutating the parent shows through, like Go slices, unlike Rust's borrow rules.

### map-literals-and-access
- conclusion: `{ "k": v }` is a Map literal; `m.get(k)` returns Option, `m[k]` in read position panics on a missing key, `m[k] = v` inserts/updates; iteration (`for k, v in m`) and `.keys()` preserve insertion order.
- example:
```
test "map literal, access, insertion order" {
  let m : Map[String, Int] = { "b": 2, "a": 1 }
  debug_inspect(m.get("a"), content="Some(1)")
  debug_inspect(m.get("zz"), content="None")
  let direct : Int = m["a"]
  inspect(direct, content="1")
  m["c"] = 3
  m["a"] = 100
  debug_inspect(m.keys().collect(), content="[\"b\", \"a\", \"c\"]")
  inspect(m.contains("c"), content="true")
  m.remove("b")
  inspect(m.length(), content="2")
}

test "panic map direct index on missing key" {
  let m : Map[String, Int] = { "a": 1 }
  ignore(m["missing"])
}
```
- command: moon test map1_test.mbt
- result: pass
- notes: Drift trap: `m[k]` returning the value directly and PANICKING on missing (like Python's dict[k], unlike Rust HashMap's `&v` or Go's zero-value). Use `.get()` for the Option. Key membership is `contains`, not `contains_key`.

### map-empty-literal-now-ambiguous
- conclusion: A bare `{}` for an empty map now triggers Warning [0082] ambiguous_braces; the recommended empty-map expression is `Map([])`.
- example:
```
let counter : Map[String, Array[Int]] = Map([]) // `= {}` warns
```
- command: moon check
- result: `Warning (ambiguous_braces): The '{}' is ambiguous among empty map literal, block expression, empty struct literal and empty JSON object. Use 'Map([])' for an empty map, 'TypeName::{}' for an empty struct literal, 'Json::empty_object()' for an empty JSON object, or '{ () }' for an empty block.`
- notes: Drift from the official agent guide, which still shows `let empty : Map[String, Int] = {} // preferred`. Also note `TypeName::{}` struct-literal syntax exists.

### map-patterns-and-helpers
- conclusion: Map patterns match by key: `m is { "a": 1, "zzz"? : None, .. }`; helpers `get_or_default(k, d)` and `get_or_init(k, () => ...)` exist.
- example:
```
test "map pattern matching with map patterns" {
  let m : Map[String, Int] = { "a": 1, "b": 2 }
  guard m is { "a": 1, "zzz"? : None, .. } else { fail("no match") }
  inspect(m.get_or_default("zzz", -1), content="-1")
  let counter : Map[String, Array[Int]] = Map([])
  counter.get_or_init("k", () => []).push(7)
  debug_inspect(counter, content="{ \"k\": [7] }")
}
```
- command: moon test map1_test.mbt
- result: pass
- notes: `"key"? : pattern` matches the Option result of lookup. Map patterns are always OPEN: omitting `..` still compiles and matches, but lints `Warning [0041] (missing_rest_mark): Map patterns are always open, so `..` should be added to this pattern.` — so write `..` for a clean build, it is not semantically required.

### set-basics
- conclusion: `Set[T]` is in core prelude (insertion-ordered like Map): `Set::from_array`, `add`, `remove`, `contains`, `to_array`; there is no `{1, 2}` set literal.
- example:
```
test "set basics" {
  let s : Set[Int] = Set::from_array([3, 1, 2, 3])
  inspect(s.length(), content="3")
  s.add(10)
  s.remove(1)
  debug_inspect(s.to_array(), content="[3, 2, 10]")
}
```
- command: moon test map1_test.mbt
- result: pass
- notes: Deduplicates on construction; order of `to_array` is insertion order.

### tuple-syntax
- conclusion: Tuples use `(a, b, c)`, positional access `.0`/`.1`, `let (a, b, c) = t` destructuring, nested patterns, and match on tuple patterns — all work.
- example:
```
test "tuple syntax, access, destructuring" {
  let t : (Int, String, Bool) = (1, "two", true)
  inspect(t.0, content="1")
  let (a, b, c) = t
  inspect("\{a}/\{b}/\{c}", content="1/two/true")
  let ((x, y), z) = ((1, 2), 3)
  inspect(x + y + z, content="6")
}
```
- command: moon test tup1_test.mbt
- result: pass
- notes: —

### option-sugar
- conclusion: `T?` is the Option shorthand (`Int?`, even `Int??` nests); `Some`/`None` infer; combinators `unwrap_or`, `map`, `unwrap` exist; `x is Some(3)` works as a Bool test.
- example:
```
test "option sugar and inference" {
  let a : Int? = Some(3)
  let b : Int? = None
  inspect(a.unwrap_or(0), content="3")
  inspect(b.unwrap_or(7), content="7")
  debug_inspect(a.map(x => x + 1), content="Some(4)")
  assert_true(a is Some(3))
  let c : Int?? = Some(None)
  debug_inspect(c, content="Some(None)")
}
```
- command: moon test tup1_test.mbt
- result: pass
- notes: Show for Option is deprecated — `inspect(Some(3))` warns; use `debug_inspect` or `to_repr` in interpolation.

### cf-if-match-expressions
- conclusion: `if`/`match` are expressions; match supports pattern guards `n if n > 3 =>`; an if without else is Unit-typed.
- example:
```
test "if else and match are expressions" {
  let x = if 1 > 0 { "yes" } else { "no" }
  inspect(x, content="yes")
  let y = match 5 {
    0 => "zero"
    n if n > 3 => "big"
    _ => "small"
  }
  inspect(y, content="big")
}
```
- command: moon test cf1_test.mbt
- result: pass
- notes: —

### cf-while-nobreak-not-else
- conclusion: `while` (and `for .. in`) take a `nobreak { }` block that runs when the loop exits without break and supplies the loop's value; the old keyword `else` still compiles but warns deprecated_syntax, and `break <value>` yields a value from the loop.
- example:
```
test "while loop with nobreak" {
  let mut i = 0
  let r = while i < 3 {
    i += 1
  } nobreak {
    "done at \{i}"
  }
  inspect(r, content="done at 3")
  let mut j = 0
  let r2 = while true {
    j += 1
    if j == 2 {
      break "broke at \{j}"
    }
  } nobreak {
    "never"
  }
  inspect(r2, content="broke at 2")
}
```
- command: moon test cf1_test.mbt (after `moon fmt` auto-migrated `else` → `nobreak`)
- result: pass; with `else`: `Warning (deprecated_syntax): The syntax 'else' for nobreak block in 'while' loop is deprecated. Use 'nobreak'.`
- notes: Python programmers' `while/else` intuition transfers, but the keyword is now `nobreak`. `moon fmt` migrates automatically.

### cf-range-loops-inclusive-now-lte
- conclusion: `for i in 0..<4` (exclusive) and inclusive ranges work; the inclusive spelling `0..=4` still compiles silently but `moon fmt` rewrites it to the new `0..<=4`; ranges work over other integer types (`0L..<3L`) but range operators are ONLY allowed inside `for .. in` — a standalone `(0)..<(3)` expression is Error [4137].
- example:
```
test "range iteration" {
  let a : Array[Int] = []
  for i in 0..<4 {
    a.push(i)
  }
  debug_inspect(a, content="[0, 1, 2, 3]")
  let b : Array[Int] = []
  for i in 0..<=4 {
    b.push(i)
  }
  debug_inspect(b, content="[0, 1, 2, 3, 4]")
  let c : Array[Int64] = []
  for i in 0L..<3L {
    c.push(i)
  }
  debug_inspect(c, content="[0, 1, 2]")
}
```
- command: moon test cf1_test.mbt / cf3_test.mbt; standalone range: moon check → `Error [4137]: Range operators are currently only supported in 'for .. in' loops.`
- result: pass
- notes: Rust programmers: ranges are not values/iterators; `..=` is being replaced by `..<=`. Use `Int::until` (`(1).until(10)`) to get a real Iter.

### cf-c-style-for
- conclusion: C-style `for i = 0; i < 3; i = i + 1 { }` works (note `=` not `let`, and no `++`).
- example:
```
test "c-style for loop" {
  let a : Array[Int] = []
  for i = 0; i < 3; i = i + 1 {
    a.push(i)
  }
  debug_inspect(a, content="[0, 1, 2]")
}
```
- command: moon test cf1_test.mbt
- result: pass
- notes: `i++` does not exist; loop var updates are functional (each step rebinds).

### cf-functional-for
- conclusion: The functional `for` takes multiple comma-separated state binders (`for i = 1, acc = 0; cond; updates { } nobreak { expr }`); `continue v1, v2` rebinds all state; omitting condition+updates (`for i = 0, acc = 0 { ... }`) makes an infinite loop needing explicit `break value`.
- example:
```
test "functional for with accumulators and nobreak" {
  let s = for i = 1, acc = 0; i <= 10; i = i + 1, acc = acc + i {

  } nobreak {
    acc
  }
  inspect(s, content="55")
  let r = for i = 0, acc = 0 {
    if i >= 5 {
      break acc
    }
    continue i + 1, acc + i * i
  }
  inspect(r, content="30")
}
```
- command: moon test cf1_test.mbt
- result: pass
- notes: `continue` here is NOT Go/Rust continue — it carries the next state values. `nobreak` receives the final state bindings in scope.

### cf-loop-construct-deprecated
- conclusion: The `loop <expr> { pattern => ... }` construct (both single-value and tuple forms) is DEPRECATED (Warning 0027); the recommended replacement is a functional `for` with named state binders and explicit `break`.
- example:
```
// deprecated:
//   loop (0, [1, 2, 3, 4][:]) { (acc, [x, .. rest]) => continue (acc + x, rest); (acc, []) => break acc }
// replacement that compiles clean:
test "recommended replacement for deprecated loop" {
  let sum = for acc = 0, v = [1, 2, 3, 4][:] {
    match v {
      [x, .. rest] => continue acc + x, rest
      [] => break acc
    }
  }
  inspect(sum, content="10")
}
```
- command: moon check / moon test cf2_test.mbt
- result: pass; `loop` form warns: `The syntax loop (x, y) { ... } for functional loop is deprecated. Use rewrite this as 'for i = x, j = y { ... }' ... instead.`
- notes: Anyone trained on older MoonBit tutorials (where `loop`+match was idiomatic) must switch; `moon fmt` does NOT auto-migrate `loop`.

### cf-labeled-loops
- conclusion: Loop labels are spelled `name~:` before the loop, with `break name~` / `continue name~` targeting them.
- example:
```
test "labeled loops with break and continue" {
  let hits : Array[(Int, Int)] = []
  outer~: for i in 0..<3 {
    for j in 0..<3 {
      if j > i {
        continue outer~
      }
      if i == 2 && j == 1 {
        break outer~
      }
      hits.push((i, j))
    }
  }
  debug_inspect(hits, content="[(0, 0), (1, 0), (1, 1), (2, 0)]")
}
```
- command: moon test cf2_test.mbt
- result: pass
- notes: Not Rust's `'label:` — tilde suffix instead of leading quote.

### cf-where-invariants
- conclusion: `where { ... }` after a functional for accepts ONLY the fields `proof_invariant`, `proof_yield`, `proof_reasoning` per `moon check` (bare `invariant` is Error [4195] under moon check, `reasoning` warns deprecated); a deliberately FALSE proof_invariant does not fail `moon test` or `moon test --debug` — invariants are compile-time/verification metadata, not runtime asserts in tests.
- example:
```
test "where invariants on functional for" {
  let n = 10
  let s = for i = 0, acc = 0; i < n; i = i + 1, acc = acc + i {

  } nobreak {
    acc
  } where {
    proof_invariant: 0 <= i && i <= n,
    proof_invariant: acc >= 0,
    proof_reasoning: "acc is the sum of 0..<i; i increases to n",
  }
  inspect(s, content="45")
}
```
- command: moon test cf2_test.mbt; moon check for field validation; false-invariant probe via cf4_test.mbt
- result: pass; false `proof_invariant: acc > 100` still passed moon test and moon test --debug
- notes: Two quirks: (1) `moon test` compiles files that `moon check` rejects for bad where-fields (validation differs between the two commands); (2) docs saying invariants are "checked at runtime in debug builds" did not reproduce on this toolchain.

### cf-infinite-for
- conclusion: The infinite loop is `for ;; { ... }` (with `break value` giving the loop a value); bare `for { }` is not the syntax.
- example:
```
test "infinite loop syntax for ;;" {
  let mut n = 0
  let r = for ;; {
    n += 1
    if n == 3 {
      break n * 10
    }
  }
  inspect(r, content="30")
}
```
- command: moon test cf2_test.mbt
- result: pass
- notes: Go programmers: `for { }` alone doesn't work; Rust programmers: `loop { }` is deprecated (see cf-loop-construct-deprecated).

### cf-guard
- conclusion: `guard cond else { <diverge-or-value> }` and pattern form `guard expr is Pat else { }` (bindings from Pat scope to the rest of the block) both work; `guard` WITHOUT else panics when the condition/pattern fails.
- example:
```
test "guard statements" {
  fn f(x : Int) -> String {
    guard x > 0 else { return "nonpositive" }
    guard x is (1 | 2 | 3) else { return "too big" }
    "small \{x}"
  }

  inspect(f(-1), content="nonpositive")
  inspect(f(9), content="too big")
  inspect(f(2), content="small 2")
}

test "panic guard without else fails" {
  let v : Int? = None
  guard v is Some(_)
}
```
- command: moon test cf1_test.mbt
- result: pass (guard-without-else panic observed)
- notes: This is Swift's `guard let` equivalent: spelled `guard x is Some(v) else { ... }`. There is no `guard let`.

### cf-is-expression
- conclusion: `expr is Pattern` is a Bool expression usable in any condition, and its bindings flow into the true branch, including through `&&` chains.
- example:
```
test "is expression in plain conditions" {
  let v : Int? = Some(4)
  if v is Some(x) && x > 3 {
    inspect(x, content="4")
  } else {
    fail("no")
  }
  let ok = v is Some(_)
  inspect(ok, content="true")
}
```
- command: moon test cf2_test.mbt
- result: pass
- notes: Replaces Rust's `if let`/`matches!`; also usable in `while cond` and guard.

### cf-defer
- conclusion: `defer <stmt>` exists and runs on scope exit, Go-style (LIFO after the body).
- example:
```
test "defer statement" {
  let log : Array[String] = []
  fn work(log : Array[String]) -> Unit {
    defer log.push("cleanup")
    log.push("body")
  }

  work(log)
  debug_inspect(log, content="[\"body\", \"cleanup\"]")
}
```
- command: moon test cf5_test.mbt
- result: pass
- notes: Not in many older MoonBit docs; it exists on this toolchain.

### closures-capture-by-reference
- conclusion: Closures capture `mut` locals by reference (mutations visible outside), returned closures keep independent captured state alive, and `for .. in` loop variables are captured per-iteration (each closure sees its own value).
- example:
```
test "closures capture mutable locals by reference" {
  let mut count = 0
  let inc = () => { count += 1 }
  inc()
  inc()
  inspect(count, content="2")
}

fn make_counter() -> () -> Int {
  let mut n = 0
  () => {
    n += 1
    n
  }
}

test "loop variable capture in for-in" {
  let fns : Array[() -> Int] = []
  for i in 0..<3 {
    fns.push(() => i)
  }
  debug_inspect(fns.map(f => f()), content="[0, 1, 2]")
}
```
- command: moon test clo1_test.mbt
- result: pass (make_counter counters are independent: 1,2 then 1)
- notes: No `move`/borrow rules (GC language). Loop capture gives `[0, 1, 2]`, not JS-var-style `[3, 3, 3]`. Lambda syntax: `x => e`, `(a, b) => e`, or `fn(a : Int) -> Int { }`.

### iter-lazy
- conclusion: `.iter()` yields a lazy `Iter[T]`: combinators (`map`, `filter`, `take`, ...) evaluate nothing until a consumer (`collect`, `fold`, ...) runs, and `take(2)` only forces 2 elements through upstream stages.
- example:
```
test "iter creation and lazy semantics" {
  let log : Array[Int] = []
  let it : Iter[Int] = [1, 2, 3, 4, 5]
    .iter()
    .map(x => {
      log.push(x)
      x * 10
    })
  inspect(log.length(), content="0")
  let first_two = it.take(2).collect()
  debug_inspect(first_two, content="[10, 20]")
  debug_inspect(log, content="[1, 2]")
}
```
- command: moon test iter1_test.mbt
- result: pass
- notes: Iter is ONE-SHOT: after a consumer runs (`count`, `collect`), a second consumption yields `[]` (verified: `let it = [1,2,3].iter(); it.collect()` → `[1,2,3]`, then `it.collect()` → `[]`). No `rev` (`Type Iter[Int] has no method rev` — Error 4015) and no `next`-style external iteration idiom for general use.

### iter-combinators-and-collect
- conclusion: Available combinators include `filter/map/fold(init=..)/zip/flat_map/count/take/drop/join/mapi/eachi`; `(1).until(10)` builds an Iter of Ints; `collect()` always returns Array (NOT polymorphic like Rust) — build a String with `String::from_iter`, and `join` requires ToStringView elements (map ints to strings first).
- example:
```
test "iter combinators" {
  let it = (1).until(10)
  inspect(it.filter(x => x % 3 == 0).map(x => x * x).fold(init=0, (a, b) => a + b), content="126")
  inspect([1, 2, 3].iter().count(), content="3")
  debug_inspect(
    [1, 2, 3].iter().zip([4, 5, 6].iter()).map(p => p.0 + p.1).collect(),
    content="[5, 7, 9]",
  )
  debug_inspect([[1, 2], [3]].iter().flat_map(a => a.iter()).collect(), content="[1, 2, 3]")
}

test "iter collect to types" {
  let m : Map[String, Int] = { "a": 1, "b": 2 }
  debug_inspect(m.iter().collect(), content="[(\"a\", 1), (\"b\", 2)]")
  let s : String = String::from_iter(['h', 'i'].iter())
  inspect(s, content="hi")
  inspect([1, 2, 3].iter().map(x => x.to_string()).join(","), content="1,2,3")
}
```
- command: moon test iter1_test.mbt
- result: pass (after removing rev and fixing collect-to-String: `let s : String = [...].iter().collect()` is Error 4014 Array vs String)
- notes: `Map::iter()` yields `Iter[(K, V)]` tuples; `iter2()` on arrays/strings/Iter yields `Iter2[Int, X]` for `for i, x in ...`.

### params-labeled-optional
- conclusion: Parameter kinds: positional `p : T`; required labeled `p~ : T`; optional-without-default `p? : T` (body sees `T?`); optional-with-default `p? : T = expr` (body sees `T`); call as `f(1, req=2)`, pun as `f(1, req~)`, forward an Option into an optional param with `f(opt?=myOption)`; defaults may reference earlier parameters.
- example:
```
fn describe(pos : Int, req~ : Int, opt? : Int, dft? : Int = 42) -> String {
  "\{pos}/\{req}/\{to_repr(opt)}/\{dft}"
}

fn dyn_default(x : Int, delta? : Int = x * 2) -> Int {
  x + delta
}

fn opt_forward(explicit? : Int) -> String {
  describe(0, req=0, opt?=explicit)
}

test "labeled and optional parameter calling conventions" {
  inspect(describe(1, req=2), content="1/2/None/42")
  inspect(describe(1, req=2, opt=3, dft=4), content="1/2/Some(3)/4")
  let req = 9
  inspect(describe(1, req~), content="1/9/None/42")
  inspect(dyn_default(10), content="30")
  inspect(opt_forward(), content="0/0/None/42")
  inspect(opt_forward(explicit=7), content="0/0/Some(7)/42")
}
```
- command: moon test param1_test.mbt
- result: pass
- notes: Call syntax is `label=value` (not `label~: value`, not `label: value`). `opt?=option_value` is the Option-forwarding spelling. Swift-like, alien to Rust/Go/TS.

### params-autofill-sourceloc
- conclusion: Autofilled caller location now uses the attribute form: `#callsite(autofill(loc))` on the function with `loc~ : SourceLoc` (must be a labeled `~` param, not `?`); the old `loc~ : SourceLoc = _` default still works but warns deprecated_syntax.
- example:
```
#callsite(autofill(loc))
fn where_am_i(msg : String, loc~ : SourceLoc) -> String {
  "\{msg} at \{loc}"
}

test "autofill SourceLoc argument" {
  let r = where_am_i("hello")
  assert_true(r.contains("param1_test.mbt"))
}
```
- command: moon test param1_test.mbt
- result: pass; `= _` form: `Warning (deprecated_syntax): The syntax 'p~: ArgsLoc = _' for default value ... is deprecated. Use attribute #callsite(autofill(p)) instead.`; using `loc? :` with the attribute: `Error [4115]: Auto-fill parameter must be declared as labeled parameter 'p~ : Type'`
- notes: `ArgsLoc` is also autofillable per the warning text; see `moon explain --attribute callsite`.

### using-declaration
- conclusion: `using @pkg { name, type TypeName, value }` is a top-level declaration (per-package effect: a `using` in one file makes bare names usable in other files of the same package) that lets you drop the `@pkg.` prefix; `pub using` re-exports the items as the package's own public API (they appear in pkg.generated.mbti, type re-exports listed as `pub using @liba {type Widget}`); `using ... { x as y }` aliasing works but warns deprecated; `using` inside a function body is a parse error (no local opens).
- example:
```
// moon.pkg of root package:
//   import {
//     "probeuser/probe3/liba",
//   }
// using1.mbt:
pub using @liba { greet, type Widget, answer }

pub fn use_using() -> String {
  let w = Widget::{ size: 3 }
  "\{greet("x")} \{answer} \{w.size}"
}

// using2.mbt (same package, no using of its own):
pub fn other_file_scope_check() -> String {
  greet("y") // visible: using has package-wide effect
}
```
- command: moon check; moon test using1_test.mbt; moon info
- result: pass (`use_using()` → "hi x 42 3"); local `using` → `Error [3002]: Parse error, unexpected token 'using'`; `as` alias → `Warning (deprecated_syntax): The syntax 'using @pkg {xxx as yyy}' for import foreign item with alternative name is deprecated.`
- notes: The package still must be imported in moon.pkg first — `using` only affects name resolution, not dependencies. Struct literal with explicit type uses `Widget::{ size: 3 }` syntax.

### show-vs-debug
- conclusion: `derive(Show)` is now DEPRECATED ("Use derive(Debug) or manually implement the Show trait"); interpolation `"\{x}"`, `to_string`, `println`, and `inspect` need Show, while `debug_inspect` needs Debug; a Debug-only type in interpolation is a compile error — wrap with `to_repr(x)`; custom Show is `impl Show for Q with output(self, logger) { ... }`.
- example:
```
struct P {
  x : Int
  name : String
} derive(Debug)

enum Color {
  Red
  Custom(r~ : Int, g~ : Int, b~ : Int)
} derive(Debug)

struct Q {
  x : Int
}

impl Show for Q with output(self, logger) {
  logger.write_string("Q(\{self.x})")
}

test "derive Debug and debug_inspect formatting" {
  debug_inspect(P::{ x: 1, name: "a" }, content="{ x: 1, name: \"a\" }")
  debug_inspect(Color::Custom(r=1, g=2, b=3), content="Custom(r=1, g=2, b=3)")
  inspect("\{to_repr(Color::Red)}", content="Red")
  let q = Q::{ x: 5 }
  inspect(q.to_string(), content="Q(5)")
  inspect("\{q}", content="Q(5)")
}
```
- command: moon test show1_test.mbt; moon check for the negatives
- result: pass; `derive(Show)` → `Warning (deprecated_syntax): 'derive(Show)' is deprecated.`; `"\{p}"` on Debug-only P → `Type P does not implement trait Show: no 'impl' is defined`
- notes: String's own Show ESCAPES (debug_inspect of `a"b` gives `"a\"b"` with quotes) while `to_string` is identity. Debug output format: structs `{ x: 1, name: "a" }`, labeled enum payloads `Custom(r=1, g=2, b=3)`.

### strconv-relocated
- conclusion: `@strconv.parse_int/parse_double` are deprecated in favor of `@string.parse_int/parse_double` (import `moonbitlang/core/string`), and using core packages without a moon.pkg import now warns (core_package_not_imported).
- example:
```
// moon.pkg:  import { "moonbitlang/core/string", } for "test"
test {
  inspect(@string.parse_int("123"), content="123")
  inspect(@string.parse_double("1.5"), content="1.5")
}
```
- command: moon test show1_test.mbt
- result: pass
- notes: Signature `pub fn parse_int(StringView, base? : Int) -> Int raise` — it raises on bad input rather than returning Option/Result.

### cross-target-consistency
- conclusion: The full 76-test suite (all findings above) passes identically on wasm-gc, js, and native — including Int/Int64/UInt overflow wrapping, division/modulo semantics, Float/Double Show output, and NaN/Infinity printing.
- example:
```
(whole probe3 package)
```
- command: moon test; moon test --target js; moon test --target native
- result: pass — `Total tests: 76, passed: 76, failed: 0.` on all three targets
- notes: Notably Int64 arithmetic and overflow behave identically on js (no Number precision leakage).

### iter-one-shot
- conclusion: An `Iter` is consumed by its first terminal operation: after `it.count()` (or a first `collect()`), a later `it.collect()` returns `[]` — treat Iter as single-use like a Rust iterator, not a re-invocable sequence.
- example:
```
test "iter is one-shot (consumed)" {
  let it = [1, 2, 3].iter().map(x => x * 2)
  inspect(it.count(), content="3")
  debug_inspect(it.collect(), content="[]") // consumed
}

test "iter reuse without map" {
  let it = [1, 2, 3].iter()
  debug_inspect(it.collect(), content="[1, 2, 3]")
  debug_inspect(it.collect(), content="[]")
}
```
- command: moon test extra1_test.mbt / extra2_test.mbt
- result: pass (second consumption observed empty)
- notes: Older MoonBit material described Iter as re-usable internal iteration; on this toolchain it is stateful/one-shot. Silent wrong-answer hazard (no error, just empty).

### cf-while-is-pattern
- conclusion: `while expr is Pattern { }` works, binding pattern variables in the body (idiomatic list-consumption loop over views).
- example:
```
test "is pattern in while condition" {
  let v : Array[Int] = [1, 2, 3]
  let mut view = v[:]
  let mut sum = 0
  while view is [x, .. rest] {
    sum += x
    view = rest
  }
  inspect(sum, content="6")
}
```
- command: moon test extra1_test.mbt
- result: pass
- notes: —

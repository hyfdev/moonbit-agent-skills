# Pattern matching, `is`, and `guard`

Every `mbt check` block in this file is compiled and run by the repository's verification suite (`tooling/run_checked_docs.ts`). Blocks marked `mbt nocheck` show rejected or deprecated forms and are never compiled.

## Official topic map

Search these exact official documentation topic names to route a question into this reference. A listed name is a discoverability route; the verification labels in the surrounding reference still determine whether its claim was executed or is documentation-only.

- Pattern matching forms: Pattern Matching; Simple Patterns; Array Pattern; Bitstring Pattern; Range Pattern; Map Pattern; Json Pattern; Default bindings in or-patterns; Guard condition
- is, regex, lexscan, and lexmatch: is Expression; Regex Literal Expression; Regex Literals; Regex Match Expression; Lexmatch; Lexscan; String scanners; Streaming scanners; Legacy lexical pattern syntax

## match basics

Arms are `Pattern => expression`, separated by newlines — a Rust-style trailing comma is a hard error (E3800). Guards are `x if cond =>`, or-patterns are `1 | 2 | 3`, and integer ranges match with `4..=9` (inclusive end) or `10..<100` (exclusive end).

```mbt check
test "match arms: guards, or-patterns, ranges" {
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

  assert_eq(classify(0), "zero")
  assert_eq(classify(2), "small")
  assert_eq(classify(7), "medium")
  assert_eq(classify(50), "large")
  assert_eq(classify(-2), "negative")
  assert_eq(classify(1000), "huge")
}
```

An or-pattern may provide defaults with `with` for branches that do not bind every variable. This keeps shared handling in one arm. Enclose the entire branch carrying defaults in parentheses; separate multiple assignments with commas: `A(a, b) | (B with a = 0, b = 0) => ...`. A default can be a general expression evaluated in the surrounding scope, but it cannot refer to a binder from the complete pattern or contain control flow such as `return`, `break`, `continue`, or `raise`.

```mbt check
enum ReleasePair {
  Pair(Int, Int)
  NoPair
}

fn sum_release_pair(value : ReleasePair, fallback : Int) -> Int {
  match value {
    Pair(a, b) | (NoPair with a = (fallback + 1), b = (fallback + 2)) => a + b
  }
}

test "or-pattern defaults with multiple binders" {
  assert_eq(sum_release_pair(Pair(2, 3), 10), 5)
  assert_eq(sum_release_pair(NoPair, 10), 23)
}
```

```mbt check
test "or-pattern defaults with with" {
  fn value_or_zero(value : Int?) -> Int {
    match value {
      Some(n) | (None with n = 0) => n
    }
  }

  assert_eq(value_or_zero(Some(7)), 7)
  assert_eq(value_or_zero(None), 0)
}
```

```mbt nocheck
match n {
  0 => "zero",   // WRONG: E3800 — arms end with a newline (or `;`), never a comma
  _ => "other",
}
```

## Array patterns

The rest pattern is `.. name` (or bare `..`) and may sit anywhere — start, middle, or end. The bound rest is an `ArrayView`.

```mbt check
test "array patterns: rest anywhere" {
  fn ends(xs : Array[Int]) -> Int {
    match xs {
      [] => 0
      [only] => only
      [first, .. mid, last] => first + last + mid.length()
    }
  }

  assert_eq(ends([]), 0)
  assert_eq(ends([7]), 7)
  assert_eq(ends([1, 9, 9, 9, 2]), 6)
}
```

## String patterns

Strings match as literals, as char sequences with rest parts (`[.. "pre", .. rest]` is a prefix pattern), and with char ranges like `['a'..='z', ..]`.

```mbt check
test "string patterns: literal, prefix, char range" {
  fn str_shape(s : String) -> String {
    match s {
      "exact" => "exact-literal"
      [.. "pre", .. rest] => "prefix, rest=\{rest}"
      ['a'..='z', ..] => "starts-lower"
      _ => "other"
    }
  }

  assert_eq(str_shape("exact"), "exact-literal")
  assert_eq(str_shape("prefix!"), "prefix, rest=fix!")
  assert_eq(str_shape("hello"), "starts-lower")
  assert_eq(str_shape("Hello"), "other")
}
```

## Map patterns

`{ "k": v }` requires the key and binds its value; `"k"? : mv` binds an option (`None` when absent). Map patterns are always open — end them with `..`, or the compiler warns (0041 `missing_rest_mark`).

```mbt check
test "map patterns: required and optional keys" {
  fn pick(m : Map[String, Int]) -> (Int, Int?) {
    match m {
      { "a": va, "b"? : mb, .. } => (va, mb)
      _ => (-1, None)
    }
  }

  assert_eq(pick({ "a": 1, "b": 2 }), (1, Some(2)))
  assert_eq(pick({ "a": 1 }), (1, None))
  assert_eq(pick({ "z": 0 }), (-1, None))
}
```

## Bitstring and `Json` patterns

Bitstring patterns decode fixed-width fields from byte containers and bind the remaining view with `.. rest`; suffixes such as `u16be` state width, signedness, and byte order. At a byte-aligned offset, `v128le(pattern)` extracts a 128-bit little-endian value of type `V128`. `Json` patterns use object and array shapes directly. Keep `..` in object patterns when extra fields are allowed.

```mbt check
test "bitstring and Json patterns" {
  let bytes = b"\x12\x34tail"
  guard bytes is [u16be(code), .. rest] else {
    fail("header not found")
  }
  assert_eq(code, 0x1234U)
  assert_true(rest is b"tail")

  let json : Json = { "version": "1", "items": [1, 2] }
  guard json is { "version": "1", "items": [..] as items, .. } else {
    fail("JSON shape not found")
  }
  assert_true(items is [1, 2])

  let vector_bytes = b"\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0A\x0B\x0C\x0D\x0E\x0F"
  guard! vector_bytes is [v128le(vector)]
  let extracted : V128 = vector
  ignore(extracted)
}
```

The `v128le` example is verified on Linux across wasm-gc, wasm, JavaScript, and native. **Documented, not executed on Windows native:** the current official [Bitstring Pattern reference](https://docs.moonbitlang.com/en/latest/language/fundamentals.html#bitstring-pattern) records a C-backend fallback issue for that platform.

## Regex literals and match expressions

`re"..."` creates a regex value. `input =~ (...)` searches and pattern-matches a regex composition; `as` binds the match while `before=` and `after=` bind the surrounding text. Use `lexmatch` below when several regex cases return different values.

```mbt check
const PATTERN_IDENT_START = re"[A-Za-z_]"
const PATTERN_IDENT_CONT = re"[A-Za-z0-9_]*"

test "regex match expression" {
  let input = " name=42"
  guard input =~ (
    (PATTERN_IDENT_START + PATTERN_IDENT_CONT) as ident,
    before=head,
    after=tail,
  ) else {
    fail("identifier not found")
  }
  assert_true(head is " ")
  assert_true(ident is "name")
  assert_true(tail is "=42")
}
```

## `lexmatch` for in-memory regular-expression cases

Use `lexmatch` for a `String` or `StringView`. Each case uses a regex constant expression; `as` binds matched text and `before=` / `after=` bind the surrounding text. The default `first` strategy chooses the first source-order case that can match, even when its match starts later in the input than a subsequent case's match. `with longest` chooses the longest matching prefix; every regex must start with `^`, and source order breaks equal-length ties.

```mbt check
fn pattern_find_eol(s : StringView) -> Int? {
  lexmatch s {
    (re"\r?\n", before=line, after=_) => Some(line.length())
    _ => None
  }
}

fn pattern_longest_prefix(s : StringView) -> Int? {
  lexmatch s with longest {
    (re"^a", after=_) => Some(1)
    (re"^ab", after=_) => Some(2)
    _ => None
  }
}

test "lexmatch finds a line and chooses the longest prefix" {
  assert_eq(pattern_find_eol("abc\ndef"[:]), Some(3))
  assert_eq(pattern_find_eol("abc"[:]), None)
  assert_eq(pattern_longest_prefix("ab"[:]), Some(2))
}
```

```mbt check
test "lexmatch case priority and longest" {
  let selected = lexmatch "ab" {
    (re"b", before=_, after=_) => 1
    (re"a", before=_, after=_) => 2
    _ => 0
  }
  assert_eq(selected, 1)
  let longest = lexmatch "ab" with longest {
    (re"^a", after=_) => 1
    (re"^ab", after=_) => 2
    _ => 0
  }
  assert_eq(longest, 2)
}
```

A catch-all is required only when the regex cases leave inputs uncovered. The compiler warns with `unused_lexcase` (E0090) for unreachable cases. Guards, Bytes, and BytesView are unsupported. The fixture `lang-lexmatch-cases` verifies exhaustive cases, rejects an unreachable fallback with warnings denied, and verifies the replacement.

The old string-piece patterns have been removed; `lang-removed-lexical-pattern` proves the replacement. **Documented, not executed for the removed `lexmatch?` boolean form:** the [pinned legacy-syntax reference](https://github.com/moonbitlang/moonbit-docs/blob/8d9f3ba206eb17f80ee1836e4c1139068d1351b5/next/language/fundamentals.md#legacy-lexical-pattern-syntax) records that removal; this fixture covers only string-piece cases. Use regex-case `lexmatch` for case selection and `=~` for a boolean search. The fixture `lang-dep-lexmatch` checks the current String/StringView forms and rejects String inputs to `lexscan`.

## `lexscan` for scanner cursors

`lexscan` accepts `@lexbuf.StringScanner`, `@lexbuf.Lexbuf`, or `@lexbuf.AsyncLexbuf`, from a direct `moonbitlang/core/lexbuf` import. It consumes a token and advances the scanner's cursor. Every regex starts with `^`; `before=` and `after=` are unsupported. `first` and `longest` use the case-selection rules above. An unmatched `_` case does not consume input, so a caller must stop or otherwise advance before retrying.

`StringScanner::{ data: text[:], cursor: 0 }` stores a cursor in UTF-16 code units relative to its data view. `Lexbuf::from_fn` obtains successive `String?` chunks; patterns can span chunk boundaries. The `lang-lexscan-scanners` fixture runs both scanners and proves cursor progress, cross-chunk matches, and EOF behavior. **Documented, not executed for asynchronous chunk sources:** `AsyncLexbuf` uses the same cursor behavior with an async source, so scanning it requires async code; see the [pinned streaming-scanner reference](https://github.com/moonbitlang/moonbit-docs/blob/8d9f3ba206eb17f80ee1836e4c1139068d1351b5/next/language/fundamentals.md#streaming-scanners).

## `is` expressions

`expr is Pattern` is a Bool-valued expression, and its bindings flow into the rest of the condition and into the taken branch — `if x is Some(v) && v > 10 { ... v ... }` works, and so does `while cur is Some(n) && ...`.

```mbt check
test "is expressions bind into conditions and branches" {
  fn describe(x : Int?) -> String {
    if x is Some(v) && v > 10 {
      "big \{v}"
    } else {
      "other"
    }
  }

  assert_eq(describe(Some(11)), "big 11")
  assert_eq(describe(Some(3)), "other")
  assert_true("hello" is ['h', ..])
  let mut total = 0
  let mut cur : Int? = Some(3)
  while cur is Some(n) && n > 0 {
    total = total + n
    cur = Some(n - 1)
  }
  assert_eq(total, 6)
}
```

## guard statements

`guard cond else { ... }` and `guard x is Pattern else { ... }` are early exits: on failure the `else` block runs, and it may end with an expression (returned from the enclosing function) or an explicit `return`. An ordinary guard without `else` must be provably exhaustive; otherwise it emits E0087 because failure would implicitly terminate the program. Write `guard!` when termination on failure is intentional; it cannot have an `else`. On an exhaustive condition or pattern, use plain `guard` without `else`: a redundant bang emits E0088 and a redundant `else` emits E0089.

```mbt check
test "guard: boolean and pattern forms" {
  fn first_or(xs : Array[Int], fallback : Int) -> Int {
    guard xs is [first, ..] else { fallback }
    first
  }

  fn positive_or_zero(n : Int) -> Int {
    guard n > 0 else { return 0 }
    n
  }

  fn require_some(value : Int?) -> Int {
    guard! value is Some(result)
    result
  }

  assert_eq(first_or([9, 8], 0), 9)
  assert_eq(first_or([], 0), 0)
  assert_eq(positive_or_zero(5), 5)
  assert_eq(positive_or_zero(-4), 0)
  assert_eq(require_some(Some(7)), 7)
}
```

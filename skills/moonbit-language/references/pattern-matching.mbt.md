# Pattern matching, `is`, and `guard`

Every `mbt check` block in this file is compiled and run by the repository's verification suite (`tooling/run_checked_docs.py`). Blocks marked `mbt nocheck` show rejected or deprecated forms and are never compiled.

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

`guard cond else { ... }` and `guard x is Pattern else { ... }` are early exits: on failure the `else` block runs, and it may end with an expression (returned from the enclosing function) or an explicit `return`. A `guard x is Pattern` **without** `else` aborts the program when the pattern does not match — only drop the `else` when a mismatch is a genuine bug.

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

  assert_eq(first_or([9, 8], 0), 9)
  assert_eq(first_or([], 0), 0)
  assert_eq(positive_or_zero(5), 5)
  assert_eq(positive_or_zero(-4), 0)
}
```

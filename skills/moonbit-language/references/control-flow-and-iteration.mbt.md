# Control flow and iteration

Every `mbt check` block in this file is compiled and run by the repository's verification suite (`tooling/run_checked_docs.ts`). Blocks marked `mbt nocheck` show rejected or deprecated forms and are never compiled.

## `if` and `match` are expressions

Both yield a value. An `if` without `else` is `Unit`-typed. (Full pattern syntax lives in pattern-matching.mbt.md.)

```mbt check
test "control flow: if and match are expressions" {
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

## `while`

`while` takes an optional trailing `nobreak { }` block that runs when the loop ends without a `break` and supplies the loop's value; `break <value>` yields a value from the loop. The old keyword for that block was `else` — it is deprecated, write `nobreak`. A `while cond is Pattern { }` binds the pattern in the body (idiomatic for consuming a view).

```mbt check
test "control flow: while with nobreak and break value" {
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

test "control flow: while with an is-pattern" {
  let mut view = [1, 2, 3][:]
  let mut sum = 0
  while view is [x, .. rest] {
    sum += x
    view = rest
  }
  inspect(sum, content="6")
}
```

## `for`

C-style `for i = 0; i < 3; i = i + 1 { }` uses `=` (not `let`) and has no `++`. `for .. in` ranges over `0..<n` (exclusive) or `0..<=n` (inclusive); the old inclusive spelling `0..=n` still compiles but `moon fmt` rewrites it. Range operators are allowed **only** inside `for .. in` — a standalone `(0)..<(3)` is Error [4137]; use `(1).until(10)` for a real `Iter`.

```mbt check
test "control flow: C-style and range for loops" {
  let cstyle : Array[Int] = []
  for i = 0; i < 3; i = i + 1 {
    cstyle.push(i)
  }
  debug_inspect(cstyle, content="[0, 1, 2]")
  let ex : Array[Int] = []
  for i in 0..<4 {
    ex.push(i)
  }
  debug_inspect(ex, content="[0, 1, 2, 3]")
  let inc : Array[Int] = []
  for i in 0..<=4 {
    inc.push(i)
  }
  debug_inspect(inc, content="[0, 1, 2, 3, 4]")
}
```

`for .. in` also walks collections, and a two-variable form gives the index (or key) alongside the value.

```mbt check
test "control flow: for-in over collections" {
  let arr = [10, 20, 30]
  let seen : Array[(Int, Int)] = []
  for idx, val in arr {
    seen.push((idx, val))
  }
  debug_inspect(seen, content="[(0, 10), (1, 20), (2, 30)]")
  let m : Map[String, Int] = { "a": 1, "b": 2 }
  let pairs : Array[(String, Int)] = []
  for k, v in m {
    pairs.push((k, v))
  }
  debug_inspect(pairs, content="[(\"a\", 1), (\"b\", 2)]")
}
```

## List comprehensions

An ordinary comprehension uses `[ for ... => ... ]` and builds the collection selected by the expected type. With no stronger context it builds an `Array`; an expected `String` consumes generated `Char` values. This differs from the lazy Iter comprehension `[| for ... => ... |]` covered below.

```mbt check
test "control flow: eager list comprehensions" {
  let squares = [ for x in 1..<=4 => x * x ]
  assert_eq(squares, [1, 4, 9, 16])
  let text : String = [ for x in 0..<3 => (x + 'a').unsafe_to_char() ]
  assert_eq(text, "abc")
}
```

## Functional `for` with accumulators

A `for` can carry comma-separated state binders: `for i = 1, acc = 0; cond; i = ..., acc = ... { } nobreak { acc }`. Here `continue v1, v2` rebinds **all** state (it is not Go/Rust's plain `continue`); omitting the condition and updates makes an infinite loop that needs an explicit `break value`. An optional `where { proof_invariant: ..., proof_reasoning: ... }` records verification metadata — it is compile-time documentation, not a runtime assert.

```mbt check
test "control flow: functional for with accumulators" {
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

test "control flow: where records invariants" {
  let n = 10
  let total = for i = 0, acc = 0; i < n; i = i + 1, acc = acc + i {

  } nobreak {
    acc
  } where {
    proof_invariant: 0 <= i && i <= n,
    proof_reasoning: "acc is the sum of 0..<i",
  }
  inspect(total, content="45")
}
```

## Infinite and labeled loops

The infinite loop is `for ;; { ... }` (bare `for { }` is not valid); `break value` gives it a value. Loop labels are written `name~:` before the loop, targeted by `break name~` / `continue name~` (not Rust's `'label`).

```mbt check
test "control flow: infinite and labeled loops" {
  let mut nrun = 0
  let stopped = for ;; {
    nrun += 1
    if nrun == 3 {
      break nrun * 10
    }
  }
  inspect(stopped, content="30")
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

## The deprecated `loop`

```mbt nocheck
loop (0, xs) { (acc, [x, .. rest]) => continue (acc + x, rest); (acc, []) => break acc }
// DEPRECATED: Warning 0027 — rewrite as `for acc = 0, v = xs { match v { ... } }` with explicit break
```

## `guard` (recap)

`guard cond else { ... }` and `guard x is Pattern else { ... }` are early exits, and a `guard ... is` **without** `else` panics on mismatch — see pattern-matching.mbt.md for the full treatment.

## Closures

Closures capture `mut` locals by reference (mutations are visible outside), `for .. in` loop variables are captured per iteration, and a returned closure keeps its own captured state alive. Lambda syntax is `x => e`, `(a, b) => e`, or `fn(a : Int) -> Int { }`; there is no `move` and no borrow checker.

```mbt check
test "control flow: closures capture by reference" {
  let mut count = 0
  let inc = () => { count += 1 }
  inc()
  inc()
  inspect(count, content="2")
  let fns : Array[() -> Int] = []
  for i in 0..<3 {
    fns.push(() => i) // captured per iteration
  }
  debug_inspect(fns.map(f => f()), content="[0, 1, 2]")
}

test "control flow: a returned closure keeps its own state" {
  fn make_counter() -> () -> Int {
    let mut n = 0
    () => {
      n += 1
      n
    }
  }

  let c = make_counter()
  inspect(c(), content="1")
  inspect(c(), content="2")
  inspect(make_counter()(), content="1") // fresh, independent state
}
```

## `Iter`

`[| 1, 2, 3 |]` is the explicit `Iter` literal introduced in 0.10.4; spreads and comprehensions work inside `[| .. |]`. Use it when constructing an `Iter` rather than relying on the deprecated expected-type overloading of an array-spread literal. `.iter()` also yields a lazy `Iter[T]`: combinators (`map`, `filter`, `take`, `zip`, `flat_map`) evaluate nothing until a consumer (`collect`, `count`, `fold`) runs, and `take(n)` forces only what it needs upstream. `collect()` always returns an `Array` (not polymorphic like Rust) — use `String::from_iter` for text. `arr.iter2()` yields an `Iter2`, consumed as `for i, x in ...`. An `Iter` is **one-shot**: after its first terminal operation it yields nothing more.

```mbt check
test "control flow: explicit Iter literals" {
  let direct : Iter[Int] = [| 1, 2, 3 |]
  debug_inspect(direct.collect(), content="[1, 2, 3]")
  let spread = [| 0, ..[1, 2].iter(), 3 |]
  debug_inspect(spread.collect(), content="[0, 1, 2, 3]")
}
```

```mbt check
test "control flow: Iter literal evaluation order" {
  let direct_log : Array[Int] = []
  let direct = [|
    { direct_log.push(1); 10 },
    { direct_log.push(2); 20 },
  |]
  debug_inspect(direct_log, content="[1, 2]") // plain elements are eager
  debug_inspect(direct.collect(), content="[10, 20]")

  let spread_log : Array[Int] = []
  let make_spread = () => {
    spread_log.push(0)
    [1, 2].iter().map(x => {
      spread_log.push(x)
      x * 10
    })
  }
  let spread = [| ..make_spread() |]
  debug_inspect(spread_log, content="[0]") // the spread expression is eager
  debug_inspect(spread.collect(), content="[10, 20]")
  debug_inspect(spread_log, content="[0, 1, 2]") // its iterator body stays lazy

  let comprehension_log : Array[Int] = []
  let comprehension = [|
    for x in [1, 2] => {
      comprehension_log.push(x)
      x * 10
    }
  |]
  debug_inspect(comprehension_log, content="[]")
  debug_inspect(comprehension.collect(), content="[10, 20]")
  debug_inspect(comprehension_log, content="[1, 2]")
}
```

```mbt check
test "control flow: Iter is lazy" {
  let log : Array[Int] = []
  let it = [1, 2, 3, 4, 5]
    .iter()
    .map(x => {
      log.push(x)
      x * 10
    })
  inspect(log.length(), content="0") // nothing forced yet
  debug_inspect(it.take(2).collect(), content="[10, 20]")
  debug_inspect(log, content="[1, 2]") // only 2 elements forced
}

test "control flow: Iter combinators and one-shot consumption" {
  let it = (1).until(10)
  inspect(
    it.filter(x => x % 3 == 0).map(x => x * x).fold(init=0, (a, b) => a + b),
    content="126",
  )
  debug_inspect(
    [1, 2, 3].iter().zip([4, 5, 6].iter()).map(p => p.0 + p.1).collect(),
    content="[5, 7, 9]",
  )
  inspect(String::from_iter(['h', 'i'].iter()), content="hi")
  let indexed : Array[(Int, Int)] = []
  for i, x in [7, 8].iter2() { // Iter2: index and value
    indexed.push((i, x))
  }
  debug_inspect(indexed, content="[(0, 7), (1, 8)]")
  let once = [1, 2, 3].iter()
  debug_inspect(once.collect(), content="[1, 2, 3]")
  debug_inspect(once.collect(), content="[]") // already consumed
}
```

## `defer`

`defer <stmt>` runs on **block** exit — not at function exit as in Go. An inner block's `defer` fires when that block ends, and within one block defers run last-in-first-out.

```mbt check
test "control flow: defer is block-scoped and LIFO" {
  let log : Array[String] = []
  fn demo(log : Array[String]) -> Unit {
    defer log.push("deferred-first")
    log.push("body-1")
    if true {
      defer log.push("deferred-inner")
      log.push("inner-body")
    }
    defer log.push("deferred-second")
    log.push("body-2")
  }

  demo(log)
  inspect(
    log.join(","),
    content="body-1,inner-body,deferred-inner,body-2,deferred-second,deferred-first",
  )
}
```

# Attributes

Every `mbt check` block in this file is compiled and run by the repository's verification suite (`tooling/run_checked_docs.ts`). Blocks marked `mbt nocheck` show rejected or deprecated forms and are never compiled. Attributes are written `#name(...)` on the line above a declaration; run `moon explain --attribute <name>` for the authoritative per-attribute reference.

## Official topic map

Search these exact official documentation topic names to route a question into this reference. A listed name is a discoverability route; the verification labels in the surrounding reference still determine whether its claim was executed or is documentation-only.

- Language attributes: Deprecated Attribute; Alert Attribute; Alias Attribute; `label_migration` Attribute; Visibility Attribute; Internal Attribute; Doc Hidden Attribute; Warnings Attribute; Must Implement One Attribute; Inline Attribute; `as_free_fn` Attribute; Skip Attribute; Coverage Skip Attribute; Configuration attribute; Module attribute; Attribute

## The catalog

`moon explain --attribute` lists these attribute names. The FFI attributes (`#external`, `#borrow`, `#owned`) are covered in the async-and-ffi reference.

| Attribute | Purpose |
| --- | --- |
| `#cfg` | conditional compilation on a target predicate |
| `#deprecated` | mark a symbol deprecated; using it warns |
| `#alias` | add an alternate callable name (also trait/operator aliases) |
| `#warnings` | enable/disable/promote warnings for one declaration |
| `#alert` | attach a custom alert category that fires on use |
| `#skip` | exclude a `test` from the run (still type-checked) |
| `#inline`, `#inline(never)` | inlining hints |
| `#coverage.skip` | exclude from coverage accounting |
| `#external`, `#borrow`, `#owned` | FFI (see async-and-ffi) |
| `#as_free_fn` | expose a method as a free function, optionally with a distinct name, visibility, or deprecation |
| `#callsite` | fill supported location values at the callsite |
| `#doc(hidden)` | keep a public declaration out of generated API documentation |
| `#internal` | warn when an internal API is used from another module |
| `#label_migration` | stage optional/labelled-argument changes with callsite warnings |
| `#module` | name the JavaScript module that supplies an `extern "js"` binding |
| `#must_implement_one` | require a trait implementation to replace at least one default method |
| `#visibility` | warn about uses that a planned `readonly` or `abstract` change will invalidate |

## Migration, exposure, and trait-contract attributes

**Documented, not executed:** the forms below come from the pinned official [attribute reference](https://docs.moonbitlang.com/en/latest/language/attributes.html). They affect cross-package/module callers, generated docs, JavaScript linking, or intentionally rejected implementations, so re-run a minimal cross-boundary example before relying on them under another compiler version.

- `#label_migration(param, fill=true|false, msg="...")` stages adding or removing an optional argument. `allow_positional=true` temporarily accepts a labelled parameter positionally with a warning; `alias=new_name` accepts a renamed label during migration.
- `#visibility(change_to="readonly"|"abstract", "message")` marks a fully visible type that will become less visible. It warns at external construction/mutation sites for `readonly`, and additionally at external pattern/field access sites for `abstract`.
- `#internal(category, "message")` marks a function, type, or trait as module-internal. Cross-module use emits the corresponding alert category; it does not make the item inaccessible.
- `#doc(hidden)` hides a still-public declaration from generated documentation.
- `#must_implement_one` on a trait requires each implementation to replace at least one default method. `#must_implement_one(f, g)` narrows that requirement to the named group, and multiple attributes can require several groups independently.
- `#as_free_fn` makes a method available as a free function. `#as_free_fn(dec, visibility="pub", deprecated="...")` selects its free-function name, visibility, and separate migration warning.
- `#module("math-utils")` on an `extern "js"` declaration binds its foreign symbol through that CommonJS/ESM module rather than the ambient JavaScript scope.

## `#cfg`: conditional compilation

`#cfg(<predicate>)` on a top-level declaration (functions, externs, even `test` blocks) keeps it only when the predicate holds. Predicates are `true` / `false`, `target="<t>"` where `<t>` is one of `js`, `wasm`, `wasm-gc` (hyphenated), `native`, `llvm`, and the combinators `not(...)`, `all(...)`, `any(...)`. Gating is real: an `extern "js"` — which hard-errors on every non-js backend — compiles everywhere when gated with `#cfg(target="js")`, and two same-named functions can coexist under complementary predicates.

```mbt check
#cfg(target="js")
extern "js" fn attr_js_add(a : Int, b : Int) -> Int = "(a, b) => a + b"

#cfg(target="js")
pub fn attr_sum3(x : Int) -> Int {
  attr_js_add(x, 3) // JS implementation, only on the js target
}

#cfg(not(target="js"))
pub fn attr_sum3(x : Int) -> Int {
  x + 3 // plain MoonBit on every other target
}

#cfg(any(target="js", target="wasm", target="wasm-gc", target="native"))
pub fn attr_always() -> Int {
  1
}

#cfg(all(true, not(false)))
pub fn attr_all_demo() -> Int {
  2
}

test "attr cfg gating" {
  assert_eq(attr_sum3(2), 5) // 5 on every target
  assert_eq(attr_always(), 1)
  assert_eq(attr_all_demo(), 2)
}
```

**Gotcha:** an unknown value or key is *not* rejected — `#cfg(target="bogus")` and `#cfg(feature="x")` silently evaluate to `false` and the declaration vanishes. A typo therefore drops code with no error at the attribute; the only symptom is a "value not found" error at the use site.

## `#deprecated` and `#alias`

`#deprecated("msg")` fires `Warning (deprecated): msg` at every use site (defining it is silent). `#alias(name)` adds a second callable name; add `deprecated` to make the alias itself warn, so the two together are the standard rename path (keep the old name working while nudging callers).

```mbt check
#deprecated("Use attr_new_add instead")
pub fn attr_old_add(a : Int, b : Int) -> Int {
  a + b
}

#alias(attr_plus)
pub fn attr_new_add(a : Int, b : Int) -> Int {
  a + b
}

test "attr alias is a real callable name" {
  assert_eq(attr_new_add(1, 2), 3)
  assert_eq(attr_plus(1, 2), 3) // the alias
  // calling attr_old_add here would warn: "Warning (deprecated): Use attr_new_add instead"
}
```

`#alias` also spells trait aliases (`#alias(Brief)` on a trait) and operator aliases (`#alias("_[_]")`), and takes `visibility="pub|priv"`.

## `#warnings` and `#alert`

`#warnings("<spec>")` tunes warnings for one declaration: `-name` disables and `+name` enables. **Documented, not executed as a deprecation diagnostic:** the [`0.10.4` release notes](https://www.moonbitlang.com/updates/2026/07/13/moonbit-0-10-4-release) say the still-working `@name` error-promotion switch is planned for deprecation; use moon's `--deny-warn` in CI instead. `#alert(category, "msg")` attaches a custom alert that fires as `Warning (alert_<category>)` on use.

```mbt check
#warnings("-unused_value")
fn attr_has_unused() -> Int {
  let x = 42 // unused; without this attribute it would be Warning [0002] (unused_value)
  7
}

#alert(experimental, "This API may change.")
pub fn attr_experimental(x : Int) -> Int {
  x // using this elsewhere warns: "Warning (alert_experimental): This API may change."
}

test "attr warnings and alert" {
  assert_eq(attr_has_unused(), 7)
}
```

One catch worth knowing: `#alert(unsafe, ...)` produces **no** warning by default — the `alert_unsafe` category is off unless you pass `--warn-list "+alert_unsafe"`.

## `#skip`, `#inline`, `#coverage.skip`

`#skip("reason")` on a test excludes it from the run while still type-checking it (re-include with the CLI's `--include-skipped`). `#inline` / `#inline(never)` are inlining hints and `#coverage.skip` drops a function from coverage; all three compile silently.

```mbt check
#inline
pub fn attr_add_one(x : Int) -> Int {
  x + 1
}

#coverage.skip
pub fn attr_not_covered() -> Int {
  9
}

test "attr inline and coverage skip compile" {
  assert_eq(attr_add_one(4), 5)
  assert_eq(attr_not_covered(), 9)
}

#skip("demonstrating skip")
test "attr this test never runs" {
  fail("skipped body is type-checked but not executed")
}
```

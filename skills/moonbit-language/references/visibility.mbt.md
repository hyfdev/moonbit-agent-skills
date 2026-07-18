# Visibility

Every `mbt check` block in this file is compiled and run by the repository's verification suite (`tooling/run_checked_docs.ts`). Blocks marked `mbt nocheck` show rejected or deprecated forms and are never compiled. Cross-package rules cannot run inside one package, so the allowed/rejected matrix below is enforced by the two-package fixture `lang-visibility-cross-package` in this repository's verification suite.

## Official topic map

Search these exact official documentation topic names to route a question into this reference. A listed name is a discoverability route; the verification labels in the surrounding reference still determine whether its claim was executed or is documentation-only.

- Prelude, using, visibility, and cross-package semantics: Prelude and builtin names; Using; Access Control; Functions; Aliases; Types; Traits; Trait Implementations

## Functions

A plain `fn` is package-private; `pub fn` is callable from other packages. Inside the declaring package, everything below is fully accessible — the fence proves all forms compile and work locally.

## Types: four levels

`priv` < default (abstract) < `pub` (read-only) < `pub(all)`:

- `priv struct` — the name is invisible outside the package.
- `struct` with no modifier — **abstract**: outside packages can use the name (e.g. hold a value returned by your `pub fn`) but see no fields or constructors.
- `pub struct` — **read-only**: outside packages can read fields but cannot construct values. Rust habit alert: bare `pub` does *not* allow external construction.
- `pub(all) struct` — fully open: external construction and (for `mut` fields) mutation.

```mbt check
priv struct VisHidden {
  x : Int
}

struct VisDefault {
  x : Int
}

pub struct VisRead {
  x : Int
}

pub(all) struct VisAll {
  mut x : Int
}

fn vis_secret() -> Int {
  1
}

pub fn vis_open_fn() -> Int {
  vis_secret() + 1
}

pub fn vis_make_default() -> VisDefault {
  { x: 10 }
}

pub fn vis_make_read() -> VisRead {
  { x: 20 }
}

test "inside the package every visibility level is fully usable" {
  assert_eq(vis_open_fn(), 2)
  assert_eq(vis_make_default().x, 10)
  assert_eq(vis_make_read().x, 20)
  let h = VisHidden::{ x: 1 }
  assert_eq(h.x, 1)
  let a : VisAll = { x: 1 }
  a.x = 5
  assert_eq(a.x, 5)
}
```

## What another package can do

For a package imported as `@vis`:

| Declaration | Use the name | Read fields | Construct / mutate |
| --- | --- | --- | --- |
| `priv struct VisHidden` | no (E4032) | no | no |
| `struct VisDefault` | yes | no (E4028) | no |
| `pub struct VisRead` | yes | yes | no (E4036) |
| `pub(all) struct VisAll` | yes | yes | yes (mutation via `mut` fields) |
| `fn vis_secret` | no (E4021) | — | — |
| `pub fn vis_open_fn` | yes | — | — |

```mbt nocheck
// In a different package that imports this one as @vis:
@vis.vis_open_fn()                     // ok
let d : @vis.VisDefault = @vis.vis_make_default() // ok: abstract name is usable
let r = @vis.vis_make_read()
r.x                                    // ok: pub fields are readable
let a : @vis.VisAll = { x: 1 }         // ok: pub(all) constructs externally

@vis.vis_secret()                      // WRONG: E4021 — plain fn is package-private
@vis.vis_make_default().x              // WRONG: E4028 — abstract type, fields hidden
let bad : @vis.VisRead = { x: 99 }     // WRONG: E4036 — cannot create values of a read-only type
let bad2 : @vis.VisHidden = ...        // WRONG: E4032 — priv type name is undefined outside
```

## Prelude, source-level `using`, and re-export

Unqualified names resolve in the current package and the prelude; compiler-known types such as `Int` are builtins, not members of a fictional `@builtin` package. Package imports are configured in `moon.pkg`, but MoonBit source selects names with `using @pkg {name, trait TraitName, type TypeName}`. Add `pub` to re-export those names so a downstream package can access them through the re-exporting package. The three-package `lang-using-reexport` fixture verifies the boundary on every pinned target.

```mbt nocheck
// In a package whose moon.pkg imports the dependency as @origin:
pub using @origin {increment, trait Service, type Handle}
```

## Aliases

Function and method aliases follow the original declaration's visibility unless `#alias(..., visibility="pub"|"priv")` overrides it. A Type alias and a source-level `using` declaration are package-private by default; prefix either with `pub` to expose or re-export it. The attribute syntax and deprecation options are in attributes.mbt.md.

## Trait Implementations

An implementation has its own cross-package visibility. Use `pub impl Trait for Type ...` when downstream packages must treat the type as implementing that trait; a plain `impl` is visible only inside the defining package. `pub extend` separately controls whether downstream code receives the selected dot-call methods—public conformance and public dot-call attachment are related but distinct decisions.

Coherence limits where declarations may live: a regular method belongs in the type's package; a method written for a foreign or builtin type is a package-local method. A trait implementation may be declared only by the package that owns the type or the package that owns the trait. This prevents a third package from changing the meaning of an existing type/trait pair.

## Traits: `pub` is sealed, `pub(open)` is implementable

A `pub trait` can be *used* by other packages but not *implemented* by them (E4145). External implementations require `pub(open)`.

```mbt check
pub(open) trait VisPluggable {
  tag(Self) -> Int
}

pub trait VisSealed {
  code(Self) -> Int
}
```

```mbt nocheck
// In a different package:
impl @vis.VisPluggable for Mine with tag(self) { 1 } // ok: pub(open) accepts external impls
impl @vis.VisSealed for Mine with code(self) { 1 }   // WRONG: E4145 — cannot implement a readonly (sealed) trait
```

## Modifiers that do not exist

`pub(readonly)` is gone — plain `pub` on a type already means read-only. `pub(open)` applies to traits only; on a struct it is rejected. The modifier matrix: types take `priv` / default / `pub` / `pub(all)`; traits take `priv` / default / `pub` / `pub(open)`.

```mbt nocheck
pub(readonly) struct S { x : Int } // WRONG: E4002 — removed; plain `pub` already gives read-only semantics
pub(open) struct T { x : Int }     // WRONG: E4002 — pub(open) is for traits only
```

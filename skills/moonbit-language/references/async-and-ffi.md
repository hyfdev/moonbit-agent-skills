# Async and FFI declarations

> Coverage note: snippets in this file were hand-verified against the pinned toolchain on the targets stated per snippet, but are NOT re-executed by CI (async needs external deps; FFI is target-specific). On any toolchain version mismatch, re-verify before relying on them.

This file is plain Markdown, not a checked `.mbt.md`: its code blocks are illustrative and are **not** run by the verification suite. Every snippet below was verified by hand against the pinned toolchain; each block notes the target it was checked on. Build, link, and dependency wiring (`moon.pkg` imports, `is-main`, `supported_targets`, stub sources, `--target`) is the **moonbit-toolchain** skill — this file covers only what the language accepts.

## Official topic map

Search these exact official documentation topic names to route a question into this reference. A listed name is a discoverability route; the verification labels in the surrounding reference still determine whether its claim was executed or is documentation-only.

- FFI type and ownership attributes: External Attribute; Borrow and Owned Attribute
- FFI declarations and backend types: Foreign Function Interface (FFI); Backends; Declare Foreign Type; Declare Foreign Function; Types; Callbacks; Customize integer value of constant enum
- FFI exports and lifetime management: Export Functions; Lifetime management; Lifetime management of external object; Lifetime management of MoonBit object; The calling convention of reference counting; The managed types; The borrow and owned attribute
- Async language and runtime boundary: Async programming support; Getting started; Async function; Structured concurrency and task group; Cancellation makes asynchronous program modular; Interacting with the world; JavaScript support; Experimental Wasm1 support

## Async syntax

The async forms are `async fn f(...)`, `async test "..."`, and the async entry point `async fn main` (no parameter list, like `fn main`). **There is no `await` keyword** — an async call is written as an ordinary call; using `await` is Error [4021] ("The value identifier await is unbound"). An async call must still sit inside an async context (`async fn` / `async test`); calling one from a plain function is Error [4149] ("cannot call async function in non-async function").

```moonbit
// declaration forms; verified on native + js
async fn aid(x : Int) -> Int {
  x + 1
}

async fn main {
  @async.sleep(10)  // an async call — no `await`
  println("done")
}
```

An `async fn` *declaration* compiles with only the core standard library; if its body calls nothing async you get `Warning (unused_async)` ("This `async` annotation is useless."). Async functions may raise by default — a body can `fail(...)` with no `raise` in the signature; `-> T raise` and `-> T noraise` are also accepted.

### What actually runs needs `moonbitlang/async`

Declaring async functions is free, but **running** async code — `async test`, `async fn main`, and every concurrency/timer primitive (`@async.sleep`, task groups) — requires the `moonbitlang/async` package to be imported. Without it, `async test` and `async fn main` are Error [4037] ("package moonbitlang/async is not imported"). The core standard library alone cannot execute async code.

```moonbit
// verified on native (pass) and js (pass); wasm-gc still skips this test because
// async 0.20.2's experimental WebAssembly support is Wasm1 (`--target wasm`), not wasm-gc
async test "async sleep and call" {
  @async.sleep(5)
  assert_eq(aid(1), 2)
}
```

Gotcha: a `moon.pkg` `import { ... } for "test"` block applies only to blackbox `*_test.mbt` files. An `async test` in a regular `.mbt` file needs a plain (unscoped) import block instead.

### `moonbitlang/async` 0.20.2 Wasm1 boundary

**Documented, not executed against the external package:** the [0.10.4 release notes](https://www.moonbitlang.com/updates/2026/07/13/moonbit-0-10-4-release) add experimental Wasm1 support to `moonbitlang/async` 0.20.2 with the same API signatures and behavior as its native backend. These `.wasm` files currently require the latest `moonrun`; other WebAssembly runtimes are not supported. The artifact is otherwise cross-platform wherever that `moonrun` is available, without rebuilding for each operating system or hardware architecture.

**Documented, not executed against the external package:** this is experimental compatibility, not a backward-compatibility promise for binaries built with an older async package. The Wasm1 backend also does not yet support `@websocket`, `@fs.Watcher`, or `@fs.realpath`; the release describes support for those APIs as future work. Check the installed package documentation before relying on a newer runtime or wider API coverage.

### Structured concurrency

Concurrency is structured through a task group; the group value comes from `@async.with_task_group`, which returns its body's value. `spawn_bg` starts a background task; `spawn` returns a handle with `.wait()`.

```moonbit
// verified on native: prints "B after 10ms", then "A after 30ms", then "done"
async fn main {
  @async.with_task_group(group => {
    group.spawn_bg(() => {
      @async.sleep(30)
      println("A after 30ms")
    })
    group.spawn_bg(() => {
      @async.sleep(10)
      println("B after 10ms")
    })
  })
  println("done")
}
```

The idiomatic spawn closure is a plain arrow `() => { ... }` (async-ness is inferred); `async fn() { ... }` is the explicit equivalent. A bare `fn() { ... }` doing async work compiles but is deprecated, and `async () => ...` is a parse error — `async` can only prefix `fn`, never an arrow.

There is **no** language-level async extern: both `extern "js" async fn ...` and `async extern "js" fn ...` are parse errors. A JS `Promise` cannot be bound directly as an async MoonBit function; host async interop goes through the `moonbitlang/async` runtime, not the extern declaration.

### Cancellation and runtime support

**Documented, not executed against the external package:** the official [async reference](https://docs.moonbitlang.com/en/latest/language/async-experimental.html#cancellation-makes-asynchronous-program-modular) says `with_task_group` returns only after every child has terminated. A child failure cancels the other children and waits for their cleanup. Cancellation is raised as an error at the operation where a task was blocked, so ordinary propagation, `defer`, and error handlers perform cleanup; async operations are cancellable by default.

The native runtime has the broadest IO support, including HTTP(S), files, sockets, and process spawning. JavaScript supports IO-independent APIs such as task groups and timeouts, but not the general IO layer because its host may be a browser; `moonbitlang/async/js_async` is the supported bridge for awaiting a host Promise or exporting a MoonBit async function as a Promise. Wasm1 support and its missing APIs are experimental as described above. Check the installed async package because this runtime API is not stable.

## FFI declarations

### Stable FFI types and constant enums

**Documented, not executed as an ABI test:** the official [FFI Types table](https://docs.moonbitlang.com/en/latest/language/ffi.html#types) is the stability boundary. Types absent from that table do not have a stable foreign representation.

| MoonBit value | Wasm / Wasm GC | JavaScript | C |
| --- | --- | --- | --- |
| `Bool` | `i32` | `boolean` | `int32_t` |
| `Int` / `UInt` | `i32` | `number` | `int32_t` / `uint32_t` |
| `Int64` / `UInt64` | `i64` | not listed as a stable FFI type | `int64_t` / `uint64_t` |
| `Float` / `Double` | `f32` / `f64` | `number` | `float` / `double` |
| constant `enum` | `i32` | `number` | `int32_t` |
| `#external type T` | `externref` | `any` | `void*` |

Customize integer value of constant enum variants with `Case = N`; later unassigned cases continue counting from that value. At an FFI boundary the host receives those integer values in the representation above. This layout does not generate a MoonBit `to_int` method—write an explicit conversion when MoonBit code also needs the number.

### `extern "js"` — JavaScript (js target)

A JS binding is `extern "js" fn name(args) -> T = "<inline JS expression>"`, usually an arrow function. It runs on the js target and is a hard error on every other backend (Error [4156] "extern \"js\" is unsupported in wasm-gc backend."), so gate it with `#cfg(target="js")` in multi-target packages.

```moonbit
// verified on js
extern "js" fn js_add(a : Int, b : Int) -> Int = "(a, b) => a + b"

extern "js" fn js_floor(x : Double) -> Double = "(x) => Math.floor(x)"
```

The string body is arbitrary JS evaluated as the function, so host globals like `Math` are available directly.

### `extern "wasm"` and host imports (wasm / wasm-gc)

Wasm FFI has two forms. A host import is a two-string body `pub fn host_pi() -> Double = "env" "get_pi"` (module name, then import name). Inline WebAssembly text uses `extern "wasm"` with a multiline `#|` body, which actually executes under the runtime.

```moonbit
// verified on wasm-gc (check + build + test) and wasm (check); hard error on js and native
pub fn host_pi() -> Double = "env" "get_pi"

pub extern "wasm" fn wasm_add(a : Int, b : Int) -> Int =
  #|(func (param i32) (param i32) (result i32)
  #| (i32.add (local.get 0) (local.get 1)))
```

`extern "wasm"` and the two-string import are unsupported on js and native, so a package using them needs `supported_targets = "wasm+wasm-gc"` in its `moon.pkg` (the toolchain skill covers that; the expression uses `+`, e.g. `all-js+wasm-gc`, not the word `or`).

### `extern "C"` with `#borrow` / `#owned` (native target)

Native FFI is `extern "C" fn name(args) -> T = "c_symbol"`. `#borrow(param)` marks a parameter the foreign side only reads (no refcount transfer); `#owned(param)` is the ownership-transfer counterpart (the foreign side must eventually release it). Symbols already in libc link with no stub files.

```moonbit
// verified on native (links against libc, runs): 7 + 5 = 12
extern "C" fn c_abs(x : Int) -> Int = "abs"

#borrow(b)
extern "C" fn c_strlen(b : Bytes) -> Int = "strlen"

pub fn use_c() -> Int {
  c_abs(-7) + c_strlen(b"hello\x00") // Bytes needs an explicit NUL for strlen
}
```

Custom C symbols need stub sources and link configuration — that is toolchain territory. On non-native targets `extern "C"` is Error [4156].

### `#external` opaque types and `FuncRef` callbacks

`#external` above `type X` declares an opaque foreign handle (an `externref` on wasm, `any` on js, `void*` on native) that can be passed to and returned from externs. A foreign callback parameter is typed `FuncRef[(Args) -> Ret]` and **must be capture-free** — a capturing closure is Error [4151]. Non-capturing arrow lambdas coerce to `FuncRef` implicitly.

```moonbit
// verified on js: 1970 + (10 * 2) = 1990
#external
#cfg(target="js")
type JsDate

#cfg(target="js")
extern "js" fn js_new_date(ms : Double) -> JsDate = "(ms) => new Date(ms)"

#cfg(target="js")
extern "js" fn js_year(d : JsDate) -> Int = "(d) => d.getUTCFullYear()"

#cfg(target="js")
extern "js" fn js_apply(x : Int, f : FuncRef[(Int) -> Int]) -> Int = "(x, f) => f(x)"

#cfg(target="js")
pub fn use_external() -> Int {
  let d = js_new_date(0) // JsDate handle returned from JS, passed back into js_year
  js_year(d) + js_apply(10, x => x * 2) // 1970 + (10 * 2)
  // a callback that captured a local instead of `x => x * 2` would be Error [4151]
}
```

### Exported functions and lifetime boundaries

**Documented, not executed:** the official [FFI reference](https://docs.moonbitlang.com/en/latest/language/ffi.html#export-functions) defines `#export_name("symbol")` on a public function in a `pkgtype(kind: "foreign_library")` package. The symbol must be a unique C identifier, and the attribute does not apply to generic functions, optional-argument functions, methods, or body-less declarations. Package type and backend link exports are project configuration owned by moonbit-toolchain.

**Documented, not executed:** the official [lifetime-management reference](https://docs.moonbitlang.com/en/latest/language/ffi.html#lifetime-management) says Wasm and C backends use reference counting at the foreign boundary, while wasm-gc and JavaScript reuse their host GC. `#borrow(param)` means the callee does not consume that parameter's reference; `#owned(param)` transfers responsibility to the foreign side. External-resource finalization and raw `incref` / `decref` calls are backend ABI concerns: verify them against the generated target and current `moonbit.h`, not from a language-only snippet.

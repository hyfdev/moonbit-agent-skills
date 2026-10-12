# moon ide — semantic code queries

## Official toolchain topic map

Official headings routed here: MoonBit Agent IDE; Overview; Available Commands; Symbol Syntax; `moon ide peek-def` - View Symbol Definitions; Usage; Examples; `moon ide find-references` - Track All Usages; Example; `moon ide outline` - Get Structural Overview; `moon ide doc` - Discover and Explore APIs; Query Syntax; `moon ide codelens` - Get Reference Code Lenses.

`moon ide` answers questions with compiler knowledge that grep cannot: where a symbol is *defined* (not merely mentioned), every real *reference* (not string matches), inferred *types* at a position, and the public API of any installed package. Prefer it over grep whenever the question is "what is this / who uses this / what does this package export". The examples below are executed at the pin in a module, with a separate standalone-script probe. **Documented, not executed for mixed-backend workspaces:** navigation follows each module's configured backend; on a single module, commands exposing `--target` may select the check backend. The mixed-backend workspace case is described by the [pinned IDE reference](https://github.com/moonbitlang/moonbit-docs/blob/8d9f3ba206eb17f80ee1836e4c1139068d1351b5/next/toolchain/moonide/index.md#overview).

## Finding definitions and references

```sh
moon ide peek-def add
moon ide find-references shout
moon ide find-references shout --json
moon ide find-references shout --include-definition --json
moon ide peek-def add --loc lib.mbt --json
moon ide peek-def --loc lib.mbt:3:3 --json
moon ide find-references --loc lib.mbt:3:3 --json
```

- `peek-def` prints `Found N symbols matching '<name>'`, then for each: visibility, kind, package, `file:startline-endline`, and the source snippet.
- `find-references` prints `Found N references for symbol '...'` with a context block per reference (definitions excluded unless `--include-definition` is supplied). JSON locations include `path`, `range`, and `is_test`, which identifies uses in test blocks or test files.

Without `--loc`, queries search semantic symbols across the module or workspace. A file-only `--loc lib.mbt` restricts the initial lookup to that file. A full `--loc path:line:column` resolves local variables and shadowed names at that position and lets `peek-def` / `find-references` omit the separate symbol argument. Positions are one-based.

Symbol arguments accept bare value names (`add`) and method paths (`String::to_upper`); doc queries also support `*` wildcards (below). **Help-verified only:** definition/reference queries additionally accept `Trait::method for Type`; the manifest executes their help, while no trait-implementation lookup is exercised.

## Renaming

```sh
moon ide rename shout yell --loc textutil/shout.mbt:2
moon ide rename shout yell --loc textutil/shout.mbt:2 --apply
```

Dry-run by default: prints a `*** Begin Patch / *** Update File: ... / *** End Patch` patch without touching disk. `--apply` edits files and reports `Applied N edit(s) across M file(s).` — verified to update both the definition and its call sites.

## Types at a position

```sh
moon ide hover --loc cmd/main/main.mbt:3:16
moon ide hover --loc cmd/main/main.mbt:3:16 --output-json
```

`--loc` is `path:line:column` (1-based). Plain output is a caret-annotated source snippet; with `--output-json` you get `{"range":"3:11-3:19","contents":["```moonbit\nfn @mbtskills/template.add(a : Int, b : Int) -> Int\n```"]}`. `hover` accepts `--json` as well as its older `--output-json` spelling. Definition/reference queries and workspace-symbol search use `--json`; this is not a universal flag for every IDE subcommand.

## File and package structure

```sh
moon ide outline textutil
moon ide outline textutil/shout.mbt
moon ide analyze
```

- `outline` takes a file or a directory and prints, per file, the signature lines with their line numbers.
- `analyze` dumps the module's public API in `.mbti` style with a usage count per symbol (`pub fn add(Int, Int) -> Int  // usage: 2 (1 in test)`) — the quick way to find dead public API.

## Workspace symbol search and CodeLens

```sh
moon ide workspace-symbols shout --json
moon ide codelens textutil/shout.mbt
```

`workspace-symbols` uses fuzzy matching over top-level names and returns kind and source location; an empty query lists all workspace symbols. `codelens` always returns a JSON array of local/global reference entries. Local-reference locations carry `is_test`; ranges use one-based `line:column-line:column` notation.

Standalone `.mbtx` files are supported, including explicit import aliases when a `moon.pkg` exists beside the script. The manifest verifies a script alias using position-based hover and definition lookup; file and package outline work as well. For example:

```sh
moon ide outline import-all.mbtx
```

## API search: moon ide doc

```sh
moon ide doc 'String::*upper*'
moon ide doc '@textutil'
```

- Wildcard queries search installed APIs (standard library included) and print signatures plus the first doc line; deprecated aliases are marked. This is the ground truth for "does this function exist?" — never assume from other ecosystems.
- `@pkg` (an alias or package name) dumps that whole package's public API with its module and version header.
- This replaces passing a symbol to `moon doc`, which is marked deprecated.

## Symbol index for tooling

```sh
moon ide gen-symbols
```

Writes `./symbols.jsonl` — one JSON object per symbol: `{"kind":["Sym","add"],"path":"lib.mbt","pkg":"mbtskills/template","tag":"0x1001","range":[2,1,4,2],...}`. Test blocks are included as symbols (tag `0x8000`) with their quoted names. Useful as a machine-readable map of the codebase; note it does *not* accept `--output-json` (it is already JSONL).

## When grep is still right

Use grep for comments, strings, config files, and names you only half-know. Use `moon ide` when you need semantic truth: exact definition sites, complete reference lists, types, or the real exported API surface. `moon ide` needs the module to at least parse; on a badly broken tree, fall back to grep and references/diagnostics-and-recovery.md.

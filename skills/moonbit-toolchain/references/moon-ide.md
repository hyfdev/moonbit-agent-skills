# moon ide — semantic code queries

`moon ide` answers questions with compiler knowledge that grep cannot: where a symbol is *defined* (not merely mentioned), every real *reference* (not string matches), inferred *types* at a position, and the public API of any installed package. Prefer it over grep whenever the question is "what is this / who uses this / what does this package export". All subcommands below were executed at the pin, inside a module.

## Finding definitions and references

```sh
moon ide peek-def add
moon ide find-references shout
```

- `peek-def` prints `Found N symbols matching '<name>'`, then for each: visibility, kind, package, `file:startline-endline`, and the source snippet.
- `find-references` prints `Found N references for symbol '...'` with a context block per reference (definition included).

Symbol arguments accept several forms: a bare value name (`add`), a method path (`String::to_upper`), and `*` wildcards in doc queries (below).

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

`--loc` is `path:line:column` (1-based). Plain output is a caret-annotated source snippet; with `--output-json` you get `{"range":"3:11-3:19","contents":["```moonbit\nfn @mbtskills/template.add(a : Int, b : Int) -> Int\n```"]}`. **`--output-json` is accepted only by `hover`** — every other subcommand rejects it with `unknown option '--output-json'`.

## File and package structure

```sh
moon ide outline textutil
moon ide outline textutil/shout.mbt
moon ide analyze
```

- `outline` takes a file or a directory and prints, per file, the signature lines with their line numbers.
- `analyze` dumps the module's public API in `.mbti` style with a usage count per symbol (`pub fn add(Int, Int) -> Int  // usage: 2 (1 in test)`) — the quick way to find dead public API.

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

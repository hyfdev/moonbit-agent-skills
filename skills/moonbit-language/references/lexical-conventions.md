# Lexical Conventions

Use this reference for tokenization questions. Checked examples of literals, interpolation, and escapes live in references/data-types.mbt.md; declaration naming and comments live in references/declarations-and-functions.mbt.md.

The detailed rules below are **Documented, not executed** as an exhaustive lexer conformance suite. Source: [official lexical grammar](https://github.com/moonbitlang/moonbit-docs/blob/8d9f3ba206eb17f80ee1836e4c1139068d1351b5/next/language/lexical-conventions.md). Validate a disputed spelling with the local compiler; the grammar's keyword lists can lag implemented syntax, including `errdefer`.

## Common Lexical Classes

Source text must be valid UTF-8. Unicode scalar values exclude the surrogate range U+D800–U+DFFF. LF, CR, CRLF, U+2028, and U+2029 form newlines and participate in semicolon insertion. Other whitespace is discarded: U+0009, U+000B, U+000C, U+0020, U+00A0, U+1680, U+2000–U+200A, U+202F, U+205F, U+3000, and U+FEFF. A line character is any scalar value except a newline character.

## Comments and Identifiers

`//` starts a line comment; `///` starts a documentation comment. There is no block-comment form. An uppercase identifier starts with an ASCII uppercase letter. Other identifiers start with an ASCII lowercase letter, an underscore followed by another identifier character, or a character from the grammar's explicit non-ASCII ranges. `_` alone is a separate token. Unicode spelling is not normalized, and a leading digit starts a numeric literal.

### Keywords

Keywords take precedence over identifiers. Reserved spellings may produce a warning rather than becoming usable names. Use the compiler to distinguish a current keyword, a reserved spelling, and a shipped feature; the pinned grammar lists `errdefer` as reserved although the compiler supports its cleanup expression.

### Labels

A label has an immediately adjacent `~`, such as `result~`. Uppercase identifiers and keywords cannot form labels. Block and loop rules are checked in references/control-flow-and-iteration.mbt.md.

## Package Names

A package-qualified spelling starts with `@`. Its ASCII path segments contain letters, digits, underscores, or hyphens; a segment cannot start with a digit or hyphen. The `@`, slashes, and segments must be adjacent. Package aliases and import configuration are covered by moonbit-toolchain.

## Attributes

An attribute starts with `#` and an ASCII attribute name, optionally followed by a dot-qualified name. Its raw payload runs through the end of that line. Attributes are not permitted inside string interpolation. Individual attributes are covered in references/attributes.mbt.md.

## Numeric Literals

Uppercase suffixes select `UInt` (`U`), `Int64` (`L`), `UInt64` (`UL`), `BigInt` (`N`), or `Float` (`F`). Floating-point literals contain a decimal point; an unsuffixed one is a `Double`. A hexadecimal `Float` requires a `p` or `P` exponent before `F`, so `0x1.F` is a `Double`. Signs are separate tokens. Before a range token such as `..=`, the integer token ends first. Checked examples of these types and ordinary literals are in references/data-types.mbt.md.

## Dot-Prefixed Tokens

A tuple accessor, such as `.0`, and a dot-identifier contain no internal whitespace. Tuple accessors contain digits without underscores. Dot-identifiers do not consult the keyword table, so a keyword spelling after the dot can be accepted as a member name.

## Operators and Delimiters

The lexer selects the longest listed token. MoonBit does not have a generic operator-name syntax: an arbitrary punctuation sequence does not define a new operator. Checked operator implementations are in references/traits-and-generics.mbt.md.

## Automatic Semicolon Insertion

After a newline, a semicolon may be inserted when the preceding token can end a statement and the next can begin one. End of file also qualifies as a follower. No semicolon is inserted before `}` or between adjacent multiline-string lines. Use the formatter when the intended statement boundary is unclear.

## `.mbti` Extensions

The generated interface format adds `package` as a keyword. In `.mbti`, that word cannot form a label. In `.mbt`, the reserved-word rules apply. Generate interface files through the toolchain rather than treating their syntax as ordinary implementation code.

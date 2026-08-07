# Toolchain surface maintenance

## Why this inventory exists

The latest channel can change command and configuration behavior before a website release article appears. The language inventory does not cover `next/toolchain/**`, so a separate surface mechanically snapshots every official toolchain Markdown file and every H1-H4 section body. This catches new files, new headings, and prose-only changes such as a canonical configuration shape changing while the legacy form still parses.

## Snapshot and verify

Resolve the current full `moonbitlang/moonbit-docs` `main` commit and run:

```sh
vp run snapshot-toolchain-surface --commit <40-hex-commit> --output verification/toolchain-surface/source.json
vp run verify-toolchain-surface-source
```

The generator enumerates every Markdown blob below `next/toolchain/` from the pinned Git tree; it does not use a hand-written page list. It records file hashes, extracts document roots and H2-H4 headings outside code fences, and fingerprints each section body. `vp run verify-latest-upstream` separately requires this inventory and the language inventory to use the current docs `main` commit.

## Close every topic

Every source ID belongs exactly once in `verification/toolchain-surface/coverage.json`. A routed decision records the exact current fingerprints and topic names, the `moonbit-toolchain` Feature-index route, and a unique reference marker. An out-of-scope decision records a concrete boundary reason and no route. Run `vp run check-toolchain-surface`; a changed body, new heading, or new file fails until reviewed.

The route is not semantic proof. For each changed topic, inspect the official prose and then execute the smallest current DSL or command example through `verification/commands/manifest.json`. If execution would mutate global state, require credentials, or depend on an unavailable platform, label the fact `Documented, not executed`, link the pinned official page, and state the boundary. Prefer canonical current forms even when a legacy form still parses; keep legacy syntax only as clearly labelled migration guidance.

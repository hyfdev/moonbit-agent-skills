# Language surface maintenance

## Why this inventory exists

Release notes only describe changes. They cannot reveal an old, ordinary language feature that the repository never considered. Conversely, testing every claim already written cannot detect a missing topic. The language-surface inventory mechanically captures the official documentation's complete recursive language tree, included pages, pinned glob expansions, and H2-H4 headings so omissions become visible.

The inventory does not prove the official prose. MoonBit documentation is rolling and can lead or lag the pinned compiler. In the 2026-07-18 audit, the official Fundamentals page presented local type definitions normally, while an unsuppressed minimal check on moonc v0.10.4+2cc641edf emitted `deprecated_syntax`; the upstream package hid that warning. Use official headings to discover what to test, then let the pinned compiler decide executable behavior.

## Snapshot the official surface

Pin a full `moonbitlang/moonbit-docs` commit and run:

```sh
vp run snapshot-language-surface --commit <40-hex-commit> --output verification/language-surface/source.json
```

The generator starts from `next/language/index.md`; recursively follows root and nested toctrees, expands globs against the pinned repository tree, and follows `{include}` pages; records each file hash; extracts document roots and H2-H4 headings with section-body fingerprints; rejects unsafe, duplicate, or structurally unknown entries; and writes stable JSON. It inventories the complete error-code subtree too; the coverage decision, not source filtering, places that exhaustive catalog outside the product promise.

Run `vp run verify-language-surface-source` to re-fetch the pinned files and prove the committed inventory is mechanical. A newer upstream commit does not make the pin stale by itself; re-pin deliberately when auditing current documentation or upgrading the product baseline.

## Close every topic

`verification/language-surface/coverage.json` answers one narrow question: can a user or agent reach content for this official topic from a public product skill?

```json
{
  "source_ids": [
    "document-methods-attaching-trait-methods-with-extend"
  ],
  "reviewed": {
    "document-methods-attaching-trait-methods-with-extend": "<current-item-fingerprint>"
  },
  "summary": "Explicit trait-method attachment",
  "disposition": "routed",
  "owner_skill": "moonbit-language",
  "route": {
    "section": "Feature index",
    "reference": "references/traits-and-generics.mbt.md",
    "terms": ["extend", "pub extend"]
  },
  "content": {
    "marker": "## Explicit `extend` controls dot-call methods",
    "terms": ["Attaching trait methods with `extend`"]
  }
}
```

Each source ID appears exactly once. A routed item needs one product owner, an existing reference, a unique content marker, the exact official topic text in that reference, a reviewed mapping from every source ID to its current fingerprint, and one physical `Feature index` line containing both the reference path and every route search term. Group only closely related headings actually handled by the same reference section. Treat the topic map as discoverability evidence, not semantic proof: inspect the surrounding reference and add substantive content when a topic is not actually explained. `out-of-scope` needs a concrete product-boundary reason and carries no route. There is no `pending` disposition.

Run `vp run check-language-surface`. A new heading fails until routed, and a body-only upstream edit fails until its new fingerprint is reviewed. This proves coverage and discoverability, not truth. Each routed claim still follows the repository evidence rules.

## Verify newly discovered syntax

1. Locate the official prose and example source at the pinned docs commit.
2. Inspect the upstream package configuration for warning suppression, conditional targets, external dependencies, and generated files.
3. Copy the smallest behavior into a fresh project with no warning suppression.
4. Run `moon check --deny-warn` and the narrowest behavior test on every applicable pinned target.
5. Put a positive, self-contained example in an `mbt check` fence. Use a fixture for cross-package behavior, target-specific behavior, warnings, rejections, or migrations.
6. If execution is unavailable, state `Documented, not executed`, link the exact official page, and describe the missing execution boundary.

## Evaluate discoverability without leaking the answer

A broken workspace is a poor discovery eval when the compiler prints the replacement syntax. Start from code that passes with warnings denied and exposes an existing qualified API. Put the new call form only in a hidden grader test, and ask the agent for the behavior without naming the feature. Compare the prior committed skill tree with the new committed tree under the same model, project, tools, and pinned compiler.

Report functional behavior, skill activation, and successful routed-reference reads separately. A route read counts only when its tool result succeeded before a later edit or command; a tool-use request alone is not evidence. If old and new tie, report that the entrypoint is structurally complete but the eval did not measure an outcome improvement.

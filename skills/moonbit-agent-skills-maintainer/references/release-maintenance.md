# Release maintenance reference

## Why source inventory and coverage are separate

`source.json` is a mechanical transcription of a pinned upstream Markdown source. `coverage.json` records repository judgment. Keeping them separate prevents an agent from omitting an upstream item from its own checklist and then declaring that checklist complete.

The importer records every numbered item, prose paragraph, bullet, and fenced code block under Language Updates, Toolchain Updates, and Standard Library Updates. It fails instead of silently skipping an unknown level-two section, a repeated section, or content before a section's first numbered item. The checker requires every generated source ID to appear exactly once across coverage decisions.

## Import a release

Find the release Markdown in `https://github.com/moonbitlang/website`, resolve a full commit, and run:

```sh
vp run snapshot-release --release <version> --date <YYYY-MM-DD> --commit <40-hex-commit> --source-path <updates/.../index.md> --web-url <https://www.moonbitlang.com/updates/...> --output verification/releases/<version>/source.json
```

The command fetches the file from the pinned commit, hashes the complete Markdown, parses the three release sections, rejects structural drift, verifies contiguous top-level numbering, and writes stable JSON. Re-run with `--check` during review to prove the committed inventory still matches upstream. If upstream adds or renames a section, update and test the importer before making coverage judgments.

## Coverage decision schema

A decision may group closely related source IDs, but each source ID may occur in only one decision. Keep independently actionable changes separate; for example, explicit `extend`, warning 79's default status at the pinned build, the soft-keyword transition, and supertrait dot-call migration should not be collapsed into one vague entry. Every actionable decision must enumerate its individual claims and link each claim to the exact evidence roles that prove it. A single executable marker elsewhere in a broad decision does not verify its other claims.

```json
{
  "schema_version": 2,
  "release": "0.10.4",
  "status": "current",
  "source_inventory": "source.json",
  "decisions": [
    {
      "source_ids": ["language-1", "language-1-p2"],
      "summary": "Attach selected trait implementations with explicit extend declarations.",
      "change": "new-feature",
      "agent_behavior": "Recommend extend Type with Trait::{method}; use pub extend for a public method.",
      "claims": [
        {
          "text": "An explicit extend declaration selects the implemented methods available through dot syntax.",
          "evidence_roles": ["recommended-form"]
        }
      ],
      "disposition": "verified",
      "owner_skill": "moonbit-language",
      "discoverability": {
        "section": "Feature index",
        "reference": "references/traits-and-generics.mbt.md",
        "terms": ["extend", "pub extend"]
      },
      "evidence": [
        {
          "kind": "checked-doc",
          "path": "skills/moonbit-language/references/traits-and-generics.mbt.md",
          "marker": "extend Robot with Greeter::{greet}",
          "role": "recommended-form"
        }
      ]
    }
  ]
}
```

Allowed dispositions:

| Disposition | Required proof |
| --- | --- |
| `verified` | One product-skill owner, expected agent behavior, explicit claims, and executable checked-doc, fixture, command, or content-eval evidence for every claim. |
| `documented` | One product-skill owner, expected agent behavior, explicit claims, and `Documented, not executed` evidence with a direct HTTPS source for every claim. |
| `out-of-scope` | A concrete reason that explains why the change is outside both product skills. No evidence entry. |
| `not-actionable` | A concrete reason that explains why the release item produces no stable user guidance. No evidence entry. |

The checker rejects missing/duplicate source IDs, unknown manifest entries, missing files or markers, non-product owners, fixture owner mismatches, repository-escaping paths, evidence without a unique role, claims without linked proof, verified claims without executable proof, and documented claims without a direct source and explicit label.

For the current release, every actionable decision also needs `discoverability`. The owning skill's named section must contain one physical line with the reference path and every term, and every term must occur in the decision summary or agent behavior. This is not semantic evidence; it prevents correct material from being buried in a reference that the primary skill entry never names. Archived releases do not keep this live-text requirement.

## Evidence rules

- `checked-doc`: path under the owning skill's `references/`, ending in `.mbt.md`; the marker must identify the relevant checked example.
- `fixture`: path to `verification/fixtures/<id>/fixture.json`; its `owner_skill` must match.
- `command`: `entry_id` in `verification/commands/manifest.json`; a documented-only command does not prove runtime behavior.
- `content-eval`: path to `evals/<area>/tasks/<id>/task.json`; use for material changes in what an agent should produce or recommend.
- `documented`: repository path, exact marker, and direct HTTPS `source_url`; the text must say `Documented, not executed` and explain the untested boundary.

Every evidence entry needs a unique `role`. Every claim lists one or more `evidence_roles`; the checker rejects unknown roles, unused evidence, and a verified claim whose linked roles are only documentation. Split a decision when its claims need different dispositions rather than using one passing POC to label an unexecuted claim verified.

## Deprecation gate

Every deprecation decision, including a source-only `documented` decision, must cover both sides of the migration:

1. Find and remove any repository example that still recommends the old form.
2. Run the old form with the relevant warning enabled. If the warning is off by default, record the explicit `--warn-list +name` argument in fixture metadata.
3. Add `--deny-warn` so an absent warning makes the negative fixture fail instead of pass.
4. Verify the replacement with the same warning settings.
5. Add a content eval when the migration changes what an agent should write for users.

Use the exact evidence roles `deprecated-form` and `replacement`. If the release announces a deprecation that cannot yet be triggered, keep the decision `documented`, give an explicit reason why it is unexecuted, and link both roles to separately identified old-form and replacement text in an explicitly labeled paragraph.

## Re-pin gate

For audit mode, leave the current snapshot and skill frontmatter unchanged. For update mode, complete coverage first, then follow the repository re-pin steps. `vp run check-release-coverage` requires exactly one current coverage file and its release must equal every product skill's `metadata.moonbit-release`.

## Review split

The source-completeness reviewer reads the pinned Markdown independently and attacks extraction, grouping, dispositions, and out-of-scope reasons. The implementation reviewer attacks evidence, negative tests, warning flags, version consistency, and full-suite results. Do not let either reviewer rely only on the generated summary tables.

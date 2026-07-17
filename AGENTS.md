# Working in this repository (agent instructions)

This repository publishes two Agent Skills (`skills/moonbit-language`, `skills/moonbit-toolchain`) whose core promise is: **every claim is verified against a pinned MoonBit toolchain, and the pin is machine-checked**. When editing here, that promise is the thing you must not break.

## Rules

1. **No unverified content.** A fact enters a skill only with a runnable proof: an `mbt check` block in a `.mbt.md` reference (executed by `tooling/run_checked_docs.py`), a fixture under `verification/fixtures/` (executed by `tooling/run_fixtures.py`), or a command-manifest entry (executed by `tooling/verify_commands.py`). If you cannot verify it, label it `documented` (with source URL) or leave it out.
2. **One owner per fact.** Language semantics belong to moonbit-language; project operation belongs to moonbit-toolchain. Cross-links are one line; never copy explanations across skills (`tooling/check_duplication.py` enforces this).
3. **Versions come from the snapshot.** Never hand-edit version strings. Re-pin with `python3 tooling/snapshot_toolchain.py --date YYYY-MM-DD`, re-run all verification, re-stamp fixtures (`tooling/run_fixtures.py --stamp --date ...`), and update skill frontmatter to match; `tooling/check_versions.py` cross-checks all of it.
4. **Proposals are not features.** Anything sourced from moonbit-evolution or a release-note "planned" section must be labeled proposal, never shown as current syntax.
5. **README numbers are generated.** Edit prose freely, but data inside `<!-- BEGIN GENERATED -->` blocks only via `python3 tooling/gen_readme.py`.
6. **Skill descriptions are an interface.** If you touch a frontmatter `description`, re-run the activation eval (`evals/activation/run_activation.py`) or state explicitly that routing is unrevalidated.
7. **Each skill has per-client activation surfaces — keep all of them in sync.** A skill ships three: the frontmatter `description` (open-spec catalog, all clients), `user-invocable: false` (Claude Code extension, hides the manual `/` entry), and `agents/openai.yaml` (Codex: display name, short description, default prompt, `allow_implicit_invocation: true`). This third surface was missed in the initial build and added late — when renaming a skill, changing its scope/description, or adding a new skill, update the Codex sidecar in the same change (`tooling/validate_skills.py` enforces its presence).

## Local check sequence (mirror of CI)

```sh
python3 -m unittest discover tooling/tests
python3 tooling/validate_skills.py
python3 tooling/check_duplication.py
python3 tooling/check_versions.py
python3 tooling/gen_readme.py --check
python3 tooling/run_checked_docs.py        # needs moon
python3 tooling/run_fixtures.py -v         # needs moon
python3 tooling/verify_commands.py         # needs moon
```

## Layout

- `skills/` — the two installable skills (SKILL.md + references/ + scripts/).
- `verification/` — toolchain snapshot, pinned sources, fixtures, command manifest + template project.
- `evals/` — activation + content evals with deterministic graders (`runs/` output is gitignored).
- `tooling/` — validators, runners, generators, and their tests.
- `research/` — the research note on making LLMs reliable in low-pretraining-coverage languages.

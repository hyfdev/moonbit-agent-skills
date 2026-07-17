#!/usr/bin/env python3
"""Execute every `mbt check` example embedded in skill reference documents.

All `skills/<skill>/references/*.mbt.md` files (and any SKILL.mbt.md) are
copied into one throwaway MoonBit module per skill, then `moon check` and
`moon test` run for each requested target. MoonBit's literate-doc support
turns every ``` `mbt check` ``` fence into a real test, so the reference
documentation is validated by the actual compiler — there is no separate
mirror of the examples to drift out of sync.

Fence semantics (per MoonBit docs, v0.10.4): `mbt` compiles without a test
entry, `mbt check` compiles and runs, `mbt nocheck` and `moonbit` are
display-only. Deliberately-invalid examples therefore must not use `mbt`
or `mbt check` — they belong in verification/fixtures/ instead.

Usage:
  python3 tooling/run_checked_docs.py [--skill moonbit-language] \
      [--targets wasm-gc,wasm,js,native]
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / "skills"

MOON_MOD_TEMPLATE = 'name = "mbtskills/checkeddocs"\nversion = "0.1.0"\n'


def collect_docs(skill_dir: Path) -> list[Path]:
    docs = sorted(skill_dir.glob("references/*.mbt.md"))
    docs += sorted(skill_dir.glob("SKILL.mbt.md"))
    return docs


def run(skill: str, targets: list[str]) -> int:
    skill_dir = SKILLS_DIR / skill
    docs = collect_docs(skill_dir)
    if not docs:
        print(f"{skill}: no .mbt.md documents, nothing to check")
        return 0

    failures = 0
    with tempfile.TemporaryDirectory(prefix="mbtdocs-") as tmp:
        mod_dir = Path(tmp) / "checkeddocs"
        mod_dir.mkdir()
        (mod_dir / "moon.mod").write_text(MOON_MOD_TEMPLATE)
        (mod_dir / "moon.pkg").write_text("")
        for doc in docs:
            shutil.copy(doc, mod_dir / doc.name)

        for target in targets:
            for subcmd in (["check"], ["test"]):
                proc = subprocess.run(
                    ["moon", *subcmd, "--target", target, "--no-render"],
                    cwd=mod_dir,
                    capture_output=True,
                    text=True,
                    timeout=600,
                )
                label = f"{skill} moon {' '.join(subcmd)} --target {target}"
                if proc.returncode != 0:
                    failures += 1
                    print(
                        f"FAIL {label}\n{(proc.stdout + proc.stderr)[:2000]}",
                        file=sys.stderr,
                    )
                else:
                    tail = (proc.stdout.strip().splitlines() or [""])[-1]
                    print(f"ok   {label}: {tail}")
    print(
        f"{skill}: {len(docs)} checked document(s) across targets "
        f"{','.join(targets)}; {'ALL OK' if failures == 0 else f'{failures} failing command(s)'}"
    )
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--skill",
        action="append",
        help="skill name under skills/ (repeatable; default: all skills)",
    )
    parser.add_argument("--targets", default="wasm-gc,wasm,js,native")
    args = parser.parse_args()

    skills = args.skill or sorted(
        d.name for d in SKILLS_DIR.iterdir() if (d / "SKILL.md").is_file()
    )
    targets = args.targets.split(",")
    failures = sum(run(skill, targets) for skill in skills)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

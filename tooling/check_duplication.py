#!/usr/bin/env python3
"""Guard the ownership boundary between the two skills: no complete
knowledge unit may be duplicated across moonbit-language and
moonbit-toolchain.

Mechanism: normalize every paragraph and every fenced code block from each
skill's SKILL.md + references, then flag any unit longer than a threshold
that appears in both skills. Short cross-links ("dependency declarations
belong to moonbit-toolchain") are expected and stay under the threshold;
copied explanations and copied examples do not.

Usage: python3 tooling/check_duplication.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS = ("moonbit-language", "moonbit-toolchain")
MIN_CHARS = 120  # a duplicated unit shorter than this is treated as a cross-link


def units(skill: str) -> dict[str, str]:
    """normalized unit -> 'file: first 60 chars' provenance."""
    out: dict[str, str] = {}
    skill_dir = REPO_ROOT / "skills" / skill
    for path in [skill_dir / "SKILL.md", *sorted(skill_dir.glob("references/*"))]:
        if not path.is_file() or path.suffix not in (".md",):
            continue
        text = path.read_text()
        blocks: list[str] = []
        fence_re = re.compile(r"```[^\n]*\n(.*?)```", re.S)
        blocks += [m.group(1) for m in fence_re.finditer(text)]
        prose = fence_re.sub("", text)
        blocks += prose.split("\n\n")
        for block in blocks:
            normalized = re.sub(r"\s+", " ", block).strip().lower()
            if len(normalized) >= MIN_CHARS:
                out.setdefault(
                    normalized, f"{path.relative_to(REPO_ROOT)}: {block.strip()[:60]!r}"
                )
    return out


def main() -> int:
    a, b = (units(s) for s in SKILLS)
    duplicated = sorted(set(a) & set(b))
    for unit in duplicated:
        print(f"FAIL duplicated unit in both skills:\n  {a[unit]}\n  {b[unit]}", file=sys.stderr)
    if not duplicated:
        print("duplication check: OK (no shared knowledge units >= "
              f"{MIN_CHARS} chars)")
    return 1 if duplicated else 0


if __name__ == "__main__":
    sys.exit(main())

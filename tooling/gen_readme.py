#!/usr/bin/env python3
"""Regenerate the data-derived blocks in README.md from repository state.

Every number, version, and inventory line in README.md that could drift
lives between markers:

    <!-- BEGIN GENERATED: <block> -->
    ...
    <!-- END GENERATED: <block> -->

This script rewrites those blocks deterministically from the toolchain
snapshot, the fixtures, the eval prompt sets, and the skill directories.
CI reruns it and fails on `git diff --exit-code`, so the README can never
disagree with the repository.

Usage: python3 tooling/gen_readme.py [--check]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from validate_skills import parse_frontmatter

REPO_ROOT = Path(__file__).resolve().parent.parent
README = REPO_ROOT / "README.md"


def snapshot() -> dict:
    return json.loads(
        (REPO_ROOT / "verification" / "toolchains" / "current.json").read_text()
    )


def count_activation_prompts() -> dict[str, int]:
    counts: dict[str, int] = {}
    prompts = REPO_ROOT / "evals" / "activation" / "prompts.jsonl"
    if prompts.is_file():
        for line in prompts.read_text().splitlines():
            if not line.strip():
                continue
            counts[json.loads(line)["category"]] = (
                counts.get(json.loads(line)["category"], 0) + 1
            )
    return counts


def block_status() -> str:
    snap = snapshot()
    comps = {c["name"]: c["version"] for c in snap["components"]}
    lines = [
        f"- Verified toolchain: `moon {comps['moon']}` · `moonc v{comps['moonc']}` · "
        f"`moonrun {comps['moonrun']}`",
        f"- Verification date: {snap['verification_date']} on "
        f"{snap['platform']['os']} {snap['platform']['arch']}",
        f"- Verified targets: {', '.join(snap['verified_targets'])}",
    ]
    return "\n".join(lines)


def block_inventory() -> str:
    fixtures = sorted(
        d.name
        for d in (REPO_ROOT / "verification" / "fixtures").iterdir()
        if (d / "fixture.json").is_file()
    )
    lines = []
    for skill_dir in sorted((REPO_ROOT / "skills").iterdir()):
        if not (skill_dir / "SKILL.md").is_file():
            continue
        fm, body, _ = parse_frontmatter((skill_dir / "SKILL.md").read_text())
        refs = sorted(
            f.name
            for f in (skill_dir / "references").glob("*")
            if f.is_file() and not f.name.startswith(".")
        )
        body_lines = body.count("\n") + 1
        lines.append(
            f"- `{skill_dir.name}` v{fm.get('metadata', {}).get('skill-version', '?')}: "
            f"SKILL.md ({body_lines} lines) + {len(refs)} reference file(s)"
        )
    lines.append(f"- Verification fixtures: {len(fixtures)}")
    counts = count_activation_prompts()
    if counts:
        total = sum(counts.values())
        per = ", ".join(f"{k} {v}" for k, v in sorted(counts.items()))
        lines.append(f"- Activation eval prompts: {total} ({per})")
    return "\n".join(lines)


BLOCKS = {
    "status": block_status,
    "inventory": block_inventory,
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if README is stale")
    args = parser.parse_args()

    text = README.read_text()
    new_text = text
    for name, producer in BLOCKS.items():
        pattern = re.compile(
            rf"(<!-- BEGIN GENERATED: {name} -->\n)(?:.*\n)??(<!-- END GENERATED: {name} -->)",
            re.S,
        )
        if not pattern.search(new_text):
            print(f"FAIL README.md missing generated block markers for {name!r}", file=sys.stderr)
            return 1
        new_text = pattern.sub(
            lambda m: m.group(1) + producer() + "\n" + m.group(2), new_text
        )

    if new_text != text:
        if args.check:
            print("FAIL README.md generated blocks are stale; run tooling/gen_readme.py", file=sys.stderr)
            return 1
        README.write_text(new_text)
        print("README.md regenerated")
    else:
        print("README.md generated blocks: up to date")
    return 0


if __name__ == "__main__":
    sys.exit(main())

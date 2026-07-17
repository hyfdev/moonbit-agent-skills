#!/usr/bin/env python3
"""Check that every version claim in the repository traces back to the
committed toolchain snapshot (verification/toolchains/current.json).

Checked:
  - skill frontmatter metadata pins (moonc-version / moon-version /
    moonrun-version, verified-date, verified-targets, verified-platform)
    match the snapshot exactly;
  - the visible verification note near the top of each SKILL.md body
    states the same versions;
  - every fixture carries a `verified` stamp whose component versions and
    date match the snapshot (i.e. fixtures were actually re-run against
    the toolchain the repo claims).

Usage: python3 tooling/check_versions.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from validate_skills import parse_frontmatter

REPO_ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT = REPO_ROOT / "verification" / "toolchains" / "current.json"
SKILLS_DIR = REPO_ROOT / "skills"
FIXTURES_DIR = REPO_ROOT / "verification" / "fixtures"

COMPONENT_KEY = {
    "moonc-version": "moonc",
    "moon-version": "moon",
    "moonrun-version": "moonrun",
}


def main() -> int:
    problems: list[str] = []
    snapshot = json.loads(SNAPSHOT.read_text())
    components = {c["name"]: c for c in snapshot["components"]}
    snap_date = snapshot["verification_date"]
    snap_targets = set(snapshot["verified_targets"])
    snap_platform = (
        f"{snapshot['platform']['os']}-{snapshot['platform']['arch']}"
    )

    for skill_dir in sorted(d for d in SKILLS_DIR.iterdir() if d.is_dir()):
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.is_file():
            continue
        fm, body, _ = parse_frontmatter(skill_md.read_text())
        metadata = fm.get("metadata", {}) or {}
        label = skill_dir.name

        for meta_key, comp_name in COMPONENT_KEY.items():
            if meta_key not in metadata:
                continue
            expected = components[comp_name]["version"]
            if metadata[meta_key] != expected:
                problems.append(
                    f"{label}: metadata.{meta_key}={metadata[meta_key]!r} "
                    f"but snapshot has {expected!r}"
                )
            # The human-visible verification note must state the same pin.
            head = "\n".join(body.splitlines()[:40])
            if expected not in head:
                problems.append(
                    f"{label}: SKILL.md body head does not state verified "
                    f"{comp_name} version {expected!r}"
                )

        if metadata.get("verified-date") != snap_date:
            problems.append(
                f"{label}: metadata.verified-date={metadata.get('verified-date')!r}"
                f" != snapshot {snap_date!r}"
            )
        if metadata.get("verified-platform") != snap_platform:
            problems.append(
                f"{label}: metadata.verified-platform="
                f"{metadata.get('verified-platform')!r} != snapshot {snap_platform!r}"
            )
        declared_targets = set(
            t.strip() for t in metadata.get("verified-targets", "").split(",") if t.strip()
        )
        if not declared_targets or not declared_targets <= snap_targets:
            problems.append(
                f"{label}: metadata.verified-targets {sorted(declared_targets)} "
                f"must be a non-empty subset of snapshot {sorted(snap_targets)}"
            )

    for fixture_dir in sorted(FIXTURES_DIR.iterdir()):
        meta_file = fixture_dir / "fixture.json"
        if not meta_file.is_file():
            continue
        meta = json.loads(meta_file.read_text())
        stamp = meta.get("verified")
        if not stamp:
            problems.append(f"fixture {fixture_dir.name}: never stamped as verified")
            continue
        for comp_name, comp in components.items():
            stamped = stamp.get("components", {}).get(comp_name, "")
            # Stamps store the raw `moon version` strings; compare prefix-insensitively.
            if comp["version"] not in stamped:
                problems.append(
                    f"fixture {fixture_dir.name}: stamped {comp_name} "
                    f"{stamped!r} does not match snapshot {comp['version']!r}"
                )
        if stamp.get("date") != snap_date:
            problems.append(
                f"fixture {fixture_dir.name}: stamp date {stamp.get('date')!r} "
                f"!= snapshot {snap_date!r}"
            )

    for problem in problems:
        print(f"FAIL {problem}", file=sys.stderr)
    if not problems:
        print("version consistency: OK")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())

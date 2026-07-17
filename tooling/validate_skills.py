#!/usr/bin/env python3
"""Validate every skill under skills/ against the Agent Skills spec plus
this repository's own rules.

Spec rules (agentskills.io/specification, retrieved 2026-07-17):
  - name: 1-64 chars, lowercase a-z 0-9 and single hyphens, no leading/
    trailing hyphen, no consecutive hyphens, must equal the directory name
  - description: 1-1024 chars
  - compatibility: <=500 chars when present
  - metadata: mapping of string -> string when present

Repository rules:
  - SKILL.md body <=500 lines and under ~5000 estimated tokens
  - frontmatter metadata must carry the version contract keys
  - every relative path mentioned in SKILL.md exists
  - every file in references/ is mentioned in SKILL.md (the agent must be
    told when to load each reference)
  - no absolute filesystem paths anywhere in skill content

The official reference validator (`pip install skills-ref`, CLI
`agentskills validate`) runs in CI in addition to this script.

Usage: python3 tooling/validate_skills.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / "skills"

NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

REQUIRED_METADATA_KEYS = {
    "skill-version",
    "verified-date",
    "verified-platform",
    "verified-targets",
}
# Per-skill component pins (moonbit-language pins moonc; moonbit-toolchain
# pins moon + moonrun). Checked here for presence; consistency with the
# toolchain snapshot is tooling/check_versions.py's job.
REQUIRED_COMPONENT_KEYS = {
    "moonbit-language": {"moonc-version"},
    "moonbit-toolchain": {"moon-version", "moonrun-version"},
}


def parse_frontmatter(text: str) -> tuple[dict, str, list[str]]:
    """Minimal YAML-subset frontmatter parser (scalars + one-level maps).

    Returns (frontmatter, body, errors). Deliberately strict: this repo's
    frontmatter must stay in the simple subset every client can parse.
    """
    errors: list[str] = []
    if not text.startswith("---\n"):
        return {}, text, ["missing frontmatter opening '---'"]
    try:
        end = text.index("\n---\n", 4)
    except ValueError:
        return {}, text, ["missing frontmatter closing '---'"]
    raw, body = text[4:end], text[end + 5 :]

    data: dict = {}
    current_map: dict | None = None
    for line_no, line in enumerate(raw.splitlines(), start=2):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line.startswith("  ") and current_map is not None:
            m = re.match(r"^  ([A-Za-z0-9_-]+):\s*(.*)$", line)
            if not m:
                errors.append(f"line {line_no}: unparseable nested entry {line!r}")
                continue
            current_map[m.group(1)] = m.group(2).strip().strip("\"'")
        else:
            m = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
            if not m:
                errors.append(f"line {line_no}: unparseable entry {line!r}")
                continue
            key, value = m.group(1), m.group(2).strip()
            if value == "":
                current_map = {}
                data[key] = current_map
            else:
                data[key] = value.strip().strip("\"'")
                current_map = None
    return data, body, errors


def validate_skill(skill_dir: Path) -> list[str]:
    problems: list[str] = []
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.is_file():
        return [f"{skill_dir.name}: missing SKILL.md"]
    text = skill_md.read_text()
    fm, body, fm_errors = parse_frontmatter(text)
    problems += [f"frontmatter: {e}" for e in fm_errors]

    name = fm.get("name", "")
    if not isinstance(name, str) or not NAME_RE.match(name) or len(name) > 64:
        problems.append(f"name {name!r} violates spec naming rules")
    if name != skill_dir.name:
        problems.append(f"name {name!r} != directory name {skill_dir.name!r}")

    description = fm.get("description", "")
    if not isinstance(description, str) or not (1 <= len(description) <= 1024):
        problems.append(
            f"description length {len(description)} outside 1..1024 chars"
        )

    compatibility = fm.get("compatibility", "")
    if compatibility and len(compatibility) > 500:
        problems.append(f"compatibility length {len(compatibility)} > 500 chars")

    metadata = fm.get("metadata", {})
    if not isinstance(metadata, dict):
        problems.append("metadata must be a mapping")
        metadata = {}
    for key, value in metadata.items():
        if not isinstance(value, str):
            problems.append(f"metadata.{key} must be a string")
    required = REQUIRED_METADATA_KEYS | REQUIRED_COMPONENT_KEYS.get(name, set())
    missing = required - set(metadata)
    if missing:
        problems.append(f"metadata missing version-contract keys: {sorted(missing)}")

    body_lines = body.count("\n") + 1
    if body_lines > 500:
        problems.append(f"SKILL.md body has {body_lines} lines (> 500)")
    est_tokens = len(body) // 4
    if est_tokens > 5000:
        problems.append(f"SKILL.md body ~{est_tokens} tokens (> 5000)")

    # Relative path references in SKILL.md must exist.
    referenced: set[str] = set()
    for match in re.finditer(
        r"(?<![A-Za-z0-9_./-])((?:references|scripts|assets)/[A-Za-z0-9_./-]+[A-Za-z0-9_])",
        body,
    ):
        referenced.add(match.group(1))
    for rel in sorted(referenced):
        if not (skill_dir / rel).is_file():
            problems.append(f"SKILL.md references missing file {rel}")

    # Every reference/script file must be mentioned so agents know when to
    # load it (progressive disclosure requires an explicit routing hint).
    for sub in ("references", "scripts"):
        subdir = skill_dir / sub
        if not subdir.is_dir():
            continue
        for f in sorted(subdir.iterdir()):
            if f.name.startswith(".") or not f.is_file():
                continue
            rel = f"{sub}/{f.name}"
            # A generated .md twin of an .mbt.md source counts via its source.
            if rel not in referenced and rel not in body:
                problems.append(f"{rel} exists but SKILL.md never mentions it")

    for f in skill_dir.rglob("*"):
        if f.is_file() and f.suffix in (".md", ".mbt", ".sh", ".py"):
            if re.search(r"(?<![\w@])/(?:Users|home|private/tmp)/", f.read_text()):
                problems.append(f"{f.relative_to(skill_dir)}: absolute path leaked")

    return [f"{skill_dir.name}: {p}" for p in problems]


def main() -> int:
    skill_dirs = sorted(d for d in SKILLS_DIR.iterdir() if d.is_dir())
    if not skill_dirs:
        print("no skills found", file=sys.stderr)
        return 2
    all_problems: list[str] = []
    for skill_dir in skill_dirs:
        all_problems += validate_skill(skill_dir)
    for problem in all_problems:
        print(f"FAIL {problem}", file=sys.stderr)
    if not all_problems:
        print(f"validated {len(skill_dirs)} skill(s): OK")
    return 1 if all_problems else 0


if __name__ == "__main__":
    sys.exit(main())

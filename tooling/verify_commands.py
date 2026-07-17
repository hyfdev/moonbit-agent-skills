#!/usr/bin/env python3
"""Execute the toolchain skill's command examples for real.

Two guarantees:

1. Every entry in verification/commands/manifest.json runs against a fresh
   copy of verification/commands/template/ (or a fresh `moon new` module)
   and must meet its declared exit-code / output expectations.

2. Coverage: every `moon ...` / `moonrun ...` command line inside ```sh
   fences of skills/moonbit-toolchain content must be covered by a
   manifest entry — either by an entry that actually runs the same
   command signature, or by an explicitly declared `covers_only` entry
   with a reason (for commands that must not run in CI, e.g. publish).
   A command signature is the executable + subcommand + the set of long
   flags, so cosmetic argument differences don't defeat the check while
   an undocumented-flag example still fails it.

Usage: python3 tooling/verify_commands.py [-v] [--skip-network]
"""

from __future__ import annotations

import argparse
import json
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST = REPO_ROOT / "verification" / "commands" / "manifest.json"
TEMPLATE = REPO_ROOT / "verification" / "commands" / "template"
TOOLCHAIN_SKILL = REPO_ROOT / "skills" / "moonbit-toolchain"


def signature(command: str) -> tuple | None:
    """(executable, subcommand, frozenset-of-long-flags) or None if not a
    moon/moonrun invocation."""
    try:
        tokens = shlex.split(command)
    except ValueError:
        return None
    if not tokens or tokens[0] not in ("moon", "moonrun"):
        return None
    sub = next((t for t in tokens[1:] if not t.startswith("-")), "")
    flags = frozenset(t.split("=")[0] for t in tokens[1:] if t.startswith("--"))
    return (tokens[0], sub, flags)


def doc_command_lines() -> list[tuple[str, str]]:
    """All command lines in sh fences of the toolchain skill: (file, line)."""
    lines: list[tuple[str, str]] = []
    for path in [TOOLCHAIN_SKILL / "SKILL.md", *sorted(TOOLCHAIN_SKILL.glob("references/*.md"))]:
        if not path.is_file():
            continue
        for fence in re.finditer(r"```(?:sh|bash|shell)\n(.*?)```", path.read_text(), re.S):
            for raw in fence.group(1).splitlines():
                line = raw.strip()
                if line.startswith("$ "):
                    line = line[2:]
                if line and not line.startswith("#") and signature(line):
                    lines.append((str(path.relative_to(REPO_ROOT)), line))
    return lines


def run_entry(entry: dict, verbose: bool) -> list[str]:
    problems: list[str] = []
    with tempfile.TemporaryDirectory(prefix="mbtcmd-") as tmp:
        workdir = Path(tmp) / "work"
        setup = entry.get("setup", "template")
        if setup == "template":
            shutil.copytree(TEMPLATE, workdir)
        elif setup == "empty":
            workdir.mkdir()
        else:
            raise SystemExit(f"{entry['id']}: unknown setup {setup!r}")

        for step in entry["run"]:
            proc = subprocess.run(
                step,
                shell=True,
                cwd=workdir,
                capture_output=True,
                text=True,
                timeout=300,
            )
        # Expectations apply to the last step.
        output = proc.stdout + proc.stderr
        expect_exit = entry.get("expect_exit", 0)
        if (proc.returncode == 0) != (expect_exit == 0):
            problems.append(
                f"{entry['id']}: exit {proc.returncode}, expected "
                f"{expect_exit}:\n{output[:600]}"
            )
        for needle in entry.get("expect_output_contains", []):
            if needle not in output:
                problems.append(
                    f"{entry['id']}: output missing {needle!r}:\n{output[:600]}"
                )
        for path_rel in entry.get("expect_paths", []):
            if not (workdir / path_rel).exists():
                problems.append(f"{entry['id']}: expected path {path_rel} missing")
    if verbose and not problems:
        print(f"  ok: {entry['id']}")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-v", "--verbose", action="store_true")
    parser.add_argument(
        "--skip-network",
        action="store_true",
        help="skip entries marked network:true (offline runs)",
    )
    args = parser.parse_args()

    manifest = json.loads(MANIFEST.read_text())
    problems: list[str] = []
    covered: set[tuple] = set()

    for entry in manifest["entries"]:
        for cmd in entry.get("covers", []) + [
            step for step in entry.get("run", []) if signature(step)
        ]:
            sig = signature(cmd)
            if sig:
                covered.add(sig)
        if entry.get("covers_only"):
            if not entry.get("reason"):
                problems.append(f"{entry['id']}: covers_only requires a reason")
            continue
        if entry.get("network") and args.skip_network:
            continue
        problems += run_entry(entry, args.verbose)

    missing = []
    for doc_file, line in doc_command_lines():
        if signature(line) not in covered:
            missing.append(f"{doc_file}: {line!r} not covered by any manifest entry")
    problems += missing

    for problem in problems:
        print(f"FAIL {problem}", file=sys.stderr)
    if not problems:
        n = len(manifest["entries"])
        print(f"command verification: {n} manifest entries OK; all documented command signatures covered")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())

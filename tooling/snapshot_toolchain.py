#!/usr/bin/env python3
"""Capture a toolchain snapshot into verification/toolchains/current.json.

The snapshot records the exact toolchain the repository's content was
verified against. It is generated, committed, and treated as the single
source of truth for version metadata everywhere else in the repository
(skill frontmatter, SKILL.md compatibility notes, README). Other tooling
checks consistency against this file; nothing else hand-writes versions.

Deterministic: output depends only on the installed toolchain, the host
platform, and the --date argument (no wall-clock reads without opt-in).

Usage:
  python3 tooling/snapshot_toolchain.py --date 2026-07-17 [--targets wasm-gc,wasm,js,native]
"""

from __future__ import annotations

import argparse
import json
import platform
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT_PATH = REPO_ROOT / "verification" / "toolchains" / "current.json"

# Two observed shapes:
#   "0.1.20260713 (75c7e1f 2026-07-13)"          (moon, moonrun; may carry a
#                                                 leading repeated tool name)
#   "v0.10.4+ade96c819 (2026-07-13)"             (moonc; commit after '+')
VERSION_RE = re.compile(
    r"^(?:[a-z-]+ )?v?(?P<version>[0-9][^ ]*) \((?:(?P<commit>[0-9a-f]+) )?(?P<date>\d{4}-\d{2}-\d{2})\)$"
)


def run(cmd: list[str]) -> str:
    return subprocess.run(
        cmd, check=True, capture_output=True, text=True
    ).stdout.strip()


def parse_component(item: dict) -> dict:
    raw = item["version"].strip()
    m = VERSION_RE.match(raw)
    if not m:
        raise SystemExit(f"unrecognized version string for {item['name']}: {raw!r}")
    return {
        "name": item["name"],
        "version": m.group("version"),
        "commit": m.group("commit") or "",
        "build_date": m.group("date"),
        "raw": raw,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", required=True, help="verification date, YYYY-MM-DD")
    parser.add_argument(
        "--targets",
        default="wasm-gc,wasm,js,native",
        help="comma-separated targets actually exercised during verification",
    )
    args = parser.parse_args()

    if not re.match(r"^\d{4}-\d{2}-\d{2}$", args.date):
        raise SystemExit("--date must be YYYY-MM-DD")

    version_all = json.loads(run(["moon", "version", "--all", "--json"]))
    components = [parse_component(item) for item in version_all["items"]]

    snapshot = {
        "_generated_by": "tooling/snapshot_toolchain.py (do not edit by hand)",
        "verification_date": args.date,
        "platform": {
            "os": platform.system(),
            "os_version": platform.mac_ver()[0] or platform.release(),
            "arch": platform.machine(),
        },
        "components": components,
        "verified_targets": sorted(args.targets.split(",")),
        "raw_version_all": run(["moon", "version", "--all"]),
    }

    SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_PATH.write_text(json.dumps(snapshot, indent=2, sort_keys=True) + "\n")
    print(f"wrote {SNAPSHOT_PATH.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

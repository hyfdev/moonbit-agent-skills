#!/usr/bin/env python3
"""Run every fixture under verification/fixtures/ against the real toolchain.

For each fixture directory (see verification/fixtures/README.md):
  1. materialize a throwaway MoonBit module containing the fixture code,
  2. run `moon check` / `moon test` for each declared target,
  3. assert the declared expectation (pass / fail / diagnostic substrings),
  4. for fixtures with a fixed.mbt, additionally assert the fix passes.

Exit code 0 only if every fixture behaves exactly as declared.

With --stamp --date YYYY-MM-DD, passing fixtures get a `verified` block
written back into their fixture.json (component versions, platform, date).

Usage:
  python3 tooling/run_fixtures.py [fixture-id ...] [--stamp --date YYYY-MM-DD] [-v]
"""

from __future__ import annotations

import argparse
import json
import platform
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURES_DIR = REPO_ROOT / "verification" / "fixtures"

MOON_MOD_TEMPLATE = 'name = "mbtskills/fixture"\nversion = "0.1.0"\n'


def moon_versions() -> dict[str, str]:
    out = json.loads(
        subprocess.run(
            ["moon", "version", "--all", "--json"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    )
    return {item["name"]: item["version"].strip() for item in out["items"]}


def run_moon(args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["moon", *args, "--no-render"],
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=300,
    )


def materialize(fixture_dir: Path, workdir: Path, which_code: str) -> Path:
    """Single-file fixtures carry code.mbt (and optionally fixed.mbt);
    multi-package fixtures carry a complete module under module/."""
    mod_dir = workdir / "fixture_mod"
    module_src = fixture_dir / "module"
    if module_src.is_dir():
        shutil.copytree(module_src, mod_dir)
        return mod_dir
    mod_dir.mkdir()
    (mod_dir / "moon.mod").write_text(MOON_MOD_TEMPLATE)
    (mod_dir / "moon.pkg").write_text("")
    (mod_dir / "lib.mbt").write_text((fixture_dir / which_code).read_text())
    return mod_dir


def check_one(fixture_dir: Path, verbose: bool) -> tuple[bool, str]:
    meta = json.loads((fixture_dir / "fixture.json").read_text())
    expect = meta["expect"]
    targets = meta.get("targets", ["wasm-gc"])
    problems: list[str] = []

    with tempfile.TemporaryDirectory(prefix="mbtfix-") as tmp:
        tmp_path = Path(tmp)
        mod_dir = materialize(fixture_dir, tmp_path, "code.mbt")
        for target in targets:
            if expect in ("check-fail", "check-pass"):
                proc = run_moon(["check", "--target", target], mod_dir)
            elif expect in ("test-pass", "semantic-trap"):
                proc = run_moon(["test", "--target", target], mod_dir)
            else:
                return False, f"unknown expect {expect!r}"
            output = proc.stdout + proc.stderr
            failed = proc.returncode != 0

            if expect == "check-fail":
                if not failed:
                    problems.append(f"[{target}] expected check to fail, it passed")
            else:
                if failed:
                    problems.append(
                        f"[{target}] expected success, got exit {proc.returncode}:\n{output[:800]}"
                    )
            # Diagnostic/warning substrings are asserted for every expect
            # kind (e.g. deprecated forms that pass with a warning).
            for needle in meta.get("diagnostic_contains", []):
                if needle not in output:
                    problems.append(
                        f"[{target}] output missing {needle!r}; got:\n{output[:800]}"
                    )

        fixed = fixture_dir / "fixed.mbt"
        if fixed.exists():
            shutil.rmtree(mod_dir)
            mod_dir = materialize(fixture_dir, tmp_path, "fixed.mbt")
            for target in targets:
                proc = run_moon(["check", "--target", target], mod_dir)
                if proc.returncode != 0:
                    problems.append(
                        f"[{target}] fixed.mbt must pass moon check but failed:\n"
                        f"{(proc.stdout + proc.stderr)[:800]}"
                    )

    if verbose and not problems:
        print(f"  ok: {meta['id']} ({expect}, targets={','.join(targets)})")
    return not problems, "\n".join(problems)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ids", nargs="*", help="fixture ids to run (default: all)")
    parser.add_argument("--stamp", action="store_true")
    parser.add_argument("--date", help="YYYY-MM-DD, required with --stamp")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()
    if args.stamp and not args.date:
        parser.error("--stamp requires --date")

    fixture_dirs = sorted(
        d for d in FIXTURES_DIR.iterdir() if (d / "fixture.json").is_file()
    )
    if args.ids:
        fixture_dirs = [d for d in fixture_dirs if d.name in set(args.ids)]
        missing = set(args.ids) - {d.name for d in fixture_dirs}
        if missing:
            print(f"unknown fixture ids: {sorted(missing)}", file=sys.stderr)
            return 2
    if not fixture_dirs:
        print("no fixtures found", file=sys.stderr)
        return 2

    versions = moon_versions()
    failures = 0
    for fixture_dir in fixture_dirs:
        ok, detail = check_one(fixture_dir, args.verbose)
        if not ok:
            failures += 1
            print(f"FAIL {fixture_dir.name}:\n{detail}\n", file=sys.stderr)
        elif args.stamp:
            meta_path = fixture_dir / "fixture.json"
            meta = json.loads(meta_path.read_text())
            meta["verified"] = {
                "date": args.date,
                "components": versions,
                "platform": f"{platform.system()}-{platform.machine()}",
            }
            meta_path.write_text(json.dumps(meta, indent=2) + "\n")

    total = len(fixture_dirs)
    print(f"fixtures: {total - failures}/{total} behaved as declared")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

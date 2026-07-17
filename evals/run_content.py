#!/usr/bin/env python3
"""Content eval: given the same task in isolated fresh contexts, compare
agent outcomes across knowledge conditions.

Conditions (--condition, repeatable):
  none            no MoonBit skills installed (pretraining baseline)
  official        the official moonbitlang/skills bundle (cloned at a
                  pinned commit into .claude/skills)
  ours            this repository's two skills, catalog-only discovery
  forced-language this repository's moonbit-language SKILL.md injected
                  directly into the prompt (separates content quality from
                  activation quality)
  forced-toolchain same, for moonbit-toolchain

Each task lives in evals/<area>/tasks/<task-id>/ with task.json and an
optional workspace/ directory. Grading is deterministic: real moon
commands over the resulting workspace plus file/output assertions — no
LLM judging. See evals/README.md for the task.json schema.

Usage:
  python3 evals/run_content.py --area language --condition none --condition ours \
      [--ids t1,t2] [--model claude-haiku-4-5-20251001] [--dry-run]

Results land in evals/<area>/runs/<run-name>/ (gitignored).
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
SKILLS_SRC = REPO_ROOT / "skills"

OFFICIAL_REPO = "https://github.com/moonbitlang/skills"
OFFICIAL_COMMIT = json.loads(
    (REPO_ROOT / "verification" / "sources" / "sources.json").read_text()
)["sources"]
OFFICIAL_COMMIT = next(
    s["commit"] for s in OFFICIAL_COMMIT if s["id"] == "moonbitlang-skills"
)

DISALLOWED_TOOLS = "WebFetch,WebSearch,Task"


def official_skills_checkout(cache_dir: Path) -> Path:
    dst = cache_dir / "moonbitlang-skills"
    if not dst.exists():
        subprocess.run(
            ["git", "clone", "--quiet", OFFICIAL_REPO, str(dst)], check=True
        )
        subprocess.run(
            ["git", "-C", str(dst), "checkout", "--quiet", OFFICIAL_COMMIT],
            check=True,
        )
    return dst / "skills"


def install_condition(project: Path, condition: str, cache_dir: Path) -> str:
    """Set up skills for the condition; returns extra prompt prefix."""
    skills_dst = project / ".claude" / "skills"
    if condition == "none":
        return ""
    if condition == "official":
        src_root = official_skills_checkout(cache_dir)
        skills_dst.mkdir(parents=True)
        for skill_dir in sorted(src_root.iterdir()):
            if (skill_dir / "SKILL.md").is_file():
                shutil.copytree(skill_dir, skills_dst / skill_dir.name)
        return ""
    if condition == "ours":
        skills_dst.mkdir(parents=True)
        for skill_dir in sorted(SKILLS_SRC.iterdir()):
            if (skill_dir / "SKILL.md").is_file():
                shutil.copytree(skill_dir, skills_dst / skill_dir.name)
        return ""
    if condition in ("forced-language", "forced-toolchain"):
        skill = "moonbit-" + condition.split("-", 1)[1]
        content = (SKILLS_SRC / skill / "SKILL.md").read_text()
        # Also expose references so the injected instructions can be followed.
        skills_dst.mkdir(parents=True)
        shutil.copytree(SKILLS_SRC / skill, skills_dst / skill)
        return (
            "The following instructions apply to this task:\n\n"
            f"{content}\n\n---\n\n"
        )
    raise SystemExit(f"unknown condition {condition!r}")


def grade(check: dict, project: Path, final_text: str) -> tuple[bool, str]:
    kind = check["type"]
    if kind == "moon":
        proc = subprocess.run(
            ["moon", *check["args"], "--no-render"],
            cwd=project,
            capture_output=True,
            text=True,
            timeout=600,
        )
        ok = (proc.returncode == 0) == check.get("expect_ok", True)
        return ok, f"moon {' '.join(check['args'])} -> exit {proc.returncode}"
    if kind == "file_exists":
        ok = (project / check["path"]).is_file()
        return ok, f"file_exists {check['path']} -> {ok}"
    if kind == "file_absent":
        ok = not (project / check["path"]).exists()
        return ok, f"file_absent {check['path']} -> {ok}"
    if kind == "file_contains":
        path = project / check["path"]
        ok = path.is_file() and re.search(check["regex"], path.read_text()) is not None
        return ok, f"file_contains {check['path']} ~ /{check['regex']}/ -> {ok}"
    if kind == "any_file_contains":
        ok = any(
            re.search(check["regex"], f.read_text()) is not None
            for f in project.rglob(check["glob"])
            if f.is_file()
        )
        return ok, f"any_file_contains {check['glob']} ~ /{check['regex']}/ -> {ok}"
    if kind == "output_matches":
        ok = re.search(check["regex"], final_text, re.I | re.S) is not None
        return ok, f"output_matches /{check['regex']}/ -> {ok}"
    if kind == "output_not_matches":
        ok = re.search(check["regex"], final_text, re.I | re.S) is None
        return ok, f"output_not_matches /{check['regex']}/ -> {ok}"
    if kind == "first_line_is":
        first = next((l.strip() for l in final_text.splitlines() if l.strip()), "")
        ok = first.upper().startswith(check["value"].upper())
        return ok, f"first_line_is {check['value']} -> got {first[:40]!r}"
    raise SystemExit(f"unknown check type {kind!r}")


def run_task(task_dir: Path, condition: str, model: str, max_turns: int, cache_dir: Path) -> dict:
    task = json.loads((task_dir / "task.json").read_text())
    with tempfile.TemporaryDirectory(prefix="mbteval-") as tmp:
        project = Path(tmp) / "project"
        workspace = task_dir / "workspace"
        if workspace.is_dir():
            shutil.copytree(workspace, project)
        else:
            project.mkdir()
        prefix = install_condition(project, condition, cache_dir)

        proc = subprocess.run(
            [
                "claude",
                "-p",
                prefix + task["prompt"],
                "--model",
                model,
                "--output-format",
                "stream-json",
                "--verbose",
                "--max-turns",
                str(max_turns),
                "--strict-mcp-config",
                "--dangerously-skip-permissions",
                "--disallowedTools",
                DISALLOWED_TOOLS,
            ],
            cwd=project,
            capture_output=True,
            text=True,
            timeout=1800,
        )

        final_text = ""
        activated: list[str] = []
        usage: dict = {}
        for line in proc.stdout.splitlines():
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("type") == "assistant":
                for block in event.get("message", {}).get("content", []):
                    if block.get("type") == "tool_use" and block.get("name") == "Skill":
                        activated.append(str(block.get("input", {}).get("skill", "")))
            elif event.get("type") == "result":
                final_text = event.get("result", "") or ""
                usage = event.get("usage", {})
                usage["total_cost_usd"] = event.get("total_cost_usd")
                usage["num_turns"] = event.get("num_turns")

        checks = []
        for check in task["grade"]:
            ok, detail = grade(check, project, final_text)
            checks.append({"check": check, "ok": ok, "detail": detail})

    return {
        "id": task["id"],
        "condition": condition,
        "passed": all(c["ok"] for c in checks),
        "checks": checks,
        "activated_skills": activated,
        "usage": usage,
        "exit_code": proc.returncode,
        "final_text_tail": final_text[-500:],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--area", required=True, choices=["language", "toolchain", "integration"])
    parser.add_argument("--condition", action="append", required=True)
    parser.add_argument("--ids", help="comma-separated task ids")
    parser.add_argument("--model", default="claude-haiku-4-5-20251001")
    parser.add_argument("--max-turns", type=int, default=30)
    parser.add_argument("--run-name", default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    tasks_dir = HERE / args.area / "tasks"
    task_dirs = sorted(d for d in tasks_dir.iterdir() if (d / "task.json").is_file())
    if args.ids:
        wanted = set(args.ids.split(","))
        task_dirs = [d for d in task_dirs if d.name in wanted]
    if not task_dirs:
        raise SystemExit("no tasks selected")
    if args.dry_run:
        for d in task_dirs:
            json.loads((d / "task.json").read_text())
        print(f"{len(task_dirs)} task(s) valid")
        return 0

    run_name = args.run_name or args.model.replace("/", "-")
    run_dir = HERE / args.area / "runs" / run_name
    run_dir.mkdir(parents=True, exist_ok=True)
    cache_dir = run_dir / "_cache"
    cache_dir.mkdir(exist_ok=True)

    results = []
    with (run_dir / "results.jsonl").open("a") as fh:
        for task_dir in task_dirs:
            for condition in args.condition:
                print(f"{task_dir.name} [{condition}] ...", flush=True)
                result = run_task(task_dir, condition, args.model, args.max_turns, cache_dir)
                results.append(result)
                fh.write(json.dumps(result) + "\n")
                fh.flush()
                print(f"    {'PASS' if result['passed'] else 'FAIL'}")

    by_condition: dict[str, list] = {}
    for r in results:
        by_condition.setdefault(r["condition"], []).append(r)
    summary = {
        "area": args.area,
        "model": args.model,
        "pass_rate_by_condition": {
            cond: f"{sum(1 for r in items if r['passed'])}/{len(items)}"
            for cond, items in sorted(by_condition.items())
        },
        "total_cost_usd": round(
            sum(r["usage"].get("total_cost_usd") or 0 for r in results), 4
        ),
    }
    (run_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

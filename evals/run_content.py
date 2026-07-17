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
  forced-language-no-cross-language
                  forced-language with the cross-language-habits rule and
                  reference removed (an H4 negative-knowledge ablation)
  forced-toolchain same, for moonbit-toolchain

Each task lives in evals/<area>/tasks/<task-id>/ with task.json and an
optional workspace/ directory. Grading is deterministic: real moon
commands over the resulting workspace plus file/output assertions — no
LLM judging. See evals/README.md for the task.json schema.

Usage:
  python3 evals/run_content.py --area language --condition none --condition ours \
      [--ids t1,t2] [--model claude-haiku-4-5-20251001] [--max-turns 50] [--dry-run]

Results land in evals/<area>/runs/<run-name>/ (gitignored).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
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

ALLOWED_TOOLS = "Bash,Edit,Write,Read,Glob,Grep"
DISALLOWED_TOOLS = "WebFetch,WebSearch,Task"
VALID_CONDITIONS = {
    "none",
    "official",
    "ours",
    "forced-language",
    "forced-language-no-cross-language",
    "forced-toolchain",
}


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
    actual_commit = subprocess.check_output(
        ["git", "-C", str(dst), "rev-parse", "HEAD"], text=True
    ).strip()
    if actual_commit != OFFICIAL_COMMIT:
        raise SystemExit(
            f"official skill cache is at {actual_commit}, expected {OFFICIAL_COMMIT}; "
            "use a fresh run name"
        )
    return dst / "skills"


def install_language_ablation(skills_dst: Path) -> str:
    """Install the language skill without its concentrated habit-transfer guide."""
    skill_dst = skills_dst / "moonbit-language"
    shutil.copytree(SKILLS_SRC / "moonbit-language", skill_dst)
    skill_path = skill_dst / "SKILL.md"
    content = skill_path.read_text()
    content = content.replace(
        ", or translating Rust, TypeScript, or Go habits into MoonBit", ""
    )
    content = re.sub(
        r"^- \*\*Cross-language habits are the main failure mode\.\*\*.*\n",
        "",
        content,
        flags=re.M,
    )
    content = re.sub(
        r"^- Rust/TS/Go habits and stale MoonBit forms .*\n", "", content, flags=re.M
    )
    skill_path.write_text(content)
    (skill_dst / "references" / "cross-language-and-stale-syntax.md").unlink()
    return content


def forced_prompt(content: str, skill: str) -> str:
    skill_root = f".claude/skills/{skill}"
    return (
        "The following instructions apply to this task. "
        f"Their skill root is `{skill_root}`; resolve every relative path such as "
        f"`references/...` or `scripts/...` from `{skill_root}`.\n\n"
        f"{content}\n\n---\n\n"
    )


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
    if condition == "forced-language-no-cross-language":
        skills_dst.mkdir(parents=True)
        content = install_language_ablation(skills_dst)
        return forced_prompt(content, "moonbit-language")
    if condition in ("forced-language", "forced-toolchain"):
        skill = "moonbit-" + condition.split("-", 1)[1]
        content = (SKILLS_SRC / skill / "SKILL.md").read_text()
        # Also expose references so the injected instructions can be followed.
        skills_dst.mkdir(parents=True)
        shutil.copytree(SKILLS_SRC / skill, skills_dst / skill)
        return forced_prompt(content, skill)
    raise SystemExit(f"unknown condition {condition!r}")


def file_digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def snapshot_files(root: Path) -> dict[str, str]:
    return {
        str(path.relative_to(root)): file_digest(path)
        for path in sorted(root.rglob("*"))
        if path.is_file() and not {"_build", ".claude"}.intersection(path.parts)
    }


def grade(
    check: dict,
    project: Path,
    final_text: str,
    bash_commands: list[dict],
    initial_files: dict[str, str],
) -> tuple[bool, str]:
    kind = check["type"]
    if kind == "moon":
        temporary_paths: list[Path] = []
        try:
            for relative, content in check.get("temp_files", {}).items():
                path = (project / relative).resolve()
                if not path.is_relative_to(project.resolve()):
                    raise ValueError(f"temporary grader path escapes project: {relative}")
                if path.exists():
                    raise ValueError(f"temporary grader path already exists: {relative}")
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content)
                temporary_paths.append(path)
            proc = subprocess.run(
                ["moon", *check["args"], "--no-render"],
                cwd=project,
                capture_output=True,
                text=True,
                timeout=600,
            )
        finally:
            for path in temporary_paths:
                path.unlink(missing_ok=True)
        ok = (proc.returncode == 0) == check.get("expect_ok", True)
        output = proc.stdout + proc.stderr
        match = None
        test_count_ok = None
        if "min_tests" in check:
            match = re.search(r"Total tests:\s*(\d+)", output)
            test_count_ok = (
                match is not None and int(match.group(1)) >= check["min_tests"]
            )
            ok = ok and test_count_ok
        detail = f"moon {' '.join(check['args'])} -> exit {proc.returncode}"
        if "min_tests" in check:
            found = match.group(1) if match else "missing"
            detail += f"; tests {found} >= {check['min_tests']} -> {test_count_ok}"
        if not ok:
            output_tail = output.strip()[-500:]
            if output_tail:
                detail += f"; tail: {output_tail}"
        return ok, detail
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
            if f.is_file() and not {"_build", ".claude"}.intersection(f.parts)
        )
        return ok, f"any_file_contains {check['glob']} ~ /{check['regex']}/ -> {ok}"
    if kind == "output_matches":
        ok = re.search(check["regex"], final_text, re.I | re.S) is not None
        return ok, f"output_matches /{check['regex']}/ -> {ok}"
    if kind == "output_not_matches":
        ok = re.search(check["regex"], final_text, re.I | re.S) is None
        return ok, f"output_not_matches /{check['regex']}/ -> {ok}"
    if kind == "command_matches":
        ok = any(
            not record.get("is_error", False)
            and re.search(check["regex"], str(record.get("command", "")), re.I | re.S)
            is not None
            and (
                "output_regex" not in check
                or re.search(
                    check["output_regex"], str(record.get("output", "")), re.I | re.S
                )
                is not None
            )
            for record in bash_commands
        )
        return ok, f"command_matches /{check['regex']}/ -> {ok}"
    if kind == "initial_files_unchanged":
        current_files = snapshot_files(project)
        changed = sorted(
            relative
            for relative, digest in initial_files.items()
            if current_files.get(relative) != digest
        )
        added = sorted(set(current_files) - set(initial_files))
        ok = not changed and not added
        detail = "initial_files_unchanged -> " + (
            "True" if ok else f"changed={changed!r}, added={added!r}"
        )
        return ok, detail
    if kind == "first_line_is":
        first = next((l.strip() for l in final_text.splitlines() if l.strip()), "")
        ok = first.upper() == check["value"].upper()
        return ok, f"first_line_is {check['value']} -> got {first[:40]!r}"
    raise SystemExit(f"unknown check type {kind!r}")


def parse_stream(stdout: str) -> dict:
    parsed = {
        "final_text": "",
        "activated_skills": [],
        "bash_results": [],
        "tool_uses": [],
        "usage": {},
        "model_usage": {},
    }
    pending_bash: dict[str, str] = {}
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "assistant":
            for block in event.get("message", {}).get("content", []):
                if block.get("type") != "tool_use":
                    continue
                name = str(block.get("name", ""))
                inputs = block.get("input", {})
                parsed["tool_uses"].append({"name": name, "input": inputs})
                if name == "Skill":
                    parsed["activated_skills"].append(
                        str(inputs.get("skill", ""))
                    )
                elif name == "Bash":
                    tool_id = str(block.get("id", ""))
                    if tool_id:
                        pending_bash[tool_id] = str(inputs.get("command", ""))
        elif event.get("type") == "user":
            for block in event.get("message", {}).get("content", []):
                if block.get("type") != "tool_result":
                    continue
                tool_id = str(block.get("tool_use_id", ""))
                if tool_id not in pending_bash:
                    continue
                content = block.get("content", "")
                output = content if isinstance(content, str) else json.dumps(content)
                parsed["bash_results"].append(
                    {
                        "command": pending_bash.pop(tool_id),
                        "is_error": bool(block.get("is_error", False)),
                        "output": output,
                    }
                )
        elif event.get("type") == "result":
            parsed["final_text"] = event.get("result", "") or ""
            parsed["usage"] = event.get("usage", {})
            parsed["usage"]["total_cost_usd"] = event.get("total_cost_usd")
            parsed["usage"]["num_turns"] = event.get("num_turns")
            parsed["model_usage"] = event.get("modelUsage", {})
    return parsed


def run_task(
    task_dir: Path,
    condition: str,
    model: str,
    max_turns: int,
    cache_dir: Path,
    run_dir: Path,
) -> dict:
    task = json.loads((task_dir / "task.json").read_text())
    with tempfile.TemporaryDirectory(prefix="mbteval-") as tmp:
        project = Path(tmp) / "project"
        workspace = task_dir / "workspace"
        if workspace.is_dir():
            shutil.copytree(workspace, project)
        else:
            project.mkdir()
        initial_files = snapshot_files(project)
        prefix = install_condition(project, condition, cache_dir)

        command = [
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
            "--allowedTools",
            ALLOWED_TOOLS,
            "--disallowedTools",
            DISALLOWED_TOOLS,
        ]
        timed_out = False
        try:
            proc = subprocess.run(
                command,
                cwd=project,
                capture_output=True,
                text=True,
                timeout=1800,
            )
            stdout, stderr, exit_code = proc.stdout, proc.stderr, proc.returncode
        except subprocess.TimeoutExpired as error:
            timed_out = True
            stdout = error.stdout or ""
            stderr = error.stderr or ""
            if isinstance(stdout, bytes):
                stdout = stdout.decode(errors="replace")
            if isinstance(stderr, bytes):
                stderr = stderr.decode(errors="replace")
            exit_code = None

        artifact_stem = f"{task['id']}--{condition}"
        transcripts_dir = run_dir / "transcripts"
        transcripts_dir.mkdir(exist_ok=True)
        transcript_path = transcripts_dir / f"{artifact_stem}.jsonl"
        stderr_path = transcripts_dir / f"{artifact_stem}.stderr.txt"
        transcript_path.write_text(stdout)
        stderr_path.write_text(stderr)

        parsed = parse_stream(stdout)
        final_text = parsed["final_text"]
        bash_commands = parsed["bash_results"]

        checks = []
        for check in task["grade"]:
            ok, detail = grade(
                check, project, final_text, bash_commands, initial_files
            )
            checks.append({"check": check, "ok": ok, "detail": detail})

        client_ok = exit_code == 0 and not timed_out
        checks.append(
            {
                "check": {"type": "client_exit"},
                "ok": client_ok,
                "detail": f"claude exit {exit_code}; timed_out={timed_out}",
            }
        )
        passed = all(check["ok"] for check in checks)
        failed_workspace = None
        if not passed:
            failed_dir = run_dir / "failed-workspaces" / artifact_stem
            failed_dir.parent.mkdir(exist_ok=True)
            shutil.copytree(
                project,
                failed_dir,
                ignore=shutil.ignore_patterns("_build", ".claude"),
            )
            failed_workspace = str(failed_dir.relative_to(run_dir))

    return {
        "id": task["id"],
        "condition": condition,
        "passed": passed,
        "checks": checks,
        "activated_skills": parsed["activated_skills"],
        "usage": parsed["usage"],
        "model_usage": parsed["model_usage"],
        "exit_code": exit_code,
        "timed_out": timed_out,
        "tool_uses": parsed["tool_uses"],
        "bash_results": bash_commands,
        "transcript": str(transcript_path.relative_to(run_dir)),
        "stderr": str(stderr_path.relative_to(run_dir)),
        "failed_workspace": failed_workspace,
        "final_text": final_text,
        "final_text_tail": final_text[-500:],
    }


def preflight() -> dict:
    missing = [
        tool for tool in ("claude", "moon", "node", "git") if not shutil.which(tool)
    ]
    if missing:
        raise SystemExit(f"required tool(s) missing from PATH: {', '.join(missing)}")
    moon_version = subprocess.check_output(["moon", "version", "--all"], text=True)
    expected = json.loads(
        (REPO_ROOT / "verification" / "toolchains" / "current.json").read_text()
    )
    mismatches = [
        component["raw"]
        for component in expected["components"]
        if component["raw"] not in moon_version
    ]
    if mismatches:
        raise SystemExit(
            "MoonBit toolchain differs from verification/toolchains/current.json; "
            f"missing expected version line(s): {mismatches}"
        )
    return {
        "client": subprocess.check_output(["claude", "--version"], text=True).strip(),
        "node_version": subprocess.check_output(["node", "--version"], text=True).strip(),
        "moon_version_all": moon_version.strip(),
        "platform": platform.platform(),
        "official_skills_commit": OFFICIAL_COMMIT,
        "model_environment": {
            name: os.environ.get(name)
            for name in (
                "ANTHROPIC_MODEL",
                "ANTHROPIC_DEFAULT_HAIKU_MODEL",
                "ANTHROPIC_DEFAULT_SONNET_MODEL",
                "ANTHROPIC_DEFAULT_OPUS_MODEL",
                "CLAUDE_CODE_SUBAGENT_MODEL",
                "CLAUDE_CODE_EFFORT_LEVEL",
            )
            if os.environ.get(name)
        },
    }


def ensure_run_manifest(run_dir: Path, config: dict, has_results: bool) -> None:
    manifest_path = run_dir / "run.json"
    if manifest_path.exists():
        previous = json.loads(manifest_path.read_text())
        if previous != config:
            differing = sorted(
                key
                for key in set(previous) | set(config)
                if previous.get(key) != config.get(key)
            )
            raise SystemExit(
                "run configuration differs from existing run.json for: "
                + ", ".join(differing)
                + "; use a fresh --run-name"
            )
        return
    if has_results:
        raise SystemExit(
            "cannot safely resume results without run.json; use a fresh --run-name"
        )
    manifest_path.write_text(json.dumps(config, indent=2) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--area", required=True, choices=["language", "toolchain", "integration"])
    parser.add_argument("--condition", action="append", required=True)
    parser.add_argument("--ids", help="comma-separated task ids")
    parser.add_argument("--model", default="claude-haiku-4-5-20251001")
    parser.add_argument("--max-turns", type=int, default=50)
    parser.add_argument("--run-name", default=None)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    unknown_conditions = sorted(set(args.condition) - VALID_CONDITIONS)
    if unknown_conditions:
        raise SystemExit(f"unknown condition(s): {', '.join(unknown_conditions)}")

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

    environment = preflight()

    run_name = args.run_name or args.model.replace("/", "-")
    run_dir = HERE / args.area / "runs" / run_name
    run_dir.mkdir(parents=True, exist_ok=True)
    cache_dir = run_dir / "_cache"
    cache_dir.mkdir(exist_ok=True)

    results_path = run_dir / "results.jsonl"
    if results_path.exists() and not args.resume:
        raise SystemExit(
            f"{results_path} already exists; use a fresh --run-name or --resume"
        )
    run_config = {
        "area": args.area,
        "model": args.model,
        "max_turns": args.max_turns,
        "environment": environment,
    }
    ensure_run_manifest(run_dir, run_config, results_path.exists())
    previous_results = []
    if results_path.exists():
        previous_results = [
            json.loads(line) for line in results_path.read_text().splitlines() if line
        ]
    completed = {(r["id"], r["condition"]) for r in previous_results}
    results = list(previous_results)
    with results_path.open("a") as fh:
        for task_dir in task_dirs:
            for condition in args.condition:
                if (task_dir.name, condition) in completed:
                    print(f"{task_dir.name} [{condition}] ... already complete", flush=True)
                    continue
                print(f"{task_dir.name} [{condition}] ...", flush=True)
                result = run_task(
                    task_dir,
                    condition,
                    args.model,
                    args.max_turns,
                    cache_dir,
                    run_dir,
                )
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
        "max_turns": args.max_turns,
        "environment": environment,
        "resolved_models": sorted(
            {
                model
                for result in results
                for model in result.get("model_usage", {})
            }
        ),
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

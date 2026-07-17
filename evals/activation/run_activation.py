#!/usr/bin/env python3
"""Activation eval: can an agent that only sees the skill catalog decide,
per natural request, whether to load moonbit-language, moonbit-toolchain,
both, or neither?

For each prompt in prompts.jsonl the runner:
  1. creates a throwaway project directory,
  2. copies this repository's skills into <project>/.claude/skills/ (the
     agent is never told skill names — discovery happens only through the
     catalog that the client builds from name + description),
  3. materializes any workspace files the prompt declares,
  4. runs `claude -p "<prompt>"` headless and parses the stream-json
     transcript for Skill tool invocations,
  5. grades the activated set against the prompt's expectation.

Metrics reported: trigger recall per category, false-positive rate on
negative prompts, exact-routing accuracy, multi-skill accuracy on combined
prompts, recall on the not-named-moonbit slice, plus tokens/cost/turns.

The runner requires the Claude Code CLI (`claude`) with valid credentials.
It never injects skill content into prompts, so a pass here demonstrates
catalog-only automatic activation end to end.

Usage:
  python3 evals/activation/run_activation.py --model claude-haiku-4-5-20251001 \
      [--categories language-only,toolchain-only] [--ids id1,id2] [--dry-run]

Results land in evals/activation/runs/<run-name>/ (gitignored):
  results.jsonl  one line per prompt with activated set + verdict + usage
  summary.json   aggregated metrics
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent
SKILLS_SRC = REPO_ROOT / "skills"
MOONBIT_SKILLS = {"moonbit-language", "moonbit-toolchain"}

DISALLOWED_TOOLS = "Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch,Task"


def load_prompts(path: Path) -> list[dict]:
    prompts = []
    for line in path.read_text().splitlines():
        if line.strip():
            prompts.append(json.loads(line))
    ids = [p["id"] for p in prompts]
    if len(ids) != len(set(ids)):
        raise SystemExit("duplicate prompt ids in prompts.jsonl")
    for p in prompts:
        for skill in p["expected"].get("required", []) + p["expected"].get("forbidden", []):
            if skill not in MOONBIT_SKILLS:
                raise SystemExit(f"{p['id']}: unknown skill {skill!r} in expectation")
        lowered = p["prompt"].lower()
        if "moonbit-language" in lowered or "moonbit-toolchain" in lowered or "skill" in lowered:
            raise SystemExit(
                f"{p['id']}: prompt names a skill — that defeats the point of this eval"
            )
    return prompts


def run_one(prompt: dict, model: str, max_turns: int) -> dict:
    with tempfile.TemporaryDirectory(prefix="mbtact-") as tmp:
        project = Path(tmp) / "project"
        skills_dst = project / ".claude" / "skills"
        skills_dst.mkdir(parents=True)
        for skill_dir in sorted(SKILLS_SRC.iterdir()):
            if (skill_dir / "SKILL.md").is_file():
                shutil.copytree(skill_dir, skills_dst / skill_dir.name)
        for rel, content in prompt.get("workspace", {}).items():
            dest = project / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(content)

        proc = subprocess.run(
            [
                "claude",
                "-p",
                prompt["prompt"],
                "--model",
                model,
                "--output-format",
                "stream-json",
                "--verbose",
                "--max-turns",
                str(max_turns),
                "--strict-mcp-config",
                "--disallowedTools",
                DISALLOWED_TOOLS,
            ],
            cwd=project,
            capture_output=True,
            text=True,
            timeout=600,
        )

    activated: list[str] = []
    usage: dict = {}
    num_turns = None
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "assistant":
            for block in event.get("message", {}).get("content", []):
                if block.get("type") == "tool_use" and block.get("name") == "Skill":
                    skill = str(block.get("input", {}).get("skill", ""))
                    if skill and skill not in activated:
                        activated.append(skill)
        elif event.get("type") == "result":
            usage = event.get("usage", {})
            num_turns = event.get("num_turns")
            usage["total_cost_usd"] = event.get("total_cost_usd")

    required = set(prompt["expected"].get("required", []))
    forbidden = set(prompt["expected"].get("forbidden", []))
    activated_moonbit = set(activated) & MOONBIT_SKILLS
    verdict = {
        "recall_ok": required <= activated_moonbit,
        "no_forbidden": not (activated_moonbit & forbidden),
        "exact": activated_moonbit == required,
    }
    return {
        "id": prompt["id"],
        "category": prompt["category"],
        "moonbit_named": prompt.get("moonbit_named", True),
        "activated": sorted(activated_moonbit),
        "activated_all": activated,
        "expected": prompt["expected"],
        "verdict": verdict,
        "usage": usage,
        "num_turns": num_turns,
        "exit_code": proc.returncode,
        "stderr_tail": proc.stderr[-400:] if proc.returncode != 0 else "",
    }


def summarize(results: list[dict], model: str) -> dict:
    def rate(items: list[dict], pred) -> float | None:
        return round(sum(1 for r in items if pred(r)) / len(items), 3) if items else None

    by_cat: dict[str, list[dict]] = {}
    for r in results:
        by_cat.setdefault(r["category"], []).append(r)

    negatives = by_cat.get("negative", [])
    combined = by_cat.get("combined", [])
    unnamed = [r for r in results if not r["moonbit_named"] and r["category"] != "negative"]
    positives = [r for r in results if r["category"] != "negative"]
    return {
        "model": model,
        "n": len(results),
        "trigger_recall_overall": rate(positives, lambda r: r["verdict"]["recall_ok"]),
        "trigger_recall_by_category": {
            cat: rate(items, lambda r: r["verdict"]["recall_ok"])
            for cat, items in sorted(by_cat.items())
            if cat != "negative"
        },
        "false_positive_rate_negative": rate(
            negatives, lambda r: bool(set(r["activated"]))
        ),
        "routing_exact_accuracy": {
            cat: rate(items, lambda r: r["verdict"]["exact"])
            for cat, items in sorted(by_cat.items())
        },
        "multi_skill_accuracy_combined": rate(
            combined, lambda r: r["verdict"]["exact"]
        ),
        "recall_when_moonbit_not_named": rate(
            unnamed, lambda r: r["verdict"]["recall_ok"]
        ),
        "user_ever_needed_to_name_skill": False,
        "total_cost_usd": round(
            sum(r["usage"].get("total_cost_usd") or 0 for r in results), 4
        ),
        "errors": [r["id"] for r in results if r["exit_code"] != 0],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="claude-haiku-4-5-20251001")
    parser.add_argument("--max-turns", type=int, default=12)
    parser.add_argument("--categories", help="comma-separated filter")
    parser.add_argument("--ids", help="comma-separated prompt ids")
    parser.add_argument("--run-name", default=None)
    parser.add_argument("--dry-run", action="store_true", help="validate prompts only")
    args = parser.parse_args()

    prompts = load_prompts(HERE / "prompts.jsonl")
    if args.categories:
        wanted = set(args.categories.split(","))
        prompts = [p for p in prompts if p["category"] in wanted]
    if args.ids:
        wanted_ids = set(args.ids.split(","))
        prompts = [p for p in prompts if p["id"] in wanted_ids]
    if not prompts:
        raise SystemExit("no prompts selected")
    if args.dry_run:
        print(f"prompts.jsonl valid: {len(prompts)} prompt(s) selected")
        return 0

    run_name = args.run_name or f"{args.model.replace('/', '-')}"
    run_dir = HERE / "runs" / run_name
    run_dir.mkdir(parents=True, exist_ok=True)
    results_path = run_dir / "results.jsonl"

    results: list[dict] = []
    with results_path.open("w") as fh:
        for i, prompt in enumerate(prompts, 1):
            print(f"[{i}/{len(prompts)}] {prompt['id']} ...", flush=True)
            result = run_one(prompt, args.model, args.max_turns)
            results.append(result)
            fh.write(json.dumps(result) + "\n")
            fh.flush()
            status = "OK " if result["verdict"]["exact"] else "MISS"
            print(f"    {status} activated={result['activated']}")

    summary = summarize(results, args.model)
    (run_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

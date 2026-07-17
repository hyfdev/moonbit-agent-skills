from __future__ import annotations

import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock


RUNNER = Path(__file__).resolve().parents[2] / "evals" / "run_content.py"
SPEC = importlib.util.spec_from_file_location("run_content", RUNNER)
assert SPEC and SPEC.loader
run_content = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(run_content)


class GradeTests(unittest.TestCase):
    def test_first_line_is_exact(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            check = {"type": "first_line_is", "value": "YES"}
            self.assertTrue(run_content.grade(check, project, "YES\nwhy", [], {})[0])
            self.assertFalse(run_content.grade(check, project, "YESBUT\nwhy", [], {})[0])

    def test_command_matches_observed_bash_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            check = {"type": "command_matches", "regex": r"moon\s+test\s+utils/"}
            self.assertFalse(
                run_content.grade(check, project, "I ran moon test utils/", [], {})[0]
            )
            self.assertTrue(
                run_content.grade(
                    check,
                    project,
                    "",
                    [
                        {
                            "command": "moon test utils/utils_test.mbt",
                            "is_error": False,
                            "output": "passed",
                        }
                    ],
                    {},
                )[0]
            )

    def test_command_matches_rejects_failed_tool_result(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            check = {
                "type": "command_matches",
                "regex": r"moon\s+test\s+utils/",
                "output_regex": "passed: 1",
            }
            failed = {
                "command": "false && moon test utils/",
                "is_error": True,
                "output": "Exit code 1",
            }
            self.assertFalse(
                run_content.grade(check, Path(tmp), "", [failed], {})[0]
            )

    def test_single_test_task_accepts_package_path_with_trailing_slash(self) -> None:
        task_path = (
            RUNNER.parent
            / "toolchain"
            / "tasks"
            / "tool-single-test-command"
            / "task.json"
        )
        task = json.loads(task_path.read_text())
        command_check = next(
            check for check in task["grade"] if check["type"] == "command_matches"
        )
        with tempfile.TemporaryDirectory() as tmp:
            self.assertTrue(
                run_content.grade(
                    command_check,
                    Path(tmp),
                    "",
                    [
                        {
                            "command": "moon test utils/",
                            "is_error": False,
                            "output": "Total tests: 1, passed: 1, failed: 0.",
                        }
                    ],
                    {},
                )[0]
            )

    def test_single_test_task_rejects_extra_test_scope(self) -> None:
        task_path = (
            RUNNER.parent
            / "toolchain"
            / "tasks"
            / "tool-single-test-command"
            / "task.json"
        )
        task = json.loads(task_path.read_text())
        command_check = next(
            check for check in task["grade"] if check["type"] == "command_matches"
        )
        record = {
            "command": "moon test utils/utils_test.mbt root_test.mbt",
            "is_error": False,
            "output": "Total tests: 2, passed: 2, failed: 0.",
        }
        with tempfile.TemporaryDirectory() as tmp:
            self.assertFalse(
                run_content.grade(command_check, Path(tmp), "", [record], {})[0]
            )

    def test_any_file_contains_ignores_injected_skill_templates(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            template = project / ".claude" / "skills" / "example.mbt"
            template.parent.mkdir(parents=True)
            template.write_text("pub fn square(x : Int) -> Int { x * x }")
            check = {
                "type": "any_file_contains",
                "glob": "**/*.mbt",
                "regex": r"pub fn\s+square",
            }
            self.assertFalse(run_content.grade(check, project, "", [], {})[0])

    def test_initial_files_unchanged_detects_edit_delete_and_add(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            source = project / "source.mbt"
            source.write_text("before")
            initial = run_content.snapshot_files(project)
            check = {"type": "initial_files_unchanged"}
            self.assertTrue(run_content.grade(check, project, "", [], initial)[0])
            source.write_text("after")
            self.assertFalse(run_content.grade(check, project, "", [], initial)[0])
            source.unlink()
            self.assertFalse(run_content.grade(check, project, "", [], initial)[0])
            source.write_text("before")
            (project / "added.mbt").write_text("fn surprise() -> Unit {}")
            self.assertFalse(run_content.grade(check, project, "", [], initial)[0])

    def test_initial_files_unchanged_ignores_runner_and_build_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            (project / "source.mbt").write_text("before")
            initial = run_content.snapshot_files(project)
            (project / ".claude" / "skills").mkdir(parents=True)
            (project / ".claude" / "skills" / "SKILL.md").write_text("instructions")
            (project / "_build").mkdir()
            (project / "_build" / "result").write_text("generated")
            check = {"type": "initial_files_unchanged"}
            self.assertTrue(run_content.grade(check, project, "", [], initial)[0])

    def test_loop_status_task_rejects_generic_for_replacement(self) -> None:
        task_path = (
            RUNNER.parent / "language" / "tasks" / "lang-loop-status" / "task.json"
        )
        task = json.loads(task_path.read_text())
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            generic = "DEPRECATED\nUse a for loop with break."
            specific = "DEPRECATED\nUse the multi-binding for form with break."
            state_binders = (
                "DEPRECATED\nReplace with for state binders and explicit break."
            )
            self.assertFalse(
                all(
                    run_content.grade(check, project, generic, [], {})[0]
                    for check in task["grade"]
                )
            )
            self.assertTrue(
                all(
                    run_content.grade(check, project, specific, [], {})[0]
                    for check in task["grade"]
                )
            )
            self.assertTrue(
                all(
                    run_content.grade(check, project, state_binders, [], {})[0]
                    for check in task["grade"]
                )
            )

    def test_temporary_grader_file_is_present_only_during_moon(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            hidden = project / "zz_eval_test.mbt"

            def fake_run(*args, **kwargs):
                self.assertEqual(hidden.read_text(), "test {}\n")
                return subprocess.CompletedProcess(args[0], 0, "", "")

            check = {
                "type": "moon",
                "args": ["test"],
                "temp_files": {"zz_eval_test.mbt": "test {}\n"},
            }
            with mock.patch.object(run_content.subprocess, "run", side_effect=fake_run):
                self.assertTrue(run_content.grade(check, project, "", [], {})[0])
            self.assertFalse(hidden.exists())

    def test_moon_min_tests_rejects_successful_zero_test_run(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            proc = subprocess.CompletedProcess(
                ["moon", "test"], 0, "Total tests: 0, passed: 0, failed: 0.\n", ""
            )
            check = {"type": "moon", "args": ["test"], "min_tests": 1}
            with mock.patch.object(run_content.subprocess, "run", return_value=proc):
                self.assertFalse(
                    run_content.grade(check, Path(tmp), "", [], {})[0]
                )

    def test_moon_min_tests_preserves_nonzero_exit_failure(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            proc = subprocess.CompletedProcess(
                ["moon", "test"], 2, "Total tests: 1, passed: 0, failed: 1.\n", ""
            )
            check = {"type": "moon", "args": ["test"], "min_tests": 1}
            with mock.patch.object(run_content.subprocess, "run", return_value=proc):
                ok, detail = run_content.grade(check, Path(tmp), "", [], {})
            self.assertFalse(ok)
            self.assertIn("exit 2", detail)


class ConditionTests(unittest.TestCase):
    def test_forced_prompt_names_reference_root(self) -> None:
        prompt = run_content.forced_prompt("instructions", "moonbit-language")
        self.assertIn(".claude/skills/moonbit-language", prompt)
        self.assertIn("resolve every relative path", prompt)

    def test_language_ablation_removes_only_routed_cross_language_guide(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            skills = Path(tmp) / "skills"
            skills.mkdir()
            content = run_content.install_language_ablation(skills)
            skill = skills / "moonbit-language"
            self.assertNotIn("Cross-language habits are the main failure mode", content)
            self.assertNotIn("Rust/TS/Go habits and stale MoonBit forms", content)
            self.assertFalse(
                (skill / "references" / "cross-language-and-stale-syntax.md").exists()
            )
            self.assertTrue(
                (skill / "references" / "declarations-and-functions.mbt.md").is_file()
            )


class RunManifestTests(unittest.TestCase):
    def test_manifest_records_and_reuses_identical_configuration(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp)
            config = {"area": "language", "model": "model-a", "max_turns": 50}
            run_content.ensure_run_manifest(run_dir, config, False)
            run_content.ensure_run_manifest(run_dir, config, True)
            self.assertEqual(json.loads((run_dir / "run.json").read_text()), config)

    def test_manifest_rejects_changed_turn_budget(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp)
            run_content.ensure_run_manifest(
                run_dir,
                {"area": "language", "model": "model-a", "max_turns": 50},
                False,
            )
            with self.assertRaises(SystemExit):
                run_content.ensure_run_manifest(
                    run_dir,
                    {"area": "language", "model": "model-a", "max_turns": 30},
                    True,
                )

    def test_manifest_rejects_legacy_results(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(SystemExit):
                run_content.ensure_run_manifest(
                    Path(tmp),
                    {"area": "language", "model": "model-a", "max_turns": 50},
                    True,
                )


class StreamParserTests(unittest.TestCase):
    def test_bash_result_is_associated_with_its_tool_call(self) -> None:
        events = [
            {
                "type": "assistant",
                "message": {
                    "content": [
                        {
                            "type": "tool_use",
                            "id": "call-1",
                            "name": "Bash",
                            "input": {"command": "false && moon test utils/"},
                        }
                    ]
                },
            },
            {
                "type": "user",
                "message": {
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": "call-1",
                            "is_error": True,
                            "content": "Exit code 1",
                        }
                    ]
                },
            },
        ]
        parsed = run_content.parse_stream(
            "\n".join(json.dumps(event) for event in events)
        )
        self.assertEqual(
            parsed["bash_results"],
            [
                {
                    "command": "false && moon test utils/",
                    "is_error": True,
                    "output": "Exit code 1",
                }
            ],
        )


class PreflightTests(unittest.TestCase):
    def test_preflight_records_node_version(self) -> None:
        toolchain = json.loads(
            (RUNNER.parents[1] / "verification" / "toolchains" / "current.json").read_text()
        )

        def fake_output(command, **kwargs):
            if command[:2] == ["moon", "version"]:
                return toolchain["raw_version_all"] + "\n"
            if command[0] == "claude":
                return "2.1.212 (Claude Code)\n"
            if command[0] == "node":
                return "v24.18.0\n"
            raise AssertionError(command)

        with mock.patch.object(run_content.shutil, "which", return_value="/bin/tool"):
            with mock.patch.object(
                run_content.subprocess, "check_output", side_effect=fake_output
            ):
                with mock.patch.object(
                    run_content.platform, "platform", return_value="Linux-test"
                ):
                    environment = run_content.preflight()
        self.assertEqual(environment["node_version"], "v24.18.0")

    def test_preflight_rejects_missing_node(self) -> None:
        def fake_which(tool):
            return None if tool == "node" else "/bin/tool"

        with mock.patch.object(run_content.shutil, "which", side_effect=fake_which):
            with self.assertRaisesRegex(SystemExit, "node"):
                run_content.preflight()

if __name__ == "__main__":
    unittest.main()

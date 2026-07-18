import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vite-plus/test";
import {
  REPO_ROOT,
  ensureRunManifest,
  forcedPrompt,
  grade,
  installLanguageAblation,
  parseStream,
  preflight,
  snapshotFiles,
  type CommandResult,
  type CommandRunner,
  type JsonRecord,
} from "../../evals/run_content.ts";

const RUNNER = join(REPO_ROOT, "evals", "run_content.ts");

function temporary<T>(name: string, callback: (path: string) => T): T {
  const path = mkdtempSync(join(tmpdir(), name));
  try {
    return callback(path);
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
}

function commandResult(exitCode: number, stdout = "", stderr = ""): CommandResult {
  return { exitCode, stdout, stderr, timedOut: false };
}

function task(area: string, id: string): { grade: JsonRecord[] } {
  return JSON.parse(
    readFileSync(join(REPO_ROOT, "evals", area, "tasks", id, "task.json"), "utf8"),
  ) as { grade: JsonRecord[] };
}

describe("content eval grading", () => {
  it("requires the exact first non-empty line", () => {
    temporary("content-grade-", (project) => {
      const check = { type: "first_line_is", value: "YES" };
      expect(grade(check, project, "YES\nwhy", [], {}).ok).toBe(true);
      expect(grade(check, project, "YESBUT\nwhy", [], {}).ok).toBe(false);
    });
  });

  it("matches only observed Bash commands", () => {
    temporary("content-grade-", (project) => {
      const check = { type: "command_matches", regex: "moon\\s+test\\s+utils/" };
      expect(grade(check, project, "I ran moon test utils/", [], {}).ok).toBe(false);
      expect(
        grade(
          check,
          project,
          "",
          [
            {
              command: "moon test utils/utils_test.mbt",
              is_error: false,
              output: "passed",
            },
          ],
          {},
        ).ok,
      ).toBe(true);
    });
  });

  it("rejects a failed matching Bash result", () => {
    temporary("content-grade-", (project) => {
      const check = {
        type: "command_matches",
        regex: "moon\\s+test\\s+utils/",
        output_regex: "passed: 1",
      };
      expect(
        grade(
          check,
          project,
          "",
          [
            {
              command: "false && moon test utils/",
              is_error: true,
              output: "Exit code 1",
            },
          ],
          {},
        ).ok,
      ).toBe(false);
    });
  });

  it("accepts the single-test package path with a trailing slash", () => {
    const commandCheck = task("toolchain", "tool-single-test-command").grade.find(
      (check) => check.type === "command_matches",
    ) as JsonRecord;
    temporary("content-grade-", (project) => {
      expect(
        grade(
          commandCheck,
          project,
          "",
          [
            {
              command: "moon test utils/",
              is_error: false,
              output: "Total tests: 1, passed: 1, failed: 0.",
            },
          ],
          {},
        ).ok,
      ).toBe(true);
    });
  });

  it("rejects extra scope in the single-test command", () => {
    const commandCheck = task("toolchain", "tool-single-test-command").grade.find(
      (check) => check.type === "command_matches",
    ) as JsonRecord;
    temporary("content-grade-", (project) => {
      expect(
        grade(
          commandCheck,
          project,
          "",
          [
            {
              command: "moon test utils/utils_test.mbt root_test.mbt",
              is_error: false,
              output: "Total tests: 2, passed: 2, failed: 0.",
            },
          ],
          {},
        ).ok,
      ).toBe(false);
    });
  });

  it("ignores injected skill templates in any-file checks", () => {
    temporary("content-grade-", (project) => {
      const template = join(project, ".claude", "skills", "example.mbt");
      mkdirSync(dirname(template), { recursive: true });
      writeFileSync(template, "pub fn square(x : Int) -> Int { x * x }");
      expect(
        grade(
          {
            type: "any_file_contains",
            glob: "**/*.mbt",
            regex: "pub fn\\s+square",
          },
          project,
          "",
          [],
          {},
        ).ok,
      ).toBe(false);
    });
  });

  it("detects edits, deletions, and additions to initial files", () => {
    temporary("content-grade-", (project) => {
      const source = join(project, "source.mbt");
      writeFileSync(source, "before");
      const initial = snapshotFiles(project);
      const check = { type: "initial_files_unchanged" };
      expect(grade(check, project, "", [], initial).ok).toBe(true);
      writeFileSync(source, "after");
      expect(grade(check, project, "", [], initial).ok).toBe(false);
      rmSync(source);
      expect(grade(check, project, "", [], initial).ok).toBe(false);
      writeFileSync(source, "before");
      writeFileSync(join(project, "added.mbt"), "fn surprise() -> Unit {}");
      expect(grade(check, project, "", [], initial).ok).toBe(false);
    });
  });

  it("ignores injected skills and build artifacts in unchanged-file checks", () => {
    temporary("content-grade-", (project) => {
      writeFileSync(join(project, "source.mbt"), "before");
      const initial = snapshotFiles(project);
      const skill = join(project, ".claude", "skills", "SKILL.md");
      mkdirSync(dirname(skill), { recursive: true });
      writeFileSync(skill, "instructions");
      mkdirSync(join(project, "_build"));
      writeFileSync(join(project, "_build", "result"), "generated");
      expect(grade({ type: "initial_files_unchanged" }, project, "", [], initial).ok).toBe(true);
    });
  });

  it("rejects a generic loop replacement and accepts the specific migration", () => {
    const checks = task("language", "lang-loop-status").grade;
    temporary("content-grade-", (project) => {
      const allPass = (text: string): boolean =>
        checks.every((check) => grade(check, project, text, [], {}).ok);
      expect(allPass("DEPRECATED\nUse a for loop with break.")).toBe(false);
      expect(allPass("DEPRECATED\nUse the multi-binding for form with break.")).toBe(true);
      expect(allPass("DEPRECATED\nReplace with for state binders and explicit break.")).toBe(true);
    });
  });

  it("materializes temporary grader files only during the moon command", () => {
    temporary("content-grade-", (project) => {
      const hidden = join(project, "zz_eval_test.mbt");
      const runner: CommandRunner = () => {
        expect(readFileSync(hidden, "utf8")).toBe("test {}\n");
        return commandResult(0);
      };
      expect(
        grade(
          {
            type: "moon",
            args: ["test"],
            temp_files: { "zz_eval_test.mbt": "test {}\n" },
          },
          project,
          "",
          [],
          {},
          runner,
        ).ok,
      ).toBe(true);
      expect(existsSync(hidden)).toBe(false);
    });
  });

  it("rejects a successful moon run with too few tests", () => {
    temporary("content-grade-", (project) => {
      const runner: CommandRunner = () =>
        commandResult(0, "Total tests: 0, passed: 0, failed: 0.\n");
      expect(
        grade({ type: "moon", args: ["test"], min_tests: 1 }, project, "", [], {}, runner).ok,
      ).toBe(false);
    });
  });

  it("preserves a nonzero moon exit as a failure when the test count passes", () => {
    temporary("content-grade-", (project) => {
      const runner: CommandRunner = () =>
        commandResult(2, "Total tests: 1, passed: 0, failed: 1.\n");
      const result = grade(
        { type: "moon", args: ["test"], min_tests: 1 },
        project,
        "",
        [],
        {},
        runner,
      );
      expect(result.ok).toBe(false);
      expect(result.detail).toContain("exit 2");
    });
  });
});

describe("content eval conditions", () => {
  it("names the installed reference root in forced prompts", () => {
    const prompt = forcedPrompt("instructions", "moonbit-language");
    expect(prompt).toContain(".claude/skills/moonbit-language");
    expect(prompt).toContain("resolve every relative path");
  });

  it("removes only the routed cross-language guide from the ablation", () => {
    temporary("content-condition-", (root) => {
      const skills = join(root, "skills");
      mkdirSync(skills);
      const content = installLanguageAblation(skills);
      const skill = join(skills, "moonbit-language");
      expect(content).not.toContain("Cross-language habits are the main failure mode");
      expect(content).not.toContain("Rust/TS/Go habits and stale MoonBit forms");
      expect(existsSync(join(skill, "references", "cross-language-and-stale-syntax.md"))).toBe(
        false,
      );
      expect(existsSync(join(skill, "references", "declarations-and-functions.mbt.md"))).toBe(true);
    });
  });
});

describe("content eval run manifests", () => {
  it("records and reuses identical configuration", () => {
    temporary("content-manifest-", (runDirectory) => {
      const config = { area: "language", model: "model-a", max_turns: 50 };
      ensureRunManifest(runDirectory, config, false);
      ensureRunManifest(runDirectory, config, true);
      expect(JSON.parse(readFileSync(join(runDirectory, "run.json"), "utf8"))).toEqual(config);
    });
  });

  it("rejects a changed turn budget", () => {
    temporary("content-manifest-", (runDirectory) => {
      ensureRunManifest(runDirectory, { area: "language", model: "model-a", max_turns: 50 }, false);
      expect(() =>
        ensureRunManifest(
          runDirectory,
          { area: "language", model: "model-a", max_turns: 30 },
          true,
        ),
      ).toThrow("run configuration differs");
    });
  });

  it("rejects legacy results without a manifest", () => {
    temporary("content-manifest-", (runDirectory) => {
      expect(() =>
        ensureRunManifest(
          runDirectory,
          { area: "language", model: "model-a", max_turns: 50 },
          true,
        ),
      ).toThrow("cannot safely resume");
    });
  });
});

describe("content eval stream parser", () => {
  it("associates a Bash result with its tool call", () => {
    const events = [
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "call-1",
              name: "Bash",
              input: { command: "false && moon test utils/" },
            },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "call-1",
              is_error: true,
              content: "Exit code 1",
            },
          ],
        },
      },
    ];
    const parsed = parseStream(events.map((event) => JSON.stringify(event)).join("\n"));
    expect(parsed.bash_results).toEqual([
      {
        command: "false && moon test utils/",
        is_error: true,
        output: "Exit code 1",
      },
    ]);
  });
});

describe("content eval preflight", () => {
  it("records the Node version", () => {
    const toolchain = JSON.parse(
      readFileSync(join(REPO_ROOT, "verification", "toolchains", "current.json"), "utf8"),
    ) as { raw_version_all: string };
    const runner: CommandRunner = (command, args) => {
      if (command === "moon" && args[0] === "version") {
        return commandResult(0, toolchain.raw_version_all + "\n");
      }
      if (command === "claude") {
        return commandResult(0, "2.1.212 (Claude Code)\n");
      }
      if (command === "node") {
        return commandResult(0, "v24.18.0\n");
      }
      throw new Error("unexpected command: " + command);
    };
    const environment = preflight(
      runner,
      () => "/bin/tool",
      () => "Linux-test",
      {},
    );
    expect(environment.node_version).toBe("v24.18.0");
  });

  it("rejects a missing Node executable", () => {
    expect(() =>
      preflight(
        () => {
          throw new Error("runner should not be called");
        },
        (tool) => (tool === "node" ? undefined : "/bin/tool"),
      ),
    ).toThrow(/node/);
  });
});

it("executes the TypeScript content runner directly with Node 24", () => {
  const result = spawnSync(
    process.execPath,
    [
      RUNNER,
      "--area",
      "language",
      "--ids",
      "lang-explicit-extend",
      "--condition",
      "ours",
      "--dry-run",
    ],
    { encoding: "utf8" },
  );
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("1 task(s) valid");
});

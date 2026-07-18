import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vite-plus/test";
import {
  REPO_ROOT,
  catalogIsolation,
  discoveryEvidence,
  ensureRunManifest,
  forcedPrompt,
  grade,
  installLanguageAblation,
  installTopLevelExtendAblation,
  materializeGitSkills,
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
  it("supports negative and exact-count file assertions", () => {
    temporary("content-grade-", (project) => {
      const source = join(project, "api.mbt");
      writeFileSync(source, "pub extend Item with Trait::{describe}\n");
      expect(
        grade(
          { type: "file_not_contains", path: "api.mbt", regex: "Trait::\\{name" },
          project,
          "",
          [],
          {},
        ).ok,
      ).toBe(true);
      expect(
        grade(
          {
            type: "file_match_count",
            path: "api.mbt",
            regex: "pub\\s+extend",
            exact: 1,
          },
          project,
          "",
          [],
          {},
        ).ok,
      ).toBe(true);
      expect(
        grade(
          { type: "file_match_count", path: "api.mbt", regex: "extend", exact: 2 },
          project,
          "",
          [],
          {},
        ).ok,
      ).toBe(false);
    });
  });

  it("checks expected diagnostics from a failing moon command", () => {
    temporary("content-grade-", (project) => {
      const runner: CommandRunner = () => commandResult(1, "", "Error E4015: no method name\n");
      expect(
        grade(
          {
            type: "moon",
            args: ["check"],
            expect_ok: false,
            output_regex: "E4015|no method",
          },
          project,
          "",
          [],
          {},
          runner,
        ).ok,
      ).toBe(true);
    });
  });

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

  it("accepts only the requested single-test file path", () => {
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
              command: "moon test utils/utils_test.mbt",
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

  it("rejects package scope when another test file exists in that package", () => {
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

  it("removes top-level extend guidance while preserving the deep reference byte-for-byte", () => {
    temporary("content-condition-", (root) => {
      const skills = join(root, "skills");
      mkdirSync(skills);
      installTopLevelExtendAblation(skills);
      const installed = join(skills, "moonbit-language");
      const skill = readFileSync(join(installed, "SKILL.md"), "utf8");
      expect(skill).not.toContain("explicit extend/pub extend");
      expect(skill).not.toContain("Trait implementations do not automatically create dot-call");
      expect(skill).not.toContain("| Traits; generics; impls;");
      expect(
        readFileSync(join(installed, "references", "traits-and-generics.mbt.md"), "utf8"),
      ).toBe(
        readFileSync(
          join(REPO_ROOT, "skills", "moonbit-language", "references", "traits-and-generics.mbt.md"),
          "utf8",
        ),
      );
      expect(existsSync(join(skills, "moonbit-toolchain", "SKILL.md"))).toBe(true);
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
    expect(parsed.tool_uses[0]).toMatchObject({
      id: "call-1",
      name: "Bash",
      assistant_turn: 1,
    });
    expect(parsed.tool_results[0]).toMatchObject({
      tool_use_id: "call-1",
      is_error: true,
    });
  });

  it("requires a successful reference read before a later action turn", () => {
    const events = [
      {
        type: "assistant",
        message: {
          model: "claude-haiku-4-5-20251001",
          content: [
            {
              type: "tool_use",
              id: "skill-1",
              name: "Skill",
              input: { skill: "moonbit-language" },
            },
            {
              type: "tool_use",
              id: "read-1",
              name: "Read",
              input: {
                file_path: ".claude/skills/moonbit-language/references/traits-and-generics.mbt.md",
              },
            },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "skill-1", content: "loaded" },
            { type: "tool_result", tool_use_id: "read-1", content: "extend syntax" },
          ],
        },
      },
      {
        type: "assistant",
        message: {
          model: "claude-haiku-4-5-20251001",
          content: [
            {
              type: "tool_use",
              id: "edit-1",
              name: "Edit",
              input: { file_path: "lib/api.mbt" },
            },
          ],
        },
      },
    ];
    const parsed = parseStream(events.map((event) => JSON.stringify(event)).join("\n"));
    const evidence = discoveryEvidence(parsed, {
      skill: "moonbit-language",
      reference: "references/traits-and-generics.mbt.md",
    });
    expect(parsed.emitted_models).toEqual(["claude-haiku-4-5-20251001"]);
    expect(parsed.successful_skills).toEqual(["moonbit-language"]);
    expect(evidence).toEqual({
      requested_skill: "moonbit-language",
      requested_reference: "references/traits-and-generics.mbt.md",
      skill_activated_successfully: true,
      reference_read_successfully: true,
      reference_read_before_action: true,
    });
  });

  it("does not count a parallel same-turn read and action as discovery", () => {
    const events = [
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "read-1",
              name: "Read",
              input: { file_path: "references/traits-and-generics.mbt.md" },
            },
            {
              type: "tool_use",
              id: "edit-1",
              name: "Edit",
              input: { file_path: "api.mbt" },
            },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "read-1", content: "read" },
            { type: "tool_result", tool_use_id: "edit-1", content: "edited" },
          ],
        },
      },
    ];
    const parsed = parseStream(events.map((event) => JSON.stringify(event)).join("\n"));
    expect(
      discoveryEvidence(parsed, {
        reference: "references/traits-and-generics.mbt.md",
      }).reference_read_before_action,
    ).toBe(false);
  });

  it("counts a successful reference read before a knowledge-only final answer", () => {
    const events = [
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "read-1",
              name: "Read",
              input: { file_path: "references/types-structs-enums.mbt.md" },
            },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "read-1", content: "JSON layout" }],
        },
      },
      {
        type: "result",
        subtype: "success",
        is_error: false,
        result: '["Axes",{"x":-1,"y":1}]',
      },
    ];
    const parsed = parseStream(events.map((event) => JSON.stringify(event)).join("\n"));
    expect(
      discoveryEvidence(parsed, {
        reference: "references/types-structs-enums.mbt.md",
      }).reference_read_before_action,
    ).toBe(true);
  });
});

describe("content eval skill snapshots", () => {
  it("materializes a pinned Git skills tree with content digests", () => {
    temporary("content-snapshot-", (root) => {
      const repository = join(root, "repository");
      const destination = join(root, "snapshot");
      mkdirSync(join(repository, "skills", "moonbit-language"), { recursive: true });
      writeFileSync(
        join(repository, "skills", "moonbit-language", "SKILL.md"),
        "---\nname: moonbit-language\n---\n",
      );
      const git = (...args: string[]): void => {
        const result = spawnSync("git", args, { cwd: repository, encoding: "utf8" });
        expect(result.status, result.stderr).toBe(0);
      };
      git("init", "--quiet");
      git("config", "user.name", "Eval Test");
      git("config", "user.email", "eval@example.com");
      git("add", "skills");
      git("commit", "--quiet", "-m", "fixture");
      const snapshot = materializeGitSkills(repository, "HEAD", destination);
      expect(snapshot.commit).toMatch(/^[0-9a-f]{40,64}$/);
      expect(snapshot.files).toHaveProperty("moonbit-language/SKILL.md");
      expect(readFileSync(join(destination, "moonbit-language", "SKILL.md"), "utf8")).toContain(
        "name: moonbit-language",
      );
      expect(materializeGitSkills(repository, "HEAD", destination)).toEqual(snapshot);
    });
  });

  it("rejects a same-name global skill", () => {
    temporary("content-home-", (home) => {
      expect(catalogIsolation(home).conflicting_moonbit_language_skills).toEqual([]);
      const collision = join(home, ".claude", "skills", "moonbit-language", "SKILL.md");
      mkdirSync(dirname(collision), { recursive: true });
      writeFileSync(collision, "collision\n");
      expect(() => catalogIsolation(home)).toThrow("isolation failed");
    });
  });

  it("rejects a same-name global skill installed through a directory symlink", () => {
    temporary("content-home-", (home) => {
      const target = join(home, "installed-moonbit-language");
      mkdirSync(target);
      writeFileSync(join(target, "SKILL.md"), "collision\n");
      const skills = join(home, ".claude", "skills");
      mkdirSync(skills, { recursive: true });
      symlinkSync(target, join(skills, "moonbit-language"), "dir");
      expect(() => catalogIsolation(home)).toThrow("isolation failed");
    });
  });

  it("follows plugin directory symlinks once and rejects nested same-name skills", () => {
    temporary("content-home-", (home) => {
      const target = join(home, "plugin-target");
      const collision = join(target, "nested", "skills", "moonbit-language", "SKILL.md");
      mkdirSync(dirname(collision), { recursive: true });
      writeFileSync(collision, "collision\n");
      const plugins = join(home, ".claude", "plugins");
      mkdirSync(plugins, { recursive: true });
      symlinkSync(target, join(plugins, "linked-plugin"), "dir");
      symlinkSync(plugins, join(target, "nested", "cycle"), "dir");
      expect(() => catalogIsolation(home)).toThrow("isolation failed");
    });
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

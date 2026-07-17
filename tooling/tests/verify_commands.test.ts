import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  canonicalShellCommand,
  collectCoveredCommands,
  collectDocumentedCommands,
  coverageProblems,
  executeStep,
  loadManifest,
  parseManifest,
  runEntry,
  runCli,
  runManifest,
  verifyCoverage,
} from "../verify_commands.ts";
import type {
  DocumentedCommand,
  Manifest,
  MoonStep,
  ProcessResult,
  RunEntry,
  Step,
  StepExecutor,
} from "../verify_commands.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function manifestWithStep(step: Step, network = false): Manifest {
  return {
    schema_version: 2,
    entries: [
      {
        id: "example",
        fixture: "empty",
        ...(network ? { network: true } : {}),
        steps: [step],
      },
    ],
  };
}

function documented(source: string): DocumentedCommand {
  return {
    file: "skill.md",
    line: 1,
    source,
    key: canonicalShellCommand(source),
  };
}

function moon(argv: MoonStep["argv"]): MoonStep {
  return { kind: "moon", argv };
}

describe("manifest schema v2", () => {
  it("rejects arbitrary covers on an executable entry", () => {
    expect(() =>
      parseManifest({
        schema_version: 2,
        entries: [
          {
            id: "bad",
            fixture: "empty",
            steps: [{ kind: "moon", argv: ["moon", "check"] }],
            covers: ["moon build --target js"],
          },
        ],
      }),
    ).toThrow(/unknown field.*covers/);
  });

  it("requires a reason for documented-only coverage", () => {
    expect(() =>
      parseManifest({
        schema_version: 2,
        entries: [
          {
            id: "publish",
            documented_only: true,
            commands: ["moon publish"],
          },
        ],
      }),
    ).toThrow(/reason/);
  });

  it("rejects a documented shell without a Moon command", () => {
    expect(() =>
      parseManifest({
        schema_version: 2,
        entries: [
          {
            id: "bad-pipe",
            fixture: "empty",
            steps: [
              {
                kind: "documented-shell",
                script: "printf hello | sed s/h/H/",
              },
            ],
          },
        ],
      }),
    ).toThrow(/restricted documented-shell grammar|must execute a moon or moonrun command/);
  });

  it("rejects Moon commands hidden in an ordinary shell step", () => {
    expect(() =>
      parseManifest({
        schema_version: 2,
        entries: [
          {
            id: "hidden-command",
            fixture: "empty",
            steps: [
              {
                kind: "shell",
                script: "mkdir -p build\nmoon build --target js",
              },
            ],
          },
        ],
      }),
    ).toThrow(/use kind "moon" or "documented-shell"/);
  });

  it("does not mistake Moon text inside a heredoc for a command", () => {
    expect(() =>
      parseManifest({
        schema_version: 2,
        entries: [
          {
            id: "heredoc",
            fixture: "empty",
            steps: [
              {
                kind: "shell",
                script: "cat > note.txt <<'EOF'\nmoon build --target js\nEOF",
              },
            ],
          },
        ],
      }),
    ).not.toThrow();
  });

  it.each([
    "if true; then moon check; fi",
    "env MODE=test moon check",
    "command moon check",
    "time moon check",
    "/opt/moon/bin/moon check",
  ])("rejects a hidden Moon invocation in setup shell: %s", (script) => {
    expect(() =>
      parseManifest({
        schema_version: 2,
        entries: [
          {
            id: "hidden-moon",
            fixture: "empty",
            steps: [{ kind: "shell", script }],
          },
        ],
      }),
    ).toThrow(/contains a possible moon or moonrun command/);
  });

  it("rejects compound setup shell instead of allowing a later success to mask failure", () => {
    expect(() =>
      parseManifest({
        schema_version: 2,
        entries: [
          {
            id: "masked-setup",
            fixture: "empty",
            steps: [{ kind: "shell", script: "false; true" }],
          },
        ],
      }),
    ).toThrow(/split compound setup commands into steps/);
  });

  it("rejects documented shell where Moon can be skipped", () => {
    expect(() =>
      parseManifest({
        schema_version: 2,
        entries: [
          {
            id: "skipped-moon",
            fixture: "empty",
            steps: [
              {
                kind: "documented-shell",
                script: "true || moon check",
              },
            ],
          },
        ],
      }),
    ).toThrow(/unsupported shell syntax \|\|/);
  });

  it("rejects nonzero documented-shell expectations that could pass after && skips Moon", () => {
    expect(() =>
      parseManifest({
        schema_version: 2,
        entries: [
          {
            id: "skipped-after-failure",
            fixture: "empty",
            steps: [
              {
                kind: "documented-shell",
                script: "false && /definitely-not-installed/moon check",
                expect: { exit: 1 },
              },
            ],
          },
        ],
      }),
    ).toThrow(/expect\.exit must be 0.*success proves Moon ran/);
  });

  it.each([
    'env bash -c "moon check"',
    '/usr/bin/env sh -c "moon check"',
    'env bash -c "false; true"',
    'echo "$(false)"',
    "`printf moon` check",
  ])("rejects dynamic or nested setup shell: %s", (script) => {
    expect(() =>
      parseManifest({
        schema_version: 2,
        entries: [
          {
            id: "dynamic-setup",
            fixture: "empty",
            steps: [{ kind: "shell", script }],
          },
        ],
      }),
    ).toThrow(/possible moon|does not allow|not allowed/);
  });

  it("requires a quoted heredoc delimiter so its body cannot execute substitutions", () => {
    expect(() =>
      parseManifest({
        schema_version: 2,
        entries: [
          {
            id: "expanding-heredoc",
            fixture: "empty",
            steps: [
              {
                kind: "shell",
                script: "cat <<EOF\n$(moon check)\nEOF",
              },
            ],
          },
        ],
      }),
    ).toThrow(/heredoc delimiter EOF must be quoted/);
  });

  it.each([
    { kind: "shell", script: "mkdir /tmp/verifier-escaped" },
    { kind: "moon", argv: ["moon", "check", "../outside"] },
    { kind: "documented-shell", script: "cd .. && moon check" },
    {
      kind: "documented-shell",
      script: "mkdir /tmp/verifier-escaped && moon check",
    },
  ])("rejects a literal path outside the fixture: $script$argv", (step) => {
    expect(() =>
      parseManifest({
        schema_version: 2,
        entries: [
          {
            id: "escaping-path",
            fixture: "empty",
            steps: [step],
          },
        ],
      }),
    ).toThrow(/absolute path|parent-directory traversal/);
  });

  it.each([
    { kind: "shell", script: "mkdir {safe,../escaped}" },
    { kind: "shell", script: "mkdir {~,safe}/escaped" },
    { kind: "shell", script: "cat > {../outside,}" },
    { kind: "documented-shell", script: "cd {..,} && moon check" },
  ])("rejects shell brace expansion that can construct an escaping path: $script", (step) => {
    expect(() =>
      parseManifest({
        schema_version: 2,
        entries: [
          {
            id: "brace-escape",
            fixture: "empty",
            steps: [step],
          },
        ],
      }),
    ).toThrow(/uses brace expansion/);
  });

  it("does not apply shell expansion rules to direct Moon argv", () => {
    expect(() =>
      parseManifest({
        schema_version: 2,
        entries: [
          {
            id: "literal-braces",
            fixture: "empty",
            steps: [
              {
                kind: "moon",
                argv: ["moon", "run", "-e", "fn pair(a, b) { (a, b) }"],
              },
            ],
          },
        ],
      }),
    ).not.toThrow();
  });

  it.each([
    ["moon", "check", "-C/tmp"],
    ["moon", "check", "-C../outside"],
    ["moon", "check", "-CC:\\outside"],
    ["moon", "check", "--target-dir", "../outside"],
    ["moon", "check", "--target-dir=/tmp"],
  ])("rejects an escaping Moon path option: %s", (...argv) => {
    expect(() =>
      parseManifest({
        schema_version: 2,
        entries: [
          {
            id: "moon-path-option",
            fixture: "empty",
            steps: [{ kind: "moon", argv }],
          },
        ],
      }),
    ).toThrow(/absolute path|parent-directory traversal/);
  });

  it.each(["moon check -C/tmp", "moon check --target-dir ../outside"])(
    "rejects an escaping Moon path option in documented shell: %s",
    (script) => {
      expect(() =>
        parseManifest({
          schema_version: 2,
          entries: [
            {
              id: "documented-moon-path-option",
              fixture: "empty",
              steps: [{ kind: "documented-shell", script }],
            },
          ],
        }),
      ).toThrow(/absolute path|parent-directory traversal/);
    },
  );

  it.each([
    ["moon", "check", "-Cbuild"],
    ["moon", "check", "--target-dir", "build"],
    ["moon", "check", "--target-dir=build"],
  ])("accepts a fixture-local Moon path option: %s", (...argv) => {
    expect(() =>
      parseManifest({
        schema_version: 2,
        entries: [
          {
            id: "local-moon-path-option",
            fixture: "empty",
            steps: [{ kind: "moon", argv }],
          },
        ],
      }),
    ).not.toThrow();
  });

  it.each([
    ["-C"],
    ["--target-dir"],
    ["--target-dir="],
    ["-C", "--target", "js"],
    ["--target-dir", "--target", "js"],
  ])("rejects a Moon path option without a value: %s", (...options) => {
    expect(() =>
      parseManifest({
        schema_version: 2,
        entries: [
          {
            id: "missing-moon-path",
            fixture: "empty",
            steps: [{ kind: "moon", argv: ["moon", "check", ...options] }],
          },
        ],
      }),
    ).toThrow(/requires a path/);
  });

  it.each(["env --help moon check", "command --help moon check", "time --help moon check"])(
    "rejects wrapper options that can consume Moon without executing it: %s",
    (script) => {
      expect(() =>
        parseManifest({
          schema_version: 2,
          entries: [
            {
              id: "wrapper-option",
              fixture: "empty",
              steps: [{ kind: "documented-shell", script }],
            },
          ],
        }),
      ).toThrow(/does not allow (?:env|command|time) option/);
    },
  );
});

describe("verify-commands CLI", () => {
  it("prints help and exits successfully", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await runCli(["--help"])).toBe(0);
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining("usage: node tooling/verify_commands.ts"),
      );
      expect(error).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("reports invalid arguments as usage errors", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await runCli(["--unknown"])).toBe(2);
      expect(error.mock.calls.flat().join("\n")).toMatch(
        /usage: node tooling\/verify_commands\.ts/,
      );
      expect(error.mock.calls.flat().join("\n")).toMatch(/Unknown option '--unknown'/);
      expect(error.mock.calls.flat().join("\n")).not.toMatch(/FAIL|node:internal|at parseArgs/);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("exact documented-command coverage", () => {
  it.each([
    {
      name: "long flag value",
      documented: "moon build --target js",
      wrong: ["moon", "build", "--target", "native"],
    },
    {
      name: "filter value",
      documented: "moon test --filter 'shout*'",
      wrong: ["moon", "test", "--filter", "quiet*"],
    },
    {
      name: "positional path",
      documented: "moon test textutil/shout_test.mbt -i 0",
      wrong: ["moon", "test", "other/shout_test.mbt", "-i", "0"],
    },
    {
      name: "short flag value",
      documented: "moon test textutil/shout_test.mbt -i 0",
      wrong: ["moon", "test", "textutil/shout_test.mbt", "-i", "1"],
    },
  ])("catches a wrong $name", ({ documented: source, wrong }) => {
    const covered = collectCoveredCommands(manifestWithStep(moon(wrong as MoonStep["argv"])));
    expect(coverageProblems([documented(source)], covered)).toEqual([
      expect.stringContaining("not covered by an exact manifest command"),
    ]);
  });

  it("normalizes quoting but preserves every argument", () => {
    const manifest = manifestWithStep(moon(["moon", "test", "--filter", "shout*"]));
    expect(
      coverageProblems(
        [documented('moon test --filter "shout*"')],
        collectCoveredCommands(manifest),
      ),
    ).toEqual([]);
  });

  it("does not let an ordinary shell setup claim Moon coverage", () => {
    const manifest = manifestWithStep({
      kind: "shell",
      script: "moon build --target js",
    });
    expect(
      coverageProblems([documented("moon build --target js")], collectCoveredCommands(manifest)),
    ).toHaveLength(1);
  });

  it("keeps network commands in coverage even when execution may be skipped", () => {
    const manifest = manifestWithStep(moon(["moon", "add", "moonbitlang/x"]), true);
    expect(
      coverageProblems([documented("moon add moonbitlang/x")], collectCoveredCommands(manifest)),
    ).toEqual([]);
  });

  it("finds and exactly covers Moon on the right side of a pipe", async () => {
    const root = await mkdtemp(join(tmpdir(), "command-docs-"));
    const skill = join(root, "skills", "moonbit-toolchain");
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "# Test\n\n```sh\nprintf 'hello' | moon run -\n```\n");

    try {
      const docs = await collectDocumentedCommands(skill, root);
      expect(docs.map((item) => item.source)).toEqual(["printf 'hello' | moon run -"]);

      const exact = manifestWithStep({
        kind: "documented-shell",
        script: "printf 'hello' | moon run -",
      });
      expect(coverageProblems(docs, collectCoveredCommands(exact))).toEqual([]);

      const changedInput = manifestWithStep({
        kind: "documented-shell",
        script: "printf 'goodbye' | moon run -",
      });
      expect(coverageProblems(docs, collectCoveredCommands(changedInput))).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("finds compound-shell Moon commands and preserves their paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "compound-command-docs-"));
    const skill = join(root, "skills", "moonbit-toolchain");
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "# Test\n\n```sh\nmkdir x && moon check x\n```\n");

    try {
      const docs = await collectDocumentedCommands(skill, root);
      expect(docs.map((item) => item.source)).toEqual(["mkdir x && moon check x"]);

      const exact = manifestWithStep({
        kind: "documented-shell",
        script: "mkdir x && moon check x",
      });
      expect(coverageProblems(docs, collectCoveredCommands(exact))).toEqual([]);

      const wrongPath = manifestWithStep({
        kind: "documented-shell",
        script: "mkdir y && moon check y",
      });
      expect(coverageProblems(docs, collectCoveredCommands(wrongPath))).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("finds wrapped and absolute-path Moon invocations", async () => {
    const root = await mkdtemp(join(tmpdir(), "wrapped-command-docs-"));
    const skill = join(root, "skills", "moonbit-toolchain");
    await mkdir(skill, { recursive: true });
    await writeFile(
      join(skill, "SKILL.md"),
      [
        "# Test",
        "",
        "```sh",
        "env MODE=test moon check",
        "command moon check",
        "time /opt/moon/bin/moon check",
        "/opt/moon/bin/moon check --target js",
        "```",
        "",
      ].join("\n"),
    );

    try {
      const docs = await collectDocumentedCommands(skill, root);
      expect(docs.map((item) => item.source)).toEqual([
        "env MODE=test moon check",
        "command moon check",
        "time /opt/moon/bin/moon check",
        "/opt/moon/bin/moon check --target js",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects shell control flow that could hide a documented Moon invocation", async () => {
    const root = await mkdtemp(join(tmpdir(), "hidden-command-docs-"));
    const skill = join(root, "skills", "moonbit-toolchain");
    await mkdir(skill, { recursive: true });
    await writeFile(
      join(skill, "SKILL.md"),
      "# Test\n\n```sh\nif true; then moon check; fi\n```\n",
    );

    try {
      await expect(collectDocumentedCommands(skill, root)).rejects.toThrow(
        /unsupported shell control flow if/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    "exec moon check",
    "sudo moon check",
    "find . -exec moon check {} +",
    'bash -c "moon check"',
    'bash -c "m\\oon check"',
    "env -S 'moon check'",
  ])("fails closed for an unsupported documented Moon wrapper: %s", async (script) => {
    const root = await mkdtemp(join(tmpdir(), "unsupported-wrapper-docs-"));
    const skill = join(root, "skills", "moonbit-toolchain");
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), `# Test\n\n\`\`\`sh\n${script}\n\`\`\`\n`);

    try {
      await expect(collectDocumentedCommands(skill, root)).rejects.toThrow(
        /not allowed|env --split-string/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves and exactly covers multiline pipelines and && chains", async () => {
    const root = await mkdtemp(join(tmpdir(), "multiline-command-docs-"));
    const skill = join(root, "skills", "moonbit-toolchain");
    await mkdir(skill, { recursive: true });
    const pipeline = "printf 'hello' |\nmoon run -";
    const chain = "mkdir x && \\\nmoon check x";
    await writeFile(join(skill, "SKILL.md"), `# Test\n\n\`\`\`sh\n${pipeline}\n${chain}\n\`\`\`\n`);

    try {
      const docs = await collectDocumentedCommands(skill, root);
      expect(docs.map((item) => item.source)).toEqual([pipeline, chain]);
      const exact = parseManifest({
        schema_version: 2,
        entries: [
          {
            id: "multiline",
            fixture: "empty",
            steps: [
              { kind: "documented-shell", script: pipeline },
              { kind: "documented-shell", script: chain },
            ],
          },
        ],
      });
      expect(coverageProblems(docs, collectCoveredCommands(exact))).toEqual([]);

      const wrongPath = manifestWithStep({
        kind: "documented-shell",
        script: "mkdir y && moon check y",
      });
      expect(coverageProblems([docs[1]!], collectCoveredCommands(wrongPath))).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("per-step execution", () => {
  function result(exit: number, output = ""): ProcessResult {
    return { exit, output };
  }

  it("reports an intermediate failure and does not let later success hide it", async () => {
    const calls: string[] = [];
    const executor: StepExecutor = async (step) => {
      calls.push(step.kind === "moon" ? step.argv.join(" ") : step.script);
      return step.kind === "shell" && step.script === "first" ? result(7) : result(0);
    };
    const entry: RunEntry = {
      id: "intermediate",
      fixture: "empty",
      steps: [
        { kind: "shell", script: "first" },
        { kind: "shell", script: "later-success" },
      ],
    };

    const problems = await runEntry(entry, { executor });
    expect(problems).toEqual([expect.stringMatching(/step 1.*exit 7.*expected exit 0/s)]);
    expect(calls).toEqual(["first"]);
  });

  it("continues after an explicitly expected nonzero exit", async () => {
    const calls: string[] = [];
    const executor: StepExecutor = async (step) => {
      calls.push(step.kind === "moon" ? step.argv.join(" ") : step.script);
      return result(calls.length === 1 ? 7 : 0);
    };
    const entry: RunEntry = {
      id: "expected-failure",
      fixture: "empty",
      steps: [
        { kind: "shell", script: "expected", expect: { exit: 7 } },
        { kind: "shell", script: "next" },
      ],
    };

    expect(await runEntry(entry, { executor })).toEqual([]);
    expect(calls).toEqual(["expected", "next"]);
  });

  it("compares nonzero exit codes exactly", async () => {
    const entry: RunEntry = {
      id: "exact-exit",
      fixture: "empty",
      steps: [{ kind: "shell", script: "fails", expect: { exit: 255 } }],
    };
    const executor: StepExecutor = async () => result(2);

    expect(await runEntry(entry, { executor })).toEqual([
      expect.stringMatching(/exit 2.*expected exit 255/s),
    ]);
  });

  it("does not let later output satisfy an earlier expectation", async () => {
    let call = 0;
    const executor: StepExecutor = async () => {
      call += 1;
      return result(0, call === 1 ? "nothing" : "needle");
    };
    const entry: RunEntry = {
      id: "scoped-output",
      fixture: "empty",
      steps: [
        {
          kind: "shell",
          script: "first",
          expect: { output_contains: ["needle"] },
        },
        { kind: "shell", script: "second" },
      ],
    };

    expect(await runEntry(entry, { executor })).toEqual([
      expect.stringMatching(/step 1.*output missing.*needle/s),
    ]);
    expect(call).toBe(1);
  });

  it("checks expected paths on the step that declares them", async () => {
    const entry: RunEntry = {
      id: "missing-path",
      fixture: "empty",
      steps: [
        {
          kind: "shell",
          script: "true",
          expect: { paths_exist: ["not-created.txt"] },
        },
      ],
    };
    const executor: StepExecutor = async () => result(0);

    expect(await runEntry(entry, { executor })).toEqual([
      expect.stringMatching(/expected path not-created\.txt is missing/),
    ]);
  });

  it("uses errexit so a later setup command cannot mask an earlier failure", async () => {
    const entry: RunEntry = {
      id: "runtime-masked-setup",
      fixture: "empty",
      steps: [{ kind: "shell", script: "false\ntrue" }],
    };

    expect(await runEntry(entry)).toEqual([
      expect.stringMatching(/step 1.*exit 1.*expected exit 0/s),
    ]);
  });

  it("revalidates a raw documented-shell entry before execution", async () => {
    const entry: RunEntry = {
      id: "raw-skipped-moon",
      fixture: "empty",
      steps: [
        {
          kind: "documented-shell",
          script: "false && /definitely-not-installed/moon check",
          expect: { exit: 1 },
        },
      ],
    };

    await expect(runEntry(entry)).rejects.toThrow(/expect\.exit must be 0/);
  });

  it("kills the POSIX process group on timeout", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(join(tmpdir(), "command-timeout-"));
    const started = Date.now();
    try {
      const result = await executeStep(
        {
          kind: "shell",
          script: "node -e 'setTimeout(() => {}, 5000)' & wait",
        },
        { cwd: root, timeoutMs: 100 },
      );
      expect(result.timed_out).toBe(true);
      expect(Date.now() - started).toBeLessThan(1_500);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not follow a step cwd symlink outside the fixture", async () => {
    if (process.platform === "win32") return;
    const outside = await mkdtemp(join(tmpdir(), "command-outside-"));
    const entry: RunEntry = {
      id: "symlink-cwd",
      fixture: "empty",
      steps: [
        { kind: "shell", script: `ln -s ${JSON.stringify(outside)} escaped` },
        { kind: "shell", script: "pwd", cwd: "escaped" },
      ],
    };

    try {
      await expect(runEntry(entry)).rejects.toThrow(/escapes the fixture root through a symlink/);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("repository manifest", () => {
  it("loads and exactly covers every documented shell command without Moon", async () => {
    const manifest = await loadManifest(
      join(REPO_ROOT, "verification", "commands", "manifest.json"),
    );
    const coverage = await verifyCoverage(manifest, { repoRoot: REPO_ROOT });
    expect(coverage.problems).toEqual([]);
    expect(coverage.documented.length).toBeGreaterThan(80);
  });

  it("skips network execution without removing network command coverage", async () => {
    const manifest = manifestWithStep(moon(["moon", "add", "moonbitlang/x"]), true);
    let calls = 0;
    const executor: StepExecutor = async () => {
      calls += 1;
      return { exit: 0, output: "" };
    };

    expect(await runManifest(manifest, { skipNetwork: true, executor })).toEqual([]);
    expect(calls).toBe(0);
    expect(
      coverageProblems([documented("moon add moonbitlang/x")], collectCoveredCommands(manifest)),
    ).toEqual([]);
  });
});

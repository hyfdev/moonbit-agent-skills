import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import {
  canonicalShellCommand,
  collectCoveredCommands,
  collectDocumentedCommands,
  coverageProblems,
  loadManifest,
  parseManifest,
  runEntry,
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
    ).toThrow(/must contain a moon or moonrun command/);
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

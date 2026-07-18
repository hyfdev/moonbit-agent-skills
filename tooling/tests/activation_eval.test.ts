import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  ensureRunManifest,
  loadExistingResults,
  loadPrompts,
  materializePrompt,
  parseActivationStream,
  summarize,
  type ActivationPrompt,
  type ActivationResult,
} from "../../evals/activation/run_activation.ts";
import { REPO_ROOT } from "../lib/repo.ts";

const ENVIRONMENT = {
  client: "2.1.212 (Claude Code)",
  node_version: "v24.4.0",
  platform: "linux-test-x64",
  model_environment: {},
};

function result(overrides: Partial<ActivationResult> = {}): ActivationResult {
  return {
    id: "prompt-1",
    category: "language-only",
    moonbit_named: true,
    activated: ["moonbit-language"],
    activated_all: ["moonbit-language"],
    expected: { required: ["moonbit-language"], forbidden: ["moonbit-toolchain"] },
    verdict: { recall_ok: true, no_forbidden: true, exact: true },
    usage: { total_cost_usd: 0.1 },
    model_usage: { "claude-haiku-4-5-20251001": { inputTokens: 10 } },
    num_turns: 1,
    exit_code: 0,
    timed_out: false,
    stderr_tail: "",
    transcript: "transcripts/prompt-1.jsonl",
    stderr: "transcripts/prompt-1.stderr.txt",
    final_text: "done",
    tool_uses: [],
    ...overrides,
  };
}

describe("activation eval input", () => {
  it("validates prompts while preserving workspace materialization", () => {
    const temporary = mkdtempSync(join(tmpdir(), "activation-input-test-"));
    try {
      const promptsPath = join(temporary, "prompts.jsonl");
      writeFileSync(
        promptsPath,
        `${JSON.stringify({
          id: "language-question",
          category: "language-only",
          moonbit_named: false,
          prompt: "Fix the type error in lib.mbt.",
          workspace: { "src/lib.mbt": "pub fn answer() -> Int { 42 }\n" },
          expected: { required: ["moonbit-language"], forbidden: [] },
        })}\n`,
      );
      const prompts = loadPrompts(promptsPath);
      expect(prompts).toHaveLength(1);

      const project = join(temporary, "project");
      mkdirSync(project);
      materializePrompt(project, prompts[0]);
      expect(readFileSync(join(project, "src/lib.mbt"), "utf8")).toContain("answer");
      expect(existsSync(join(project, ".claude/skills/moonbit-language/SKILL.md"))).toBe(true);
      expect(
        existsSync(join(project, ".claude/skills/moonbit-agent-skills-maintainer/SKILL.md")),
      ).toBe(true);
    } finally {
      rmSync(temporary, { force: true, recursive: true });
    }
  });

  it("rejects prompt text that names a skill", () => {
    const temporary = mkdtempSync(join(tmpdir(), "activation-prompt-test-"));
    try {
      const path = join(temporary, "prompts.jsonl");
      writeFileSync(
        path,
        `${JSON.stringify({
          id: "invalid",
          category: "language-only",
          prompt: "Load the moonbit-language skill.",
          expected: { required: ["moonbit-language"], forbidden: [] },
        })}\n`,
      );
      expect(() => loadPrompts(path)).toThrow("prompt names a skill");
    } finally {
      rmSync(temporary, { force: true, recursive: true });
    }
  });

  it("rejects workspace paths outside the throwaway project", () => {
    const temporary = mkdtempSync(join(tmpdir(), "activation-path-test-"));
    try {
      const prompt: ActivationPrompt = {
        id: "escape",
        category: "language-only",
        prompt: "Fix it.",
        workspace: { "../outside.mbt": "bad" },
        expected: { required: ["moonbit-language"], forbidden: [] },
      };
      expect(() => materializePrompt(temporary, prompt)).toThrow("workspace path escapes");
      expect(existsSync(join(temporary, "../outside.mbt"))).toBe(false);
    } finally {
      rmSync(temporary, { force: true, recursive: true });
    }
  });
});

describe("activation eval transcript and metrics", () => {
  it("deduplicates Skill calls and discloses the resolved model", () => {
    const parsed = parseActivationStream(
      [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", name: "Skill", input: { skill: "moonbit-language" } },
              { type: "tool_use", name: "Skill", input: { skill: "moonbit-language" } },
              { type: "tool_use", name: "Skill", input: { skill: "unrelated" } },
            ],
          },
        }),
        "not json",
        JSON.stringify({
          type: "result",
          result: "finished",
          num_turns: 2,
          total_cost_usd: 0.125,
          usage: { input_tokens: 10, output_tokens: 4 },
          modelUsage: { "claude-haiku-4-5-20251001": { inputTokens: 10 } },
        }),
      ].join("\n"),
    );
    expect(parsed.activatedAll).toEqual(["moonbit-language", "unrelated"]);
    expect(parsed.finalText).toBe("finished");
    expect(parsed.numTurns).toBe(2);
    expect(parsed.usage.total_cost_usd).toBe(0.125);
    expect(Object.keys(parsed.modelUsage)).toEqual(["claude-haiku-4-5-20251001"]);
  });

  it("keeps the original routing metrics and adds run/model disclosure", () => {
    const results = [
      result(),
      result({
        id: "combined-miss",
        category: "combined",
        moonbit_named: false,
        activated: ["moonbit-language"],
        expected: { required: ["moonbit-language", "moonbit-toolchain"], forbidden: [] },
        verdict: { recall_ok: false, no_forbidden: true, exact: false },
        usage: { total_cost_usd: 0.2 },
      }),
      result({
        id: "negative-false-positive",
        category: "negative",
        moonbit_named: false,
        activated: ["moonbit-toolchain"],
        expected: { required: [], forbidden: ["moonbit-language", "moonbit-toolchain"] },
        verdict: { recall_ok: true, no_forbidden: false, exact: false },
        usage: { total_cost_usd: 0.3 },
      }),
    ];
    const summary = summarize(results, "requested-model", 12, ENVIRONMENT);
    expect(summary.trigger_recall_overall).toBe(0.5);
    expect(summary.false_positive_rate_negative).toBe(1);
    expect(summary.multi_skill_accuracy_combined).toBe(0);
    expect(summary.recall_when_moonbit_not_named).toBe(0);
    expect(summary.routing_exact_accuracy).toEqual({
      combined: 0,
      "language-only": 1,
      negative: 0,
    });
    expect(summary.resolved_models).toEqual(["claude-haiku-4-5-20251001"]);
    expect(summary.environment).toEqual(ENVIRONMENT);
    expect(summary.total_cost_usd).toBe(0.6);
  });
});

describe("activation eval resume artifacts", () => {
  it("pins run configuration before accepting resumable results", () => {
    const temporary = mkdtempSync(join(tmpdir(), "activation-resume-test-"));
    try {
      const config = {
        runner: "activation" as const,
        model: "requested-model",
        max_turns: 12,
        environment: ENVIRONMENT,
      };
      ensureRunManifest(temporary, config, false);
      expect(JSON.parse(readFileSync(join(temporary, "run.json"), "utf8"))).toEqual(config);
      expect(() => ensureRunManifest(temporary, config, true)).not.toThrow();
      expect(() => ensureRunManifest(temporary, { ...config, max_turns: 13 }, true)).toThrow(
        "run configuration differs",
      );

      const resultsPath = join(temporary, "results.jsonl");
      writeFileSync(resultsPath, `${JSON.stringify(result())}\n`);
      expect(loadExistingResults(resultsPath)).toEqual([result()]);
      writeFileSync(resultsPath, `${JSON.stringify(result())}\n${JSON.stringify(result())}\n`);
      expect(() => loadExistingResults(resultsPath)).toThrow("duplicate result id");
    } finally {
      rmSync(temporary, { force: true, recursive: true });
    }
  });

  it("refuses results that have no run manifest", () => {
    const temporary = mkdtempSync(join(tmpdir(), "activation-manifest-test-"));
    try {
      expect(() =>
        ensureRunManifest(
          temporary,
          {
            runner: "activation",
            model: "requested-model",
            max_turns: 12,
            environment: ENVIRONMENT,
          },
          true,
        ),
      ).toThrow("cannot safely resume results without run.json");
    } finally {
      rmSync(temporary, { force: true, recursive: true });
    }
  });

  it("runs directly under Node 24 and resumes without repeating a completed prompt", () => {
    const temporary = mkdtempSync(join(tmpdir(), "activation-cli-test-"));
    const runName = `activation-cli-test-${process.pid}-${Date.now()}`;
    const runDirectory = join(REPO_ROOT, "evals/activation/runs", runName);
    try {
      const fakeBin = join(temporary, "bin");
      mkdirSync(fakeBin);
      const fakeClaude = join(fakeBin, "claude");
      writeFileSync(
        fakeClaude,
        `#!/usr/bin/env node
if (process.argv.includes("--version")) {
  console.log("9.9.9 (Claude Code test double)");
  process.exit(0);
}
console.log(JSON.stringify({
  type: "assistant",
  message: { content: [{ type: "tool_use", name: "Skill", input: { skill: "moonbit-language" } }] },
}));
console.log(JSON.stringify({
  type: "result",
  result: "done",
  num_turns: 1,
  total_cost_usd: 0.01,
  usage: { input_tokens: 1, output_tokens: 1 },
  modelUsage: { "resolved-test-model": { inputTokens: 1 } },
}));
`,
      );
      chmodSync(fakeClaude, 0o755);
      const command = [
        join(REPO_ROOT, "evals/activation/run_activation.ts"),
        "--ids",
        "lang-extend-ordinary",
        "--model",
        "requested-test-model",
        "--run-name",
        runName,
      ];
      const environment = {
        ...process.env,
        PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
      };

      const first = spawnSync(process.execPath, command, {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: environment,
      });
      expect(first.status, first.stderr).toBe(0);
      expect(
        readFileSync(join(runDirectory, "results.jsonl"), "utf8").trim().split("\n"),
      ).toHaveLength(1);
      expect(JSON.parse(readFileSync(join(runDirectory, "summary.json"), "utf8"))).toMatchObject({
        model: "requested-test-model",
        resolved_models: ["resolved-test-model"],
        n: 1,
        routing_exact_accuracy: { "language-only": 1 },
      });
      expect(existsSync(join(runDirectory, "transcripts/lang-extend-ordinary.jsonl"))).toBe(true);

      const rejected = spawnSync(process.execPath, command, {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: environment,
      });
      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toContain("already exists");

      const resumed = spawnSync(process.execPath, [...command, "--resume"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: environment,
      });
      expect(resumed.status, resumed.stderr).toBe(0);
      expect(resumed.stdout).toContain("already complete");
      expect(
        readFileSync(join(runDirectory, "results.jsonl"), "utf8").trim().split("\n"),
      ).toHaveLength(1);
    } finally {
      rmSync(temporary, { force: true, recursive: true });
      rmSync(runDirectory, { force: true, recursive: true });
    }
  });
});

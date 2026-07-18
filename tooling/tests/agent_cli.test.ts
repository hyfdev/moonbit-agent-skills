import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  buildAgentInvocation,
  clientRunSucceeded,
  enrichKimiStream,
  parseClaudeStream,
  parseKimiStream,
  readKimiSessionMetadata,
} from "../../evals/lib/agent_cli.ts";

describe("agent CLI stream normalization", () => {
  it("normalizes Claude tool calls, actual models, usage, and terminal status", () => {
    const parsed = parseClaudeStream(
      [
        JSON.stringify({
          type: "system",
          subtype: "init",
          model: "haiku",
          session_id: "claude-session",
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            model: "deepseek-v4-flash",
            content: [
              {
                type: "tool_use",
                id: "skill-1",
                name: "Skill",
                input: { skill: "moonbit-language" },
              },
              {
                type: "tool_use",
                id: "bash-1",
                name: "Bash",
                input: { command: "moon test" },
              },
            ],
          },
        }),
        JSON.stringify({
          type: "user",
          message: {
            content: [
              { type: "tool_result", tool_use_id: "skill-1", content: "loaded" },
              { type: "tool_result", tool_use_id: "bash-1", content: "passed" },
            ],
          },
        }),
        JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          result: "done",
          num_turns: 1,
          total_cost_usd: 0.01,
          usage: { input_tokens: 10, output_tokens: 2 },
          modelUsage: { "deepseek-v4-flash": { inputTokens: 10 } },
        }),
      ].join("\n"),
    );

    expect(parsed.init_model).toBe("haiku");
    expect(parsed.emitted_models).toEqual(["deepseek-v4-flash"]);
    expect(parsed.successful_skills).toEqual(["moonbit-language"]);
    expect(parsed.bash_results).toEqual([
      { command: "moon test", is_error: false, output: "passed" },
    ]);
    expect(parsed.final_text).toBe("done");
    expect(parsed.result_count).toBe(1);
    expect(clientRunSucceeded("claude-code", parsed, 0, false)).toBe(true);
  });

  it("normalizes Kimi function calls and does not trust a zero exit after tool failure", () => {
    const parsed = parseKimiStream(
      [
        JSON.stringify({
          role: "assistant",
          tool_calls: [
            {
              id: "skill-1",
              function: {
                name: "Skill",
                arguments: JSON.stringify({ skill: "moonbit-language" }),
              },
            },
            {
              id: "bash-1",
              function: { name: "Bash", arguments: JSON.stringify({ command: "false" }) },
            },
          ],
        }),
        JSON.stringify({ role: "tool", tool_call_id: "skill-1", content: "loaded inline" }),
        JSON.stringify({
          role: "tool",
          tool_call_id: "bash-1",
          content: "Command failed with exit code: 1.",
        }),
        JSON.stringify({ role: "assistant", content: "recovered" }),
        JSON.stringify({
          role: "meta",
          type: "session.resume_hint",
          session_id: "session_test",
        }),
      ].join("\n"),
    );

    expect(parsed.activated_skills).toEqual(["moonbit-language"]);
    expect(parsed.successful_skills).toEqual(["moonbit-language"]);
    expect(parsed.bash_results).toEqual([
      { command: "false", is_error: true, output: "Command failed with exit code: 1." },
    ]);
    expect(parsed.final_text).toBe("recovered");
    expect(parsed.num_turns).toBe(2);
    expect(clientRunSucceeded("kimi-code", parsed, 0, false)).toBe(true);
  });
});

describe("Kimi session metadata", () => {
  it("extracts only model and usage metadata from the private session wire", () => {
    const root = mkdtempSync(join(tmpdir(), "kimi-metadata-test-"));
    try {
      const wireDirectory = join(root, "sessions", "workspace", "session_test", "agents", "main");
      mkdirSync(wireDirectory, { recursive: true });
      writeFileSync(
        join(wireDirectory, "wire.jsonl"),
        [
          JSON.stringify({ type: "user.prompt", content: "must never be copied" }),
          JSON.stringify({
            type: "llm.request",
            model: "k3",
            modelAlias: "kimi-code/k3",
            provider: "kimi",
            thinkingEffort: "max",
          }),
          JSON.stringify({
            type: "usage.record",
            model: "kimi-code/k3",
            usage: {
              inputOther: 5,
              inputCacheRead: 7,
              inputCacheCreation: 2,
              output: 3,
            },
          }),
        ].join("\n"),
      );

      const metadata = readKimiSessionMetadata("session_test", root);
      expect(metadata).toEqual({
        emittedModels: ["k3"],
        modelAliases: ["kimi-code/k3"],
        providers: ["kimi"],
        thinkingEfforts: ["max"],
        usage: {
          inputOther: 5,
          inputCacheRead: 7,
          inputCacheCreation: 2,
          output: 3,
          input_tokens: 14,
          output_tokens: 3,
        },
        modelUsage: {
          "kimi-code/k3": {
            inputOther: 5,
            inputCacheRead: 7,
            inputCacheCreation: 2,
            output: 3,
          },
        },
      });

      const parsed = parseKimiStream(
        `${JSON.stringify({ role: "meta", type: "session.resume_hint", session_id: "session_test" })}\n`,
      );
      expect(enrichKimiStream(parsed, root).emitted_models).toEqual(["k3"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("agent CLI invocation isolation", () => {
  it("uses Kimi prompt mode without incompatible permission flags", () => {
    const invocation = buildAgentInvocation({
      client: "kimi-code",
      prompt: "task",
      model: "kimi-code/k3",
      maxTurns: 12,
      skillsDir: "/tmp/skills",
      allowedTools: ["Skill", "Read"],
      disallowedTools: ["WebSearch"],
    });
    expect(invocation.command).toBe("kimi");
    expect(invocation.args).toEqual([
      "-m",
      "kimi-code/k3",
      "--skills-dir",
      "/tmp/skills",
      "-p",
      "task",
      "--output-format",
      "stream-json",
    ]);
    expect(invocation.args).not.toContain("--auto");
    expect(invocation.args).not.toContain("--yolo");
  });

  it("makes Claude permissions, tools, persistence, and budget explicit", () => {
    const invocation = buildAgentInvocation({
      client: "claude-code",
      prompt: "task",
      model: "haiku",
      maxTurns: 12,
      skillsDir: "/tmp/skills",
      allowedTools: ["Skill", "Read"],
      disallowedTools: ["WebSearch"],
      claudeConfigDir: "/tmp/claude-config",
      maxBudgetUsd: 0.2,
    });
    expect(invocation.command).toBe("claude");
    expect(invocation.args).toContain("--no-session-persistence");
    expect(invocation.args).toContain("--permission-mode");
    expect(invocation.args).toContain("--setting-sources");
    expect(invocation.args).toContain("--max-budget-usd");
    expect(invocation.environment.CLAUDE_CONFIG_DIR).toBe("/tmp/claude-config");
  });
});

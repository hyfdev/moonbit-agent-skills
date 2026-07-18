import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  ApiBudgetGuard,
  aggregateTokenUsage,
  analysisEligibility,
  buildAgentInvocation,
  clientRunSucceeded,
  enrichKimiStream,
  parseClaudeStream,
  parseKimiStream,
  readKimiSessionMetadata,
  sanitizeAgentStreamForPersistence,
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
          billing: "API",
          subtype: "success",
          is_error: false,
          result: "done",
          num_turns: 1,
          total_cost_usd: 0.01,
          usage: { input_tokens: 10, output_tokens: 2 },
          modelUsage: { "deepseek-v4-flash": { inputTokens: 10, costUSD: 0.01 } },
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
    expect(parsed.usage).toEqual({ input_tokens: 10, output_tokens: 2, num_turns: 1 });
    expect(parsed.model_usage).toEqual({
      "deepseek-v4-flash": { inputTokens: 10 },
    });
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

describe("content-analysis eligibility", () => {
  it("keeps a normal predeclared turn-limit result as an eligible task failure", () => {
    const parsed = parseClaudeStream(
      JSON.stringify({
        type: "result",
        subtype: "error_max_turns",
        is_error: true,
        num_turns: 12,
      }),
    );

    expect(analysisEligibility("claude-code", parsed, 1, false, 12)).toEqual({
      eligible: true,
      reason: "predeclared_turn_limit",
    });
    expect(analysisEligibility("claude-code", parsed, 1, false, 13)).toEqual({
      eligible: false,
      reason: "client_failure",
    });
  });

  it("excludes wall timeouts, transport failures, and client failures", () => {
    const successful = parseClaudeStream(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        num_turns: 1,
      }),
    );
    const missingKimiSession = parseKimiStream(
      JSON.stringify({ role: "assistant", content: "done" }),
    );

    expect(analysisEligibility("claude-code", successful, 0, true, 12)).toEqual({
      eligible: false,
      reason: "wall_timeout",
    });
    expect(analysisEligibility("claude-code", successful, null, false, 12)).toEqual({
      eligible: false,
      reason: "transport_failure",
    });
    expect(analysisEligibility("kimi-code", missingKimiSession, 0, false, 12)).toEqual({
      eligible: false,
      reason: "client_failure",
    });
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
          input_tokens: 5,
          cache_read_input_tokens: 7,
          cache_creation_input_tokens: 2,
          output_tokens: 3,
        },
        modelUsage: {
          "kimi-code/k3": {
            input_tokens: 5,
            cache_read_input_tokens: 7,
            cache_creation_input_tokens: 2,
            output_tokens: 3,
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

describe("token-only persistence and runtime budget guarding", () => {
  it("removes money fields and amounts while preserving non-money budgets and similarly named keys", () => {
    const sanitized = sanitizeAgentStreamForPersistence(
      [
        JSON.stringify({
          type: "assistant",
          message: {
            model: "model-a",
            content: [
              {
                type: "tool_use",
                input: { costume: "keep", turn_budget: 12, token_budget: 100 },
              },
            ],
          },
        }),
        JSON.stringify({
          type: "result",
          billing: "API",
          total_cost_usd: 0.2,
          usage: { input_tokens: 3, output_tokens: 4 },
          modelUsage: { "model-a": { inputTokens: 3, costUSD: 0.2 } },
        }),
        "client error: --max-budget-usd 0.20; total_cost_usd=0.10; $0.30; 0.40 USD",
      ].join("\n"),
    );

    expect(sanitized).toContain('"costume":"keep"');
    expect(sanitized).toContain('"turn_budget":12');
    expect(sanitized).toContain('"token_budget":100');
    expect(sanitized).toContain('"input_tokens":3');
    expect(sanitized).not.toMatch(/total[-_]cost[-_]usd|costUSD|max[-_]budget[-_]usd/i);
    expect(sanitized).not.toContain('"billing"');
    expect(sanitized).not.toMatch(/\$0\.30|0\.40 USD/);
  });

  it("normalizes mixed-provider token totals without counting cache tokens twice", () => {
    expect(
      aggregateTokenUsage([
        {
          input_tokens: 5,
          cache_read_input_tokens: 7,
          cache_creation_input_tokens: 2,
          output_tokens: 3,
        },
        {
          input_tokens: 11,
          cache_read_input_tokens: 13,
          cache_creation_input_tokens: 17,
          output_tokens: 19,
        },
      ]),
    ).toEqual({
      input_tokens: 16,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 19,
      output_tokens: 22,
      total_tokens: 77,
    });
  });

  it("tracks only the current invocation and fails closed when usage is unavailable", () => {
    const firstInvocation = new ApiBudgetGuard(1);
    expect(firstInvocation.remaining()).toBe(1);
    firstInvocation.recordClaudeStream(JSON.stringify({ type: "result", total_cost_usd: 0.4 }));
    expect(firstInvocation.remaining()).toBe(0.6);

    const resumedInvocation = new ApiBudgetGuard(0.75);
    expect(resumedInvocation.remaining()).toBe(0.75);
    resumedInvocation.recordClaudeStream(JSON.stringify({ type: "assistant" }));
    expect(() => resumedInvocation.remaining()).toThrow("refusing another model call");
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

import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type AgentClient = "claude-code" | "kimi-code";
export type JsonRecord = Record<string, unknown>;

export interface ToolUseRecord {
  id: string;
  name: string;
  input: unknown;
  assistant_turn: number;
  event_index: number;
}

export interface ToolResultRecord {
  tool_use_id: string;
  is_error: boolean;
  output: string;
  event_index: number;
}

export interface BashResult {
  command: string;
  is_error: boolean;
  output: string;
}

export interface ParsedAgentStream {
  final_text: string;
  activated_skills: string[];
  successful_skills: string[];
  bash_results: BashResult[];
  tool_uses: ToolUseRecord[];
  tool_results: ToolResultRecord[];
  emitted_models: string[];
  model_aliases: string[];
  providers: string[];
  thinking_efforts: string[];
  usage: JsonRecord;
  model_usage: JsonRecord;
  num_turns: number;
  session_id: string | null;
  init_model: string | null;
  result_count: number;
  result_subtype: string | null;
  result_is_error: boolean | null;
}

export interface AgentInvocationOptions {
  client: AgentClient;
  prompt: string;
  model: string;
  maxTurns: number;
  skillsDir: string;
  allowedTools: string[];
  disallowedTools: string[];
  claudeConfigDir?: string;
  maxBudgetUsd?: number;
}

export interface AgentInvocation {
  command: "claude" | "kimi";
  args: string[];
  environment: NodeJS.ProcessEnv;
}

export interface KimiSessionMetadata {
  emittedModels: string[];
  modelAliases: string[];
  providers: string[];
  thinkingEfforts: string[];
  usage: JsonRecord;
  modelUsage: JsonRecord;
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value !== ""))];
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  return value === undefined ? "" : JSON.stringify(value);
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== "string") return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return { raw: value };
  }
}

function kimiToolError(output: string): boolean {
  return /(?:^|\n)Command failed with exit code:\s*[1-9]\d*\.?\s*(?:\n|$)/.test(output);
}

function emptyParsed(): ParsedAgentStream {
  return {
    final_text: "",
    activated_skills: [],
    successful_skills: [],
    bash_results: [],
    tool_uses: [],
    tool_results: [],
    emitted_models: [],
    model_aliases: [],
    providers: [],
    thinking_efforts: [],
    usage: {},
    model_usage: {},
    num_turns: 0,
    session_id: null,
    init_model: null,
    result_count: 0,
    result_subtype: null,
    result_is_error: null,
  };
}

function finishParsed(parsed: ParsedAgentStream): ParsedAgentStream {
  const usesById = new Map(parsed.tool_uses.map((use) => [use.id, use]));
  for (const result of parsed.tool_results) {
    const use = usesById.get(result.tool_use_id);
    if (use?.name === "Bash") {
      parsed.bash_results.push({
        command: stringValue(asRecord(use.input).command),
        is_error: result.is_error,
        output: result.output,
      });
    }
    if (use?.name === "Skill" && !result.is_error) {
      const skill = stringValue(asRecord(use.input).skill);
      if (skill !== "") parsed.successful_skills.push(skill);
    }
  }
  parsed.activated_skills = unique(parsed.activated_skills);
  parsed.successful_skills = unique(parsed.successful_skills);
  parsed.emitted_models = unique(parsed.emitted_models);
  parsed.model_aliases = unique(parsed.model_aliases);
  parsed.providers = unique(parsed.providers);
  parsed.thinking_efforts = unique(parsed.thinking_efforts);
  return parsed;
}

export function parseClaudeStream(stdout: string): ParsedAgentStream {
  const parsed = emptyParsed();
  let eventIndex = 0;
  let assistantTurn = 0;
  for (const line of stdout.split(/\r?\n/)) {
    let event: JsonRecord;
    try {
      event = asRecord(JSON.parse(line));
    } catch {
      continue;
    }
    eventIndex += 1;
    if (event.type === "system" && event.subtype === "init") {
      parsed.init_model = stringValue(event.model) || null;
      parsed.session_id = stringValue(event.session_id) || parsed.session_id;
      continue;
    }
    if (event.type === "assistant") {
      assistantTurn += 1;
      const message = asRecord(event.message);
      parsed.emitted_models.push(stringValue(message.model));
      const content = Array.isArray(message.content) ? message.content : [];
      for (const rawBlock of content) {
        const block = asRecord(rawBlock);
        if (block.type !== "tool_use") continue;
        const name = stringValue(block.name);
        const input = block.input ?? {};
        const id = stringValue(block.id);
        parsed.tool_uses.push({
          id,
          name,
          input,
          assistant_turn: assistantTurn,
          event_index: eventIndex,
        });
        if (name === "Skill") {
          parsed.activated_skills.push(stringValue(asRecord(input).skill));
        }
      }
      continue;
    }
    if (event.type === "user") {
      const message = asRecord(event.message);
      const content = Array.isArray(message.content) ? message.content : [];
      for (const rawBlock of content) {
        const block = asRecord(rawBlock);
        if (block.type !== "tool_result") continue;
        parsed.tool_results.push({
          tool_use_id: stringValue(block.tool_use_id),
          is_error: Boolean(block.is_error ?? false),
          output: contentText(block.content),
          event_index: eventIndex,
        });
      }
      continue;
    }
    if (event.type === "result") {
      parsed.result_count += 1;
      parsed.final_text = stringValue(event.result);
      parsed.result_subtype = stringValue(event.subtype) || null;
      parsed.result_is_error =
        typeof event.is_error === "boolean" ? event.is_error : parsed.result_is_error;
      parsed.usage = { ...asRecord(event.usage) };
      parsed.usage.total_cost_usd = event.total_cost_usd;
      parsed.usage.num_turns = event.num_turns;
      parsed.model_usage = asRecord(event.modelUsage ?? event.model_usage);
      const turns = Number(event.num_turns);
      if (Number.isFinite(turns)) parsed.num_turns = turns;
    }
  }
  if (parsed.num_turns === 0) parsed.num_turns = assistantTurn;
  return finishParsed(parsed);
}

export function parseKimiStream(stdout: string): ParsedAgentStream {
  const parsed = emptyParsed();
  let eventIndex = 0;
  let assistantTurn = 0;
  for (const line of stdout.split(/\r?\n/)) {
    let event: JsonRecord;
    try {
      event = asRecord(JSON.parse(line));
    } catch {
      continue;
    }
    eventIndex += 1;
    if (event.role === "assistant") {
      assistantTurn += 1;
      if (typeof event.content === "string" && event.content !== "") {
        parsed.final_text = event.content;
      }
      const calls = Array.isArray(event.tool_calls) ? event.tool_calls : [];
      for (const rawCall of calls) {
        const call = asRecord(rawCall);
        const fn = asRecord(call.function);
        const name = stringValue(fn.name);
        const input = parseArguments(fn.arguments);
        const id = stringValue(call.id);
        parsed.tool_uses.push({
          id,
          name,
          input,
          assistant_turn: assistantTurn,
          event_index: eventIndex,
        });
        if (name === "Skill") {
          parsed.activated_skills.push(stringValue(asRecord(input).skill));
        }
      }
      continue;
    }
    if (event.role === "tool") {
      const output = contentText(event.content);
      parsed.tool_results.push({
        tool_use_id: stringValue(event.tool_call_id),
        is_error: Boolean(event.is_error ?? kimiToolError(output)),
        output,
        event_index: eventIndex,
      });
      continue;
    }
    if (event.role === "meta" && event.type === "session.resume_hint") {
      parsed.session_id = stringValue(event.session_id) || null;
    }
  }
  parsed.num_turns = assistantTurn;
  parsed.usage.num_turns = assistantTurn;
  return finishParsed(parsed);
}

export function parseAgentStream(client: AgentClient, stdout: string): ParsedAgentStream {
  return client === "claude-code" ? parseClaudeStream(stdout) : parseKimiStream(stdout);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function kimiSessionDirectory(sessionId: string, dataRoot: string): string | undefined {
  const sessionsRoot = join(dataRoot, "sessions");
  if (!isDirectory(sessionsRoot)) return undefined;
  for (const workspace of readdirSync(sessionsRoot)) {
    const candidate = join(sessionsRoot, workspace, sessionId);
    if (isDirectory(candidate)) return candidate;
  }
  return undefined;
}

function addNumeric(target: JsonRecord, key: string, value: unknown): void {
  if (typeof value !== "number" || !Number.isFinite(value)) return;
  target[key] = (typeof target[key] === "number" ? target[key] : 0) + value;
}

export function readKimiSessionMetadata(
  sessionId: string,
  dataRoot = join(homedir(), ".kimi-code"),
): KimiSessionMetadata | undefined {
  const sessionDirectory = kimiSessionDirectory(sessionId, dataRoot);
  if (sessionDirectory === undefined) return undefined;
  const wirePath = join(sessionDirectory, "agents", "main", "wire.jsonl");
  let wire: string;
  try {
    wire = readFileSync(wirePath, "utf8");
  } catch {
    return undefined;
  }
  const emittedModels: string[] = [];
  const modelAliases: string[] = [];
  const providers: string[] = [];
  const thinkingEfforts: string[] = [];
  const usage: JsonRecord = {};
  const perModel = new Map<string, JsonRecord>();
  for (const line of wire.split(/\r?\n/)) {
    let event: JsonRecord;
    try {
      event = asRecord(JSON.parse(line));
    } catch {
      continue;
    }
    if (event.type === "llm.request") {
      emittedModels.push(stringValue(event.model));
      modelAliases.push(stringValue(event.modelAlias));
      providers.push(stringValue(event.provider));
      thinkingEfforts.push(stringValue(event.thinkingEffort));
      continue;
    }
    if (event.type !== "usage.record") continue;
    const record = asRecord(event.usage);
    for (const key of ["inputOther", "inputCacheRead", "inputCacheCreation", "output"]) {
      addNumeric(usage, key, record[key]);
    }
    const model = stringValue(event.model, "unknown");
    const modelRecord = perModel.get(model) ?? {};
    for (const key of ["inputOther", "inputCacheRead", "inputCacheCreation", "output"]) {
      addNumeric(modelRecord, key, record[key]);
    }
    perModel.set(model, modelRecord);
  }
  const inputTokens =
    [usage.inputOther, usage.inputCacheRead, usage.inputCacheCreation]
      .filter((value): value is number => typeof value === "number")
      .reduce((sum, value) => sum + value, 0);
  if (inputTokens > 0) usage.input_tokens = inputTokens;
  if (typeof usage.output === "number") usage.output_tokens = usage.output;
  return {
    emittedModels: unique(emittedModels),
    modelAliases: unique(modelAliases),
    providers: unique(providers),
    thinkingEfforts: unique(thinkingEfforts),
    usage,
    modelUsage: Object.fromEntries(perModel),
  };
}

export function enrichKimiStream(
  parsed: ParsedAgentStream,
  dataRoot?: string,
): ParsedAgentStream {
  if (parsed.session_id === null) return parsed;
  const metadata = readKimiSessionMetadata(parsed.session_id, dataRoot);
  if (metadata === undefined) return parsed;
  parsed.emitted_models = metadata.emittedModels;
  parsed.model_aliases = metadata.modelAliases;
  parsed.providers = metadata.providers;
  parsed.thinking_efforts = metadata.thinkingEfforts;
  parsed.usage = { ...parsed.usage, ...metadata.usage };
  parsed.model_usage = metadata.modelUsage;
  return parsed;
}

export function buildAgentInvocation(options: AgentInvocationOptions): AgentInvocation {
  if (options.client === "kimi-code") {
    return {
      command: "kimi",
      args: [
        "-m",
        options.model,
        "--skills-dir",
        options.skillsDir,
        "-p",
        options.prompt,
        "--output-format",
        "stream-json",
      ],
      environment: { ...process.env },
    };
  }
  const args = [
    "-p",
    options.prompt,
    "--model",
    options.model,
    "--output-format",
    "stream-json",
    "--verbose",
    "--max-turns",
    String(options.maxTurns),
    "--strict-mcp-config",
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
    "--setting-sources",
    "project",
    "--tools",
    options.allowedTools.join(","),
    "--allowedTools",
    options.allowedTools.join(","),
    "--disallowedTools",
    options.disallowedTools.join(","),
  ];
  if (options.maxBudgetUsd !== undefined) {
    args.push("--max-budget-usd", String(options.maxBudgetUsd));
  }
  const environment = { ...process.env };
  if (options.claudeConfigDir !== undefined) {
    environment.CLAUDE_CONFIG_DIR = options.claudeConfigDir;
  }
  return { command: "claude", args, environment };
}

export function clientExecutable(client: AgentClient): "claude" | "kimi" {
  return client === "claude-code" ? "claude" : "kimi";
}

export function clientRunSucceeded(
  client: AgentClient,
  parsed: ParsedAgentStream,
  exitCode: number | null,
  timedOut: boolean,
): boolean {
  if (timedOut || exitCode !== 0) return false;
  if (client === "kimi-code") return parsed.session_id !== null;
  return (
    parsed.result_count === 1 &&
    parsed.result_subtype === "success" &&
    parsed.result_is_error !== true
  );
}

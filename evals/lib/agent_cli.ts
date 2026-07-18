import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type AgentClient = "claude-code" | "kimi-code";
export type JsonRecord = Record<string, unknown>;

export const DEFAULT_CLAUDE_EVAL_MODEL = "sonnet";
export const REQUIRED_DEFAULT_CLAUDE_EXECUTION_MODEL = "deepseek-v4-pro";

export type AnalysisEligibilityReason =
  | "completed"
  | "predeclared_turn_limit"
  | "wall_timeout"
  | "transport_failure"
  | "client_failure";

export interface AnalysisEligibility {
  eligible: boolean;
  reason: AnalysisEligibilityReason;
}

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

export function assertDefaultClaudeExecutionModel(
  client: AgentClient,
  requestedModel: string,
  emittedModels: readonly string[],
): void {
  if (client !== "claude-code" || requestedModel !== DEFAULT_CLAUDE_EVAL_MODEL) return;
  const observed = [...new Set(emittedModels)].sort();
  if (
    observed.length !== 1 ||
    observed[0] !== REQUIRED_DEFAULT_CLAUDE_EXECUTION_MODEL
  ) {
    throw new Error(
      `default Claude eval requires assistant execution model ${REQUIRED_DEFAULT_CLAUDE_EXECUTION_MODEL}; observed ${observed.join(",") || "none"}`,
    );
  }
}

function isMonetaryField(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  return words.some((word) =>
    ["billing", "charge", "cost", "dollar", "price", "spend", "usd"].includes(word),
  );
}

export function withoutMonetaryFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutMonetaryFields);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as JsonRecord)
      .filter(([key]) => !isMonetaryField(key))
      .map(([key, child]) => [key, withoutMonetaryFields(child)]),
  );
}

export function aggregateTokenUsage(usages: JsonRecord[]): JsonRecord {
  const totals: JsonRecord = {};
  for (const usage of usages) {
    for (const [key, value] of Object.entries(usage)) {
      if (
        key === "total_tokens" ||
        !/tokens?$/i.test(key) ||
        typeof value !== "number" ||
        !Number.isFinite(value)
      ) {
        continue;
      }
      totals[key] = (typeof totals[key] === "number" ? totals[key] : 0) + value;
    }
  }
  totals.total_tokens = Object.values(totals).reduce<number>(
    (sum, value) => sum + (typeof value === "number" ? value : 0),
    0,
  );
  return totals;
}

export function sanitizeAgentStreamForPersistence(stdout: string): string {
  return stdout
    .split("\n")
    .map((line) => {
      const source = line.endsWith("\r") ? line.slice(0, -1) : line;
      try {
        return JSON.stringify(withoutMonetaryFields(JSON.parse(source)));
      } catch {
        return source
          .replace(
            /(?:--)?\b(?:total[-_]cost[-_]usd|costUSD|totalCostUsd|paid[-_]budget[-_]usd|max[-_]budget[-_]usd)\b\s*(?::|=|\s)\s*[^\s,}]+/gi,
            "[monetary field removed]",
          )
          .replace(/\$\s*\d+(?:\.\d+)?/g, "[monetary amount removed]")
          .replace(/\bUSD\s*\d+(?:\.\d+)?\b/gi, "[monetary amount removed]")
          .replace(/\b\d+(?:\.\d+)?\s*USD\b/gi, "[monetary amount removed]");
      }
    })
    .join("\n");
}

export function claudeBudgetCharge(stdout: string): number | null {
  let charge = 0;
  let observed = false;
  for (const line of stdout.split(/\r?\n/)) {
    try {
      const event = asRecord(JSON.parse(line));
      if (event.type !== "result") continue;
      const value = event.total_cost_usd;
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        observed = true;
        charge += value;
      }
    } catch {
      // Ignore non-JSON client output while accounting from result events.
    }
  }
  return observed ? charge : null;
}

export class ApiBudgetGuard {
  readonly limit: number | undefined;
  private used = 0;
  private accountingComplete = true;

  constructor(limit?: number) {
    this.limit = limit;
  }

  remaining(): number | undefined {
    if (!this.accountingComplete) {
      throw new Error(
        "Claude did not report budget usage for the preceding invocation; refusing another model call",
      );
    }
    return this.limit === undefined
      ? undefined
      : Number((this.limit - this.used).toFixed(6));
  }

  recordClaudeStream(stdout: string): void {
    this.recordCharge(claudeBudgetCharge(stdout));
  }

  recordCharge(charge: number | null): void {
    if (charge === null || !Number.isFinite(charge) || charge < 0) {
      this.accountingComplete = false;
      return;
    }
    this.used += charge;
  }
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
      parsed.usage = withoutMonetaryFields(asRecord(event.usage)) as JsonRecord;
      parsed.usage.num_turns = event.num_turns;
      parsed.model_usage = withoutMonetaryFields(
        asRecord(event.modelUsage ?? event.model_usage),
      ) as JsonRecord;
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
    const tokenFields = {
      inputOther: "input_tokens",
      inputCacheRead: "cache_read_input_tokens",
      inputCacheCreation: "cache_creation_input_tokens",
      output: "output_tokens",
    } as const;
    for (const [source, destination] of Object.entries(tokenFields)) {
      addNumeric(usage, destination, record[source]);
    }
    const model = stringValue(event.model, "unknown");
    const modelRecord = perModel.get(model) ?? {};
    for (const [source, destination] of Object.entries(tokenFields)) {
      addNumeric(modelRecord, destination, record[source]);
    }
    perModel.set(model, modelRecord);
  }
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

export function analysisEligibility(
  client: AgentClient,
  parsed: ParsedAgentStream,
  exitCode: number | null,
  timedOut: boolean,
  maxTurns: number,
): AnalysisEligibility {
  if (timedOut) {
    return { eligible: false, reason: "wall_timeout" };
  }
  if (
    client === "claude-code" &&
    exitCode === 1 &&
    parsed.result_count === 1 &&
    parsed.result_subtype === "error_max_turns" &&
    parsed.result_is_error === true &&
    parsed.num_turns >= maxTurns
  ) {
    return { eligible: true, reason: "predeclared_turn_limit" };
  }
  if (exitCode === null) {
    return { eligible: false, reason: "transport_failure" };
  }
  if (!clientRunSucceeded(client, parsed, exitCode, false)) {
    return { eligible: false, reason: "client_failure" };
  }
  return { eligible: true, reason: "completed" };
}

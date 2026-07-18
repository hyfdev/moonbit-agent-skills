#!/usr/bin/env node

/**
 * Activation eval: can an agent that only sees the skill catalog decide,
 * per natural request, whether to load moonbit-language, moonbit-toolchain,
 * both, the maintainer skill, or neither?
 *
 * Usage:
 *   node evals/activation/run_activation.ts --model claude-haiku-4-5-20251001 \
 *     [--categories language-only,toolchain-only] [--ids id1,id2] [--resume] [--dry-run]
 *
 * Results land in evals/activation/runs/<run-name>/ (gitignored):
 *   run.json       immutable run configuration and environment disclosure
 *   results.jsonl  one line per prompt with activated set, verdict, and usage
 *   summary.json   aggregated routing metrics, resolved models, and cost
 *   transcripts/   raw Claude stream-json and stderr per prompt
 */

import { spawn } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { arch, platform, release, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const SKILLS_SRC = join(REPO_ROOT, "skills");
const RUNS_ROOT = join(HERE, "runs");
const MOONBIT_SKILL_NAMES = [
  "moonbit-agent-skills-maintainer",
  "moonbit-language",
  "moonbit-toolchain",
] as const;
const MOONBIT_SKILLS = new Set<string>(MOONBIT_SKILL_NAMES);
const DISALLOWED_TOOLS = "Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch,Task";
const MODEL_ENVIRONMENT_NAMES = [
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL",
  "CLAUDE_CODE_EFFORT_LEVEL",
] as const;

interface PromptExpectation {
  required?: string[];
  forbidden?: string[];
}

export interface ActivationPrompt {
  id: string;
  category: string;
  moonbit_named?: boolean;
  prompt: string;
  workspace?: Record<string, string>;
  expected: PromptExpectation;
}

interface ToolUse {
  name: string;
  input: Record<string, unknown>;
}

export interface ParsedActivationStream {
  activatedAll: string[];
  finalText: string;
  modelUsage: Record<string, unknown>;
  numTurns: number | null;
  toolUses: ToolUse[];
  usage: Record<string, unknown>;
}

interface ActivationVerdict {
  recall_ok: boolean;
  no_forbidden: boolean;
  exact: boolean;
}

export interface ActivationResult {
  id: string;
  category: string;
  moonbit_named: boolean;
  activated: string[];
  activated_all: string[];
  expected: PromptExpectation;
  verdict: ActivationVerdict;
  usage: Record<string, unknown>;
  model_usage: Record<string, unknown>;
  num_turns: number | null;
  exit_code: number | null;
  timed_out: boolean;
  stderr_tail: string;
  transcript: string;
  stderr: string;
  final_text: string;
  tool_uses: ToolUse[];
}

interface EnvironmentDisclosure {
  client: string;
  node_version: string;
  platform: string;
  model_environment: Record<string, string>;
}

export interface ActivationSummary {
  model: string;
  max_turns: number;
  environment: EnvironmentDisclosure;
  resolved_models: string[];
  n: number;
  trigger_recall_overall: number | null;
  trigger_recall_by_category: Record<string, number | null>;
  false_positive_rate_negative: number | null;
  routing_exact_accuracy: Record<string, number | null>;
  multi_skill_accuracy_combined: number | null;
  recall_when_moonbit_not_named: number | null;
  user_ever_needed_to_name_skill: false;
  total_cost_usd: number;
  errors: string[];
}

interface CliOptions {
  categories?: Set<string>;
  dryRun: boolean;
  ids?: Set<string>;
  maxTurns: number;
  model: string;
  resume: boolean;
  runName: string;
}

interface CommandResult {
  exitCode: number | null;
  stderr: string;
  stdout: string;
  timedOut: boolean;
}

interface RunConfig {
  runner: "activation";
  model: string;
  max_turns: number;
  environment: EnvironmentDisclosure;
}

const USAGE =
  "Usage: node evals/activation/run_activation.ts [--model ID] [--max-turns N] " +
  "[--categories LIST] [--ids LIST] [--run-name NAME] [--resume] [--dry-run]";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${field} must be an array of strings`);
  }
  return value;
}

function commaSet(value: string | undefined): Set<string> | undefined {
  if (value === undefined) return undefined;
  return new Set(value.split(","));
}

export function parseCliArgs(argv: string[]): CliOptions {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    strict: true,
    options: {
      categories: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      ids: { type: "string" },
      "max-turns": { type: "string", default: "12" },
      model: { type: "string", default: "claude-haiku-4-5-20251001" },
      resume: { type: "boolean", default: false },
      "run-name": { type: "string" },
    },
  });
  if (values.help) {
    console.log(USAGE);
    throw Object.assign(new Error(""), { exitCode: 0 });
  }
  if (!/^\d+$/.test(values["max-turns"])) {
    throw new Error("--max-turns must be a positive integer");
  }
  const maxTurns = Number.parseInt(values["max-turns"], 10);
  if (!Number.isSafeInteger(maxTurns) || maxTurns < 1) {
    throw new Error("--max-turns must be a positive integer");
  }
  const runName = values["run-name"] ?? values.model.replaceAll("/", "-");
  if (!/^[a-zA-Z0-9._-]+$/.test(runName)) {
    throw new Error("--run-name may contain only letters, digits, dot, underscore, and hyphen");
  }
  return {
    categories: commaSet(values.categories),
    dryRun: values["dry-run"],
    ids: commaSet(values.ids),
    maxTurns,
    model: values.model,
    resume: values.resume,
    runName,
  };
}

export function loadPrompts(path: string): ActivationPrompt[] {
  const prompts: ActivationPrompt[] = [];
  const seenIds = new Set<string>();
  for (const [index, rawLine] of readFileSync(path, "utf8").split("\n").entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      throw new Error(`${path}:${index + 1}: invalid JSON: ${(error as Error).message}`);
    }
    if (!isRecord(raw)) throw new Error(`${path}:${index + 1}: prompt must be an object`);
    if (typeof raw.id !== "string" || !/^[a-zA-Z0-9._-]+$/.test(raw.id)) {
      throw new Error(`${path}:${index + 1}: id must use letters, digits, dot, underscore, or hyphen`);
    }
    if (seenIds.has(raw.id)) throw new Error("duplicate prompt ids in prompts.jsonl");
    seenIds.add(raw.id);
    if (typeof raw.category !== "string" || typeof raw.prompt !== "string") {
      throw new Error(`${raw.id}: category and prompt must be strings`);
    }
    if (!isRecord(raw.expected)) throw new Error(`${raw.id}: expected must be an object`);
    const required = stringArray(raw.expected.required, `${raw.id}: expected.required`);
    const forbidden = stringArray(raw.expected.forbidden, `${raw.id}: expected.forbidden`);
    for (const skill of [...required, ...forbidden]) {
      if (!MOONBIT_SKILLS.has(skill)) {
        throw new Error(`${raw.id}: unknown skill ${JSON.stringify(skill)} in expectation`);
      }
    }
    const lowered = raw.prompt.toLowerCase();
    if (
      lowered.includes("moonbit-language") ||
      lowered.includes("moonbit-toolchain") ||
      lowered.includes("skill")
    ) {
      throw new Error(`${raw.id}: prompt names a skill — that defeats the point of this eval`);
    }
    let workspace: Record<string, string> | undefined;
    if (raw.workspace !== undefined) {
      if (!isRecord(raw.workspace)) throw new Error(`${raw.id}: workspace must be an object`);
      workspace = {};
      for (const [workspacePath, content] of Object.entries(raw.workspace)) {
        if (typeof content !== "string") {
          throw new Error(`${raw.id}: workspace content for ${workspacePath} must be a string`);
        }
        workspace[workspacePath] = content;
      }
    }
    if (raw.moonbit_named !== undefined && typeof raw.moonbit_named !== "boolean") {
      throw new Error(`${raw.id}: moonbit_named must be a boolean`);
    }
    prompts.push({
      id: raw.id,
      category: raw.category,
      moonbit_named: raw.moonbit_named as boolean | undefined,
      prompt: raw.prompt,
      workspace,
      expected: { required, forbidden },
    });
  }
  return prompts;
}

export function parseActivationStream(stdout: string): ParsedActivationStream {
  const parsed: ParsedActivationStream = {
    activatedAll: [],
    finalText: "",
    modelUsage: {},
    numTurns: null,
    toolUses: [],
    usage: {},
  };
  for (const line of stdout.split("\n")) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(event)) continue;
    if (event.type === "assistant" && isRecord(event.message) && Array.isArray(event.message.content)) {
      for (const rawBlock of event.message.content) {
        if (!isRecord(rawBlock) || rawBlock.type !== "tool_use") continue;
        const name = typeof rawBlock.name === "string" ? rawBlock.name : "";
        const input = isRecord(rawBlock.input) ? rawBlock.input : {};
        parsed.toolUses.push({ name, input });
        if (name === "Skill") {
          const skill = typeof input.skill === "string" ? input.skill : "";
          if (skill && !parsed.activatedAll.includes(skill)) parsed.activatedAll.push(skill);
        }
      }
    } else if (event.type === "result") {
      parsed.finalText = typeof event.result === "string" ? event.result : parsed.finalText;
      parsed.usage = isRecord(event.usage) ? { ...event.usage } : {};
      parsed.usage.total_cost_usd = event.total_cost_usd;
      parsed.numTurns = typeof event.num_turns === "number" ? event.num_turns : null;
      const modelUsage = event.modelUsage ?? event.model_usage;
      parsed.modelUsage = isRecord(modelUsage) ? modelUsage : {};
    }
  }
  return parsed;
}

function rate(
  items: ActivationResult[],
  predicate: (result: ActivationResult) => boolean,
): number | null {
  if (items.length === 0) return null;
  return Number((items.filter(predicate).length / items.length).toFixed(3));
}

export function summarize(
  results: ActivationResult[],
  model: string,
  maxTurns: number,
  environment: EnvironmentDisclosure,
): ActivationSummary {
  const byCategory = new Map<string, ActivationResult[]>();
  for (const result of results) {
    const items = byCategory.get(result.category) ?? [];
    items.push(result);
    byCategory.set(result.category, items);
  }
  const sortedCategories = [...byCategory.keys()].sort();
  const negatives = byCategory.get("negative") ?? [];
  const combined = byCategory.get("combined") ?? [];
  const unnamed = results.filter(
    (result) => !result.moonbit_named && result.category !== "negative",
  );
  const positives = results.filter((result) => result.category !== "negative");
  const triggerRecallByCategory: Record<string, number | null> = {};
  const routingExactAccuracy: Record<string, number | null> = {};
  for (const category of sortedCategories) {
    const items = byCategory.get(category) ?? [];
    if (category !== "negative") {
      triggerRecallByCategory[category] = rate(items, (result) => result.verdict.recall_ok);
    }
    routingExactAccuracy[category] = rate(items, (result) => result.verdict.exact);
  }
  return {
    model,
    max_turns: maxTurns,
    environment,
    resolved_models: [
      ...new Set(results.flatMap((result) => Object.keys(result.model_usage ?? {}))),
    ].sort(),
    n: results.length,
    trigger_recall_overall: rate(positives, (result) => result.verdict.recall_ok),
    trigger_recall_by_category: triggerRecallByCategory,
    false_positive_rate_negative: rate(negatives, (result) => result.activated.length > 0),
    routing_exact_accuracy: routingExactAccuracy,
    multi_skill_accuracy_combined: rate(combined, (result) => result.verdict.exact),
    recall_when_moonbit_not_named: rate(unnamed, (result) => result.verdict.recall_ok),
    user_ever_needed_to_name_skill: false,
    total_cost_usd: Number(
      results
        .reduce((total, result) => {
          const cost = result.usage.total_cost_usd;
          return total + (typeof cost === "number" ? cost : 0);
        }, 0)
        .toFixed(4),
    ),
    errors: results.filter((result) => result.exit_code !== 0).map((result) => result.id),
  };
}

async function execute(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number },
): Promise<CommandResult> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let forceKillTimer: NodeJS.Timeout | undefined;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    }, options.timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      reject(error);
    });
    child.once("close", (exitCode) => {
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolvePromise({ exitCode, stderr, stdout, timedOut });
    });
  });
}

function safeWorkspacePath(project: string, path: string): string {
  const destination = resolve(project, path);
  const fromProject = relative(project, destination);
  if (!fromProject || fromProject.startsWith("..") || isAbsolute(fromProject)) {
    throw new Error(`workspace path escapes or replaces the project root: ${path}`);
  }
  return destination;
}

export function materializePrompt(project: string, prompt: ActivationPrompt): void {
  const skillsDestination = join(project, ".claude", "skills");
  mkdirSync(skillsDestination, { recursive: true });
  const skillDirectories = readdirSync(SKILLS_SRC, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(SKILLS_SRC, entry.name, "SKILL.md")))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const skillDirectory of skillDirectories) {
    cpSync(join(SKILLS_SRC, skillDirectory.name), join(skillsDestination, skillDirectory.name), {
      recursive: true,
    });
  }
  for (const [path, content] of Object.entries(prompt.workspace ?? {})) {
    const destination = safeWorkspacePath(project, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
}

async function runOne(
  prompt: ActivationPrompt,
  model: string,
  maxTurns: number,
  runDirectory: string,
): Promise<ActivationResult> {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "mbtact-"));
  const project = join(temporaryRoot, "project");
  mkdirSync(project);
  let commandResult: CommandResult;
  try {
    materializePrompt(project, prompt);
    commandResult = await execute(
      "claude",
      [
        "-p",
        prompt.prompt,
        "--model",
        model,
        "--output-format",
        "stream-json",
        "--verbose",
        "--max-turns",
        String(maxTurns),
        "--strict-mcp-config",
        "--disallowedTools",
        DISALLOWED_TOOLS,
      ],
      { cwd: project, timeoutMs: 600_000 },
    );
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }

  const parsed = parseActivationStream(commandResult.stdout);
  const required = new Set(prompt.expected.required ?? []);
  const forbidden = new Set(prompt.expected.forbidden ?? []);
  const activatedMoonbit = new Set(
    parsed.activatedAll.filter((skill) => MOONBIT_SKILLS.has(skill)),
  );
  const recallOk = [...required].every((skill) => activatedMoonbit.has(skill));
  const noForbidden = [...forbidden].every((skill) => !activatedMoonbit.has(skill));
  const exact =
    activatedMoonbit.size === required.size &&
    [...activatedMoonbit].every((skill) => required.has(skill));

  const transcriptsDirectory = join(runDirectory, "transcripts");
  mkdirSync(transcriptsDirectory, { recursive: true });
  const transcriptRelative = join("transcripts", `${prompt.id}.jsonl`);
  const stderrRelative = join("transcripts", `${prompt.id}.stderr.txt`);
  writeFileSync(join(runDirectory, transcriptRelative), commandResult.stdout);
  writeFileSync(join(runDirectory, stderrRelative), commandResult.stderr);

  return {
    id: prompt.id,
    category: prompt.category,
    moonbit_named: prompt.moonbit_named ?? true,
    activated: [...activatedMoonbit].sort(),
    activated_all: parsed.activatedAll,
    expected: prompt.expected,
    verdict: { recall_ok: recallOk, no_forbidden: noForbidden, exact },
    usage: parsed.usage,
    model_usage: parsed.modelUsage,
    num_turns: parsed.numTurns,
    exit_code: commandResult.exitCode,
    timed_out: commandResult.timedOut,
    stderr_tail: commandResult.exitCode === 0 ? "" : commandResult.stderr.slice(-400),
    transcript: transcriptRelative,
    stderr: stderrRelative,
    final_text: parsed.finalText,
    tool_uses: parsed.toolUses,
  };
}

async function preflight(): Promise<EnvironmentDisclosure> {
  let clientResult: CommandResult;
  try {
    clientResult = await execute("claude", ["--version"], {
      cwd: REPO_ROOT,
      timeoutMs: 30_000,
    });
  } catch (error) {
    throw new Error(`required tool claude is unavailable: ${(error as Error).message}`);
  }
  if (clientResult.exitCode !== 0) {
    throw new Error(`claude --version failed: ${clientResult.stderr.trim()}`);
  }
  const modelEnvironment: Record<string, string> = {};
  for (const name of MODEL_ENVIRONMENT_NAMES) {
    const value = process.env[name];
    if (value) modelEnvironment[name] = value;
  }
  return {
    client: clientResult.stdout.trim(),
    node_version: process.version,
    platform: `${platform()}-${release()}-${arch()}`,
    model_environment: modelEnvironment,
  };
}

export function ensureRunManifest(
  runDirectory: string,
  config: RunConfig,
  hasResults: boolean,
): void {
  const manifestPath = join(runDirectory, "run.json");
  if (existsSync(manifestPath)) {
    const previous = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    const differing = Object.keys({ ...previous, ...config })
      .filter(
        (key) =>
          JSON.stringify(previous[key]) !== JSON.stringify(config[key as keyof RunConfig]),
      )
      .sort();
    if (differing.length > 0) {
      throw new Error(
        `run configuration differs from existing run.json for: ${differing.join(", ")}; ` +
          "use a fresh --run-name",
      );
    }
    return;
  }
  if (hasResults) {
    throw new Error("cannot safely resume results without run.json; use a fresh --run-name");
  }
  writeFileSync(manifestPath, `${JSON.stringify(config, null, 2)}\n`);
}

export function loadExistingResults(path: string): ActivationResult[] {
  if (!existsSync(path)) return [];
  const results: ActivationResult[] = [];
  const ids = new Set<string>();
  for (const [index, line] of readFileSync(path, "utf8").split("\n").entries()) {
    if (!line.trim()) continue;
    const result = JSON.parse(line) as ActivationResult;
    if (typeof result.id !== "string") throw new Error(`${path}:${index + 1}: missing result id`);
    if (ids.has(result.id)) throw new Error(`${path}:${index + 1}: duplicate result id ${result.id}`);
    ids.add(result.id);
    results.push(result);
  }
  return results;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const options = parseCliArgs(argv);
  let prompts = loadPrompts(join(HERE, "prompts.jsonl"));
  if (options.categories) {
    prompts = prompts.filter((prompt) => options.categories?.has(prompt.category));
  }
  if (options.ids) prompts = prompts.filter((prompt) => options.ids?.has(prompt.id));
  if (prompts.length === 0) throw new Error("no prompts selected");
  if (options.dryRun) {
    console.log(`prompts.jsonl valid: ${prompts.length} prompt(s) selected`);
    return 0;
  }

  const environment = await preflight();
  const runDirectory = join(RUNS_ROOT, options.runName);
  mkdirSync(runDirectory, { recursive: true });
  const resultsPath = join(runDirectory, "results.jsonl");
  if (existsSync(resultsPath) && !options.resume) {
    throw new Error(`${resultsPath} already exists; use a fresh --run-name or --resume`);
  }
  const config: RunConfig = {
    runner: "activation",
    model: options.model,
    max_turns: options.maxTurns,
    environment,
  };
  ensureRunManifest(runDirectory, config, existsSync(resultsPath));

  const results = loadExistingResults(resultsPath);
  const completed = new Set(results.map((result) => result.id));
  for (const [index, prompt] of prompts.entries()) {
    if (completed.has(prompt.id)) {
      console.log(`[${index + 1}/${prompts.length}] ${prompt.id} ... already complete`);
      continue;
    }
    console.log(`[${index + 1}/${prompts.length}] ${prompt.id} ...`);
    const result = await runOne(prompt, options.model, options.maxTurns, runDirectory);
    results.push(result);
    appendFileSync(resultsPath, `${JSON.stringify(result)}\n`);
    const status = result.verdict.exact ? "OK " : "MISS";
    console.log(`    ${status} activated=${JSON.stringify(result.activated)}`);
  }

  const summary = summarize(results, options.model, options.maxTurns, environment);
  writeFileSync(join(runDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  return 0;
}

const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  main().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error: unknown) => {
      const exitCode = isRecord(error) && typeof error.exitCode === "number" ? error.exitCode : 1;
      const message = error instanceof Error ? error.message : String(error);
      if (message) console.error(message);
      process.exitCode = exitCode;
    },
  );
}

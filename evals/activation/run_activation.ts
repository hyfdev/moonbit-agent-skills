#!/usr/bin/env node

/**
 * Activation eval with two explicitly different measurements:
 * - routing: prompted catalog classification, not automatic activation;
 * - end-to-end: natural-request observation before the first domain action.
 *
 * Usage:
 *   node evals/activation/run_activation.ts --model claude-haiku-4-5-20251001 \
 *     [--categories language-only,toolchain-only] [--ids id1,id2] [--resume] [--dry-run]
 *
 * Results land in evals/activation/runs/<run-name>/ (gitignored):
 *   run.json       immutable run configuration and environment disclosure
 *   results.jsonl  one line per prompt with activated set, verdict, and usage
 *   summary.json   labeled metrics, token counts, duration, models, client, and errors
 *   transcripts/   sanitized client stream-json and stderr per prompt
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { arch, platform, release, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import {
  ApiBudgetGuard,
  aggregateTokenUsage,
  buildAgentInvocation,
  claudeBudgetCharge,
  clientExecutable,
  clientRunSucceeded,
  enrichKimiStream,
  parseAgentStream,
  parseClaudeStream,
  sanitizeAgentStreamForPersistence,
  type AgentClient,
  type ParsedAgentStream,
} from "../lib/agent_cli.ts";

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
const ACTION_TOOLS = new Set(["Bash", "Edit", "Write", "NotebookEdit"]);
const NETWORK_OR_DELEGATION_TOOLS = [
  "WebFetch",
  "WebSearch",
  "FetchURL",
  "Task",
  "Agent",
  "AgentSwarm",
];
const MODEL_ENVIRONMENT_NAMES = [
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL",
  "CLAUDE_CODE_EFFORT_LEVEL",
] as const;

export interface PromptExpectation {
  required?: string[];
  forbidden?: string[];
}

export type ActivationMode = "routing" | "end-to-end";
export type ActivationMeasurement =
  | "prompted-routing-classification"
  | "natural-end-to-end-activation-observation";

export interface ActivationPrompt {
  id: string;
  category: string;
  moonbit_named?: boolean;
  prompt: string;
  workspace?: Record<string, string>;
  expected: PromptExpectation;
}

interface ToolUse {
  id?: string;
  name: string;
  input: Record<string, unknown>;
  assistant_turn?: number;
  event_index?: number;
}

interface SkillCall extends ToolUse {
  skill: string;
  succeeded: boolean;
}

export interface ParsedActivationStream {
  activatedAll: string[];
  activatedSucceeded: string[];
  activatedFailed: string[];
  finalText: string;
  modelUsage: Record<string, unknown>;
  numTurns: number | null;
  skillCalls: SkillCall[];
  toolUses: ToolUse[];
  usage: Record<string, unknown>;
  emittedModels?: string[];
  sessionId?: string | null;
}

interface ActivationVerdict {
  recall_ok: boolean;
  timely_recall_ok?: boolean;
  no_forbidden: boolean;
  exact: boolean;
}

export interface ActivationResult {
  id: string;
  category: string;
  moonbit_named: boolean;
  activated: string[];
  activated_all: string[];
  activated_attempted?: string[];
  activated_succeeded?: string[];
  activated_failed?: string[];
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
  client?: AgentClient;
  mode?: ActivationMode;
  measurement?: ActivationMeasurement;
  repetition?: number;
  emitted_models?: string[];
  first_skill_call_index?: number | null;
  first_domain_action_index?: number | null;
  activated_before_domain_action?: string[];
  duration_ms?: number;
}

interface EnvironmentDisclosure {
  client: string;
  node_version: string;
  platform: string;
  model_environment: Record<string, string>;
  agent_client?: AgentClient;
  provider_origin?: string | null;
}

export interface ActivationSummary {
  measurement: ActivationMeasurement;
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
  timely_trigger_recall_overall?: number | null;
  usage: Record<string, unknown>;
  duration_ms: number;
  errors: string[];
}

interface CliOptions {
  client: AgentClient;
  categories?: Set<string>;
  dryRun: boolean;
  ids?: Set<string>;
  maxTurns: number;
  model: string;
  mode: ActivationMode;
  paidBudgetUsd?: number;
  repetitions: number;
  resume: boolean;
  runName: string;
}

interface CommandResult {
  exitCode: number | null;
  stderr: string;
  stdout: string;
  timedOut: boolean;
  durationMs?: number;
}

export function stderrTailForPersistence(
  exitCode: number | null,
  stderr: string,
): string {
  return exitCode === 0
    ? ""
    : sanitizeAgentStreamForPersistence(stderr.slice(-400));
}

interface RunConfig {
  runner: "activation" | "activation-v2" | "activation-v3" | "activation-v4";
  client?: AgentClient;
  model: string;
  mode?: ActivationMode;
  measurement?: ActivationMeasurement;
  max_turns: number;
  repetitions?: number;
  environment: EnvironmentDisclosure;
  input_snapshot?: ActivationInputManifest;
  runner_files?: Record<string, string>;
}

export interface ActivationInputManifest {
  prompts: {
    ids: string[];
    sha256: string;
  };
  skills: {
    aggregate_sha256: string;
    files: Record<string, string>;
  };
}

export interface PreparedActivationInputs {
  manifest: ActivationInputManifest;
  prompts: ActivationPrompt[];
  skillsDirectory: string;
}

const USAGE =
  "Usage: node evals/activation/run_activation.ts " +
  "[--client claude-code|kimi-code] [--model ID] [--mode routing|end-to-end] " +
  "[--max-turns N] [--repetitions N] [--paid-budget-usd N] " +
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
      client: { type: "string", default: "claude-code" },
      categories: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      ids: { type: "string" },
      "max-turns": { type: "string", default: "12" },
      mode: { type: "string", default: "routing" },
      model: { type: "string" },
      "paid-budget-usd": { type: "string" },
      repetitions: { type: "string", default: "1" },
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
  if (values.client !== "claude-code" && values.client !== "kimi-code") {
    throw new Error("--client must be claude-code or kimi-code");
  }
  if (values.mode !== "routing" && values.mode !== "end-to-end") {
    throw new Error("--mode must be routing or end-to-end");
  }
  if (!/^\d+$/.test(values.repetitions)) {
    throw new Error("--repetitions must be a positive integer");
  }
  const repetitions = Number.parseInt(values.repetitions, 10);
  if (!Number.isSafeInteger(repetitions) || repetitions < 1) {
    throw new Error("--repetitions must be a positive integer");
  }
  const paidBudgetUsd =
    values["paid-budget-usd"] === undefined
      ? undefined
      : Number(values["paid-budget-usd"]);
  if (
    paidBudgetUsd !== undefined &&
    (!Number.isFinite(paidBudgetUsd) || paidBudgetUsd <= 0)
  ) {
    throw new Error("--paid-budget-usd must be a positive number");
  }
  const model =
    values.model ?? (values.client === "kimi-code" ? "kimi-code/k3" : "haiku");
  const runName =
    values["run-name"] ??
    `${values.client}-${values.mode}-${model.replaceAll("/", "-")}`;
  if (!/^[a-zA-Z0-9._-]+$/.test(runName)) {
    throw new Error("--run-name may contain only letters, digits, dot, underscore, and hyphen");
  }
  return {
    client: values.client,
    categories: commaSet(values.categories),
    dryRun: values["dry-run"],
    ids: commaSet(values.ids),
    maxTurns,
    model,
    mode: values.mode,
    paidBudgetUsd,
    repetitions,
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

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function fileDigest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function walkFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile() || (entry.isSymbolicLink() && isFile(path))) {
        files.push(path);
      }
    }
  };
  visit(root);
  return files.sort();
}

function installableSkillDirectories(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isFile(join(root, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();
}

function installedSkillFiles(root: string): Record<string, string> {
  return Object.fromEntries(
    installableSkillDirectories(root).flatMap((skill) =>
      walkFiles(join(root, skill)).map((path) => [relative(root, path), fileDigest(path)]),
    ),
  );
}

function canonicalPrompts(prompts: ActivationPrompt[]): string {
  return (
    prompts
      .map((prompt) =>
        JSON.stringify({
          id: prompt.id,
          category: prompt.category,
          moonbit_named: prompt.moonbit_named,
          prompt: prompt.prompt,
          workspace: prompt.workspace,
          expected: {
            required: prompt.expected.required ?? [],
            forbidden: prompt.expected.forbidden ?? [],
          },
        }),
      )
      .join("\n") + "\n"
  );
}

function aggregateDigest(files: Record<string, string>): string {
  return createHash("sha256").update(JSON.stringify(files)).digest("hex");
}

export function prepareActivationInputs(
  runDirectory: string,
  selectedPrompts: ActivationPrompt[],
  skillsSource = SKILLS_SRC,
): PreparedActivationInputs {
  const snapshotRoot = join(runDirectory, "_cache", "activation-inputs");
  const promptsPath = join(snapshotRoot, "prompts.jsonl");
  const skillsDirectory = join(snapshotRoot, "skills");
  const expectedPromptText = canonicalPrompts(selectedPrompts);
  const expectedSkillFiles = installedSkillFiles(skillsSource);
  if (Object.keys(expectedSkillFiles).length === 0) {
    throw new Error("activation input snapshot has no installable skills");
  }

  const hasPromptSnapshot = isFile(promptsPath);
  const hasSkillSnapshot = isDirectory(skillsDirectory);
  if (hasPromptSnapshot !== hasSkillSnapshot) {
    throw new Error("activation input snapshot is incomplete; use a fresh --run-name");
  }
  if (!hasPromptSnapshot) {
    mkdirSync(snapshotRoot, { recursive: true });
    writeFileSync(promptsPath, expectedPromptText);
    mkdirSync(skillsDirectory);
    for (const skill of installableSkillDirectories(skillsSource)) {
      cpSync(join(skillsSource, skill), join(skillsDirectory, skill), { recursive: true });
    }
  }

  const actualPromptText = readFileSync(promptsPath, "utf8");
  if (actualPromptText !== expectedPromptText) {
    throw new Error("selected prompts differ from the frozen activation snapshot; use a fresh --run-name");
  }
  const actualSkillFiles = installedSkillFiles(skillsDirectory);
  if (!isDeepStrictEqual(actualSkillFiles, expectedSkillFiles)) {
    throw new Error("installed skills differ from the frozen activation snapshot; use a fresh --run-name");
  }
  const frozenPrompts = loadPrompts(promptsPath);
  if (canonicalPrompts(frozenPrompts) !== expectedPromptText) {
    throw new Error("frozen activation prompts did not round-trip; use a fresh --run-name");
  }
  return {
    manifest: {
      prompts: {
        ids: frozenPrompts.map((prompt) => prompt.id),
        sha256: createHash("sha256").update(actualPromptText).digest("hex"),
      },
      skills: {
        aggregate_sha256: aggregateDigest(actualSkillFiles),
        files: actualSkillFiles,
      },
    },
    prompts: frozenPrompts,
    skillsDirectory,
  };
}

export function measurementForMode(mode: ActivationMode): ActivationMeasurement {
  return mode === "routing"
    ? "prompted-routing-classification"
    : "natural-end-to-end-activation-observation";
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => value !== ""))].sort();
}

function parsedActivationView(normalized: ParsedAgentStream): ParsedActivationStream {
  const resultsByUse = new Map(
    normalized.tool_results.map((result) => [result.tool_use_id, result]),
  );
  const toolUses: ToolUse[] = normalized.tool_uses.map((use) => ({
    id: use.id,
    name: use.name,
    input: isRecord(use.input) ? use.input : {},
    assistant_turn: use.assistant_turn,
    event_index: use.event_index,
  }));
  const skillCalls: SkillCall[] = toolUses
    .filter((use) => use.name === "Skill" && typeof use.input.skill === "string")
    .map((use) => ({
      ...use,
      skill: use.input.skill as string,
      succeeded:
        use.id !== undefined &&
        resultsByUse.has(use.id) &&
        resultsByUse.get(use.id)?.is_error === false,
    }));
  return {
    activatedAll: uniqueSorted(skillCalls.map((call) => call.skill)),
    activatedSucceeded: uniqueSorted(
      skillCalls.filter((call) => call.succeeded).map((call) => call.skill),
    ),
    activatedFailed: uniqueSorted(
      skillCalls.filter((call) => !call.succeeded).map((call) => call.skill),
    ),
    finalText: normalized.final_text,
    modelUsage: normalized.model_usage,
    numTurns: normalized.num_turns,
    skillCalls,
    toolUses,
    usage: normalized.usage,
    emittedModels: normalized.emitted_models,
    sessionId: normalized.session_id,
  };
}

export function parseActivationStream(stdout: string): ParsedActivationStream {
  return parsedActivationView(parseClaudeStream(stdout));
}

export interface ActivationDecision {
  activated: string[];
  activatedAttempted: string[];
  activatedSucceeded: string[];
  activatedFailed: string[];
  activatedBeforeDomainAction: string[];
  firstSkillCallIndex: number | null;
  firstDomainActionIndex: number | null;
  verdict: ActivationVerdict;
}

export function scoreActivation(
  parsed: ParsedActivationStream,
  expected: PromptExpectation,
  mode: ActivationMode,
): ActivationDecision {
  const required = new Set(expected.required ?? []);
  const forbidden = new Set(expected.forbidden ?? []);
  const activatedMoonbit = new Set(
    parsed.activatedSucceeded.filter((skill) => MOONBIT_SKILLS.has(skill)),
  );
  const firstDomainActionIndex = parsed.toolUses.findIndex((use) => ACTION_TOOLS.has(use.name));
  const firstDomainAction =
    firstDomainActionIndex === -1 ? undefined : parsed.toolUses[firstDomainActionIndex];
  const successfulBeforeDomainAction = new Set(
    parsed.skillCalls
      .filter((call) => call.succeeded && MOONBIT_SKILLS.has(call.skill))
      .filter((call) => {
        if (firstDomainAction === undefined) return true;
        return (
          typeof call.assistant_turn === "number" &&
          typeof firstDomainAction.assistant_turn === "number" &&
          call.assistant_turn < firstDomainAction.assistant_turn
        );
      })
      .map((call) => call.skill),
  );
  const recallOk = [...required].every((skill) => activatedMoonbit.has(skill));
  const timelyRecallOk = [...required].every((skill) =>
    successfulBeforeDomainAction.has(skill),
  );
  const noForbidden = [...forbidden].every((skill) => !activatedMoonbit.has(skill));
  const protocolViolation =
    parsed.toolUses.some((use) => NETWORK_OR_DELEGATION_TOOLS.includes(use.name)) ||
    (mode === "routing" && firstDomainActionIndex !== -1);
  const exact =
    activatedMoonbit.size === required.size &&
    [...activatedMoonbit].every((skill) => required.has(skill)) &&
    !protocolViolation;
  const firstSkillCallIndex = parsed.toolUses.findIndex((use) => use.name === "Skill");
  return {
    activated: [...activatedMoonbit].sort(),
    activatedAttempted: parsed.activatedAll,
    activatedSucceeded: parsed.activatedSucceeded,
    activatedFailed: parsed.activatedFailed,
    activatedBeforeDomainAction: [...successfulBeforeDomainAction].sort(),
    firstSkillCallIndex: firstSkillCallIndex === -1 ? null : firstSkillCallIndex,
    firstDomainActionIndex: firstDomainActionIndex === -1 ? null : firstDomainActionIndex,
    verdict: {
      recall_ok: recallOk,
      timely_recall_ok: timelyRecallOk,
      no_forbidden: noForbidden,
      exact,
    },
  };
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
  mode: ActivationMode = "routing",
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
    measurement: measurementForMode(mode),
    model,
    max_turns: maxTurns,
    environment,
    resolved_models: [
      ...new Set(
        results.flatMap((result) => [
          ...(result.emitted_models ?? []),
          ...Object.keys(result.model_usage ?? {}),
        ]),
      ),
    ].sort(),
    n: results.length,
    trigger_recall_overall: rate(positives, (result) => result.verdict.recall_ok),
    timely_trigger_recall_overall: rate(
      positives,
      (result) => result.verdict.timely_recall_ok ?? result.verdict.recall_ok,
    ),
    trigger_recall_by_category: triggerRecallByCategory,
    false_positive_rate_negative: rate(negatives, (result) => result.activated.length > 0),
    routing_exact_accuracy: routingExactAccuracy,
    multi_skill_accuracy_combined: rate(combined, (result) => result.verdict.exact),
    recall_when_moonbit_not_named: rate(unnamed, (result) => result.verdict.recall_ok),
    user_ever_needed_to_name_skill: false,
    usage: aggregateTokenUsage(results.map((result) => result.usage)),
    duration_ms: results.reduce(
      (total, result) => total + (result.duration_ms ?? 0),
      0,
    ),
    errors: results.filter((result) => result.exit_code !== 0).map((result) => result.id),
  };
}

async function execute(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<CommandResult> {
  return await new Promise((resolvePromise, reject) => {
    const started = Date.now();
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
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
      resolvePromise({
        exitCode,
        stderr,
        stdout,
        timedOut,
        durationMs: Date.now() - started,
      });
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

export function materializePrompt(
  project: string,
  prompt: ActivationPrompt,
  skillsSource = SKILLS_SRC,
): void {
  const skillsDestination = join(project, ".claude", "skills");
  mkdirSync(skillsDestination, { recursive: true });
  for (const skill of installableSkillDirectories(skillsSource)) {
    cpSync(join(skillsSource, skill), join(skillsDestination, skill), {
      recursive: true,
    });
  }
  for (const [path, content] of Object.entries(prompt.workspace ?? {})) {
    const destination = safeWorkspacePath(project, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
}

interface ActivationInvocationResult {
  result: ActivationResult;
  budgetCharge: number | null;
}

async function runOne(
  prompt: ActivationPrompt,
  model: string,
  maxTurns: number,
  runDirectory: string,
  client: AgentClient = "claude-code",
  mode: ActivationMode = "routing",
  maxBudgetUsd?: number,
  repetition = 0,
  frozenSkillsSource = SKILLS_SRC,
): Promise<ActivationInvocationResult> {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "mbtact-"));
  const project = join(temporaryRoot, "project");
  mkdirSync(project);
  let commandResult: CommandResult;
  try {
    materializePrompt(project, prompt, frozenSkillsSource);
    const skillsDirectory = join(project, ".claude", "skills");
    const claudeConfigDirectory = join(temporaryRoot, "claude-config");
    mkdirSync(claudeConfigDirectory);
    const evaluatedPrompt =
      mode === "routing"
        ? "Make only the initial routing decision for the user request below. " +
          "Load every applicable skill before any Bash, Edit, Write, or final answer. " +
          "You may inspect supplied files with Read, Glob, or Grep. Do not solve or modify the task. " +
          "After loading the applicable skills, reply ROUTING_COMPLETE; if none apply, reply ROUTING_NONE.\n\n" +
          prompt.prompt
        : prompt.prompt;
    const allowedTools =
      mode === "routing"
        ? ["Skill", "Read", "Glob", "Grep"]
        : ["Skill", "Read", "Glob", "Grep", "Bash", "Edit", "Write"];
    const invocation = buildAgentInvocation({
      client,
      prompt: evaluatedPrompt,
      model,
      maxTurns,
      skillsDir: skillsDirectory,
      allowedTools,
      disallowedTools: [
        ...NETWORK_OR_DELEGATION_TOOLS,
        ...(mode === "routing" ? [...ACTION_TOOLS] : []),
      ],
      claudeConfigDir: claudeConfigDirectory,
      maxBudgetUsd,
    });
    commandResult = await execute(
      invocation.command,
      invocation.args,
      { cwd: project, timeoutMs: 600_000, env: invocation.environment },
    );
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }

  const normalized = parseAgentStream(client, commandResult.stdout);
  if (client === "kimi-code") enrichKimiStream(normalized);
  const parsed = parsedActivationView(normalized);
  const decision = scoreActivation(parsed, prompt.expected, mode);

  const transcriptsDirectory = join(runDirectory, "transcripts");
  mkdirSync(transcriptsDirectory, { recursive: true });
  const artifact = `${prompt.id}--r${String(repetition + 1).padStart(2, "0")}`;
  const transcriptRelative = join("transcripts", `${artifact}.jsonl`);
  const stderrRelative = join("transcripts", `${artifact}.stderr.txt`);
  writeFileSync(
    join(runDirectory, transcriptRelative),
    sanitizeAgentStreamForPersistence(commandResult.stdout),
  );
  writeFileSync(
    join(runDirectory, stderrRelative),
    sanitizeAgentStreamForPersistence(commandResult.stderr),
  );

  const result: ActivationResult = {
    id: prompt.id,
    category: prompt.category,
    moonbit_named: prompt.moonbit_named ?? true,
    activated: decision.activated,
    activated_all: decision.activatedAttempted,
    activated_attempted: decision.activatedAttempted,
    activated_succeeded: decision.activatedSucceeded,
    activated_failed: decision.activatedFailed,
    expected: prompt.expected,
    verdict: decision.verdict,
    usage: parsed.usage,
    model_usage: parsed.modelUsage,
    num_turns: parsed.numTurns,
    exit_code: clientRunSucceeded(
      client,
      normalized,
      commandResult.exitCode,
      commandResult.timedOut,
    ) && normalized.num_turns <= maxTurns
      ? 0
      : commandResult.exitCode ?? 1,
    timed_out: commandResult.timedOut,
    stderr_tail: stderrTailForPersistence(commandResult.exitCode, commandResult.stderr),
    transcript: transcriptRelative,
    stderr: stderrRelative,
    final_text: parsed.finalText,
    tool_uses: parsed.toolUses,
    client,
    mode,
    measurement: measurementForMode(mode),
    repetition,
    emitted_models: normalized.emitted_models,
    first_skill_call_index: decision.firstSkillCallIndex,
    first_domain_action_index: decision.firstDomainActionIndex,
    activated_before_domain_action: decision.activatedBeforeDomainAction,
    duration_ms: commandResult.durationMs ?? 0,
  };
  return {
    result,
    budgetCharge:
      client === "claude-code" ? claudeBudgetCharge(commandResult.stdout) : 0,
  };
}

async function preflight(client: AgentClient): Promise<EnvironmentDisclosure> {
  let clientResult: CommandResult;
  const executable = clientExecutable(client);
  try {
    clientResult = await execute(executable, ["--version"], {
      cwd: REPO_ROOT,
      timeoutMs: 30_000,
    });
  } catch (error) {
    throw new Error(`required tool ${executable} is unavailable: ${(error as Error).message}`);
  }
  if (clientResult.exitCode !== 0) {
    throw new Error(`${executable} --version failed: ${clientResult.stderr.trim()}`);
  }
  const modelEnvironment: Record<string, string> = {};
  if (client === "claude-code") {
    for (const name of MODEL_ENVIRONMENT_NAMES) {
      const value = process.env[name];
      if (value) modelEnvironment[name] = value;
    }
  }
  let providerOrigin: string | null = null;
  if (client === "claude-code" && process.env.ANTHROPIC_BASE_URL) {
    try {
      providerOrigin = new URL(process.env.ANTHROPIC_BASE_URL).origin;
    } catch {
      providerOrigin = "invalid ANTHROPIC_BASE_URL";
    }
  }
  return {
    agent_client: client,
    client: clientResult.stdout.trim(),
    node_version: process.version,
    platform: `${platform()}-${release()}-${arch()}`,
    model_environment: modelEnvironment,
    provider_origin: providerOrigin,
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
    const key = JSON.stringify([result.id, result.repetition ?? 0]);
    if (ids.has(key)) {
      throw new Error(
        `${path}:${index + 1}: duplicate result id/repetition ${result.id}/${result.repetition ?? 0}`,
      );
    }
    ids.add(key);
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
  if (
    options.client === "claude-code" &&
    options.paidBudgetUsd === undefined &&
    !options.resume
  ) {
    throw new Error("Claude Code runs require an explicit --paid-budget-usd total budget");
  }
  if (options.client === "kimi-code" && options.paidBudgetUsd !== undefined) {
    throw new Error("Kimi subscription runs do not accept --paid-budget-usd");
  }

  const environment = await preflight(options.client);
  const runDirectory = join(RUNS_ROOT, options.runName);
  mkdirSync(runDirectory, { recursive: true });
  const resultsPath = join(runDirectory, "results.jsonl");
  if (existsSync(resultsPath) && !options.resume) {
    throw new Error(`${resultsPath} already exists; use a fresh --run-name or --resume`);
  }
  if (
    existsSync(resultsPath) &&
    !isFile(join(runDirectory, "_cache", "activation-inputs", "prompts.jsonl"))
  ) {
    throw new Error(
      "cannot safely resume results without frozen activation inputs; use a fresh --run-name",
    );
  }
  const preparedInputs = prepareActivationInputs(runDirectory, prompts);
  prompts = preparedInputs.prompts;
  const config: RunConfig = {
    runner: "activation-v4",
    client: options.client,
    model: options.model,
    mode: options.mode,
    measurement: measurementForMode(options.mode),
    max_turns: options.maxTurns,
    repetitions: options.repetitions,
    environment,
    input_snapshot: preparedInputs.manifest,
    runner_files: {
      "evals/activation/run_activation.ts": fileDigest(fileURLToPath(import.meta.url)),
      "evals/lib/agent_cli.ts": fileDigest(join(REPO_ROOT, "evals", "lib", "agent_cli.ts")),
    },
  };
  ensureRunManifest(runDirectory, config, existsSync(resultsPath));

  const results = loadExistingResults(resultsPath);
  const completed = new Set(
    results.map((result) => JSON.stringify([result.id, result.repetition ?? 0])),
  );
  if (
    options.client === "claude-code" &&
    options.paidBudgetUsd === undefined &&
    completed.size < prompts.length * options.repetitions
  ) {
    throw new Error(
      "Claude Code needs --paid-budget-usd when unfinished cells require model calls",
    );
  }
  const budgetGuard = new ApiBudgetGuard(options.paidBudgetUsd);
  const totalCells = prompts.length * options.repetitions;
  let cellIndex = 0;
  for (let repetition = 0; repetition < options.repetitions; repetition += 1) {
    const orderedPrompts = repetition % 2 === 0 ? prompts : [...prompts].reverse();
    for (const prompt of orderedPrompts) {
      cellIndex += 1;
      const key = JSON.stringify([prompt.id, repetition]);
      if (completed.has(key)) {
        console.log(
          `[${cellIndex}/${totalCells}] ${prompt.id} r${repetition + 1} ... already complete`,
        );
        continue;
      }
      const remainingBudget = budgetGuard.remaining();
      if (remainingBudget !== undefined && remainingBudget <= 0) {
        throw new Error(
          `paid experiment budget exhausted before ${prompt.id} r${repetition + 1}`,
        );
      }
      console.log(`[${cellIndex}/${totalCells}] ${prompt.id} r${repetition + 1} ...`);
      const invocationResult = await runOne(
        prompt,
        options.model,
        options.maxTurns,
        runDirectory,
        options.client,
        options.mode,
        remainingBudget,
        repetition,
        preparedInputs.skillsDirectory,
      );
      const result = invocationResult.result;
      results.push(result);
      appendFileSync(resultsPath, `${JSON.stringify(result)}\n`);
      budgetGuard.recordCharge(invocationResult.budgetCharge);
      const status = result.verdict.exact ? "OK " : "MISS";
      console.log(
        `    ${status} succeeded=${JSON.stringify(result.activated_succeeded ?? result.activated)} failed=${JSON.stringify(result.activated_failed ?? [])} timely=${JSON.stringify(result.activated_before_domain_action ?? [])}`,
      );
    }
  }

  const summary = {
    ...summarize(results, options.model, options.maxTurns, environment, options.mode),
    runner: "activation-v4",
    client: options.client,
    mode: options.mode,
    repetitions: options.repetitions,
  };
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

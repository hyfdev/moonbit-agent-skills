#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, cp, mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseShell } from "shell-quote";
import type { Comment, ControlOperator, GlobPattern } from "shell-quote";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MANIFEST = join(REPO_ROOT, "verification", "commands", "manifest.json");
const DEFAULT_TEMPLATE = join(REPO_ROOT, "verification", "commands", "template");
const DEFAULT_SKILL = join(REPO_ROOT, "skills", "moonbit-toolchain");
const DEFAULT_TIMEOUT_MS = 300_000;
const OUTPUT_PREVIEW_LENGTH = 600;

type JsonRecord = Record<string, unknown>;

export interface Expectation {
  exit?: number;
  output_contains?: string[];
  paths_exist?: string[];
  paths_absent?: string[];
}

interface BaseStep {
  cwd?: string;
  expect?: Expectation;
  timeout_seconds?: number;
}

export interface ShellStep extends BaseStep {
  kind: "shell";
  script: string;
}

export interface MoonStep extends BaseStep {
  kind: "moon";
  argv: ["moon" | "moonrun", ...string[]];
}

export interface DocumentedShellStep extends BaseStep {
  kind: "documented-shell";
  script: string;
}

export type Step = ShellStep | MoonStep | DocumentedShellStep;

export interface RunEntry {
  id: string;
  fixture: "template" | "empty";
  network?: boolean;
  steps: Step[];
}

export interface DocumentedOnlyEntry {
  id: string;
  documented_only: true;
  commands: string[];
  reason: string;
}

export type ManifestEntry = RunEntry | DocumentedOnlyEntry;

export interface Manifest {
  schema_version: 2;
  entries: ManifestEntry[];
}

export interface DocumentedCommand {
  file: string;
  line: number;
  source: string;
  key: string;
}

export interface ProcessResult {
  exit: number | null;
  output: string;
  error?: string;
  signal?: NodeJS.Signals;
  timed_out?: boolean;
}

interface ExecuteOptions {
  cwd: string;
  timeoutMs: number;
}

export type StepExecutor = (step: Step, options: ExecuteOptions) => Promise<ProcessResult>;

interface VerifyOptions {
  repoRoot?: string;
  template?: string;
  verbose?: boolean;
  skipNetwork?: boolean;
  executor?: StepExecutor;
}

interface CliOptions {
  coverageOnly: boolean;
  skipNetwork: boolean;
  verbose: boolean;
}

interface PreservedVariable {
  variable: string;
}

type ShellToken = string | Comment | ControlOperator | GlobPattern | PreservedVariable;

function fail(message: string): never {
  throw new Error(message);
}

function asRecord(value: unknown, context: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${context} must be an object`);
  }
  return value as JsonRecord;
}

function assertOnlyKeys(value: JsonRecord, allowed: readonly string[], context: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    fail(`${context} has unknown field(s): ${unknown.join(", ")}`);
  }
}

function requiredString(value: JsonRecord, key: string, context: string): string {
  const item = value[key];
  if (typeof item !== "string" || item.length === 0) {
    fail(`${context}.${key} must be a non-empty string`);
  }
  return item;
}

function optionalString(value: JsonRecord, key: string, context: string): string | undefined {
  const item = value[key];
  if (item === undefined) return undefined;
  if (typeof item !== "string" || item.length === 0) {
    fail(`${context}.${key} must be a non-empty string`);
  }
  return item;
}

function stringArray(
  value: unknown,
  context: string,
  options: { nonEmpty?: boolean } = {},
): string[] {
  if (!Array.isArray(value)) fail(`${context} must be an array`);
  if (options.nonEmpty && value.length === 0) {
    fail(`${context} must not be empty`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || item.length === 0) {
      fail(`${context}[${index}] must be a non-empty string`);
    }
    return item;
  });
}

function optionalPositiveNumber(
  value: JsonRecord,
  key: string,
  context: string,
): number | undefined {
  const item = value[key];
  if (item === undefined) return undefined;
  if (typeof item !== "number" || !Number.isFinite(item) || item <= 0) {
    fail(`${context}.${key} must be a positive number`);
  }
  return item;
}

function parseExpectation(value: unknown, context: string): Expectation {
  const record = asRecord(value, context);
  assertOnlyKeys(record, ["exit", "output_contains", "paths_exist", "paths_absent"], context);

  const exit = record.exit;
  if (exit !== undefined && (typeof exit !== "number" || !Number.isInteger(exit) || exit < 0)) {
    fail(`${context}.exit must be a non-negative integer`);
  }

  return {
    ...(exit === undefined ? {} : { exit }),
    ...(record.output_contains === undefined
      ? {}
      : {
          output_contains: stringArray(record.output_contains, `${context}.output_contains`),
        }),
    ...(record.paths_exist === undefined
      ? {}
      : {
          paths_exist: stringArray(record.paths_exist, `${context}.paths_exist`),
        }),
    ...(record.paths_absent === undefined
      ? {}
      : {
          paths_absent: stringArray(record.paths_absent, `${context}.paths_absent`),
        }),
  };
}

function parseBaseStep(
  record: JsonRecord,
  context: string,
): Pick<BaseStep, "cwd" | "expect" | "timeout_seconds"> {
  const cwd = optionalString(record, "cwd", context);
  const timeoutSeconds = optionalPositiveNumber(record, "timeout_seconds", context);
  const expectation =
    record.expect === undefined ? undefined : parseExpectation(record.expect, `${context}.expect`);

  return {
    ...(cwd === undefined ? {} : { cwd }),
    ...(expectation === undefined ? {} : { expect: expectation }),
    ...(timeoutSeconds === undefined ? {} : { timeout_seconds: timeoutSeconds }),
  };
}

function parseStep(value: unknown, context: string): Step {
  const record = asRecord(value, context);
  const kind = record.kind;
  if (kind !== "shell" && kind !== "moon" && kind !== "documented-shell") {
    fail(`${context}.kind must be "shell", "moon", or "documented-shell"`);
  }

  const base = parseBaseStep(record, context);
  if (kind === "moon") {
    assertOnlyKeys(record, ["kind", "argv", "cwd", "expect", "timeout_seconds"], context);
    const argv = stringArray(record.argv, `${context}.argv`, {
      nonEmpty: true,
    });
    if (argv[0] !== "moon" && argv[0] !== "moonrun") {
      fail(`${context}.argv[0] must be "moon" or "moonrun"`);
    }
    return {
      kind,
      argv: argv as ["moon" | "moonrun", ...string[]],
      ...base,
    };
  }

  assertOnlyKeys(record, ["kind", "script", "cwd", "expect", "timeout_seconds"], context);
  const script = requiredString(record, "script", context);
  if (kind === "shell" && shellScriptContainsMoonCommand(script)) {
    fail(
      `${context}.script contains a moon or moonrun command; use kind "moon" or "documented-shell"`,
    );
  }
  if (kind === "documented-shell") {
    if (script.includes("\n")) {
      fail(`${context}.script must be one physical command line`);
    }
    const parsed = parseShellTokens(script);
    if (!containsMoonCommand(parsed)) {
      fail(`${context}.script must contain a moon or moonrun command`);
    }
  }
  return { kind, script, ...base };
}

function parseEntry(value: unknown, index: number): ManifestEntry {
  const context = `manifest.entries[${index}]`;
  const record = asRecord(value, context);
  const id = requiredString(record, "id", context);

  if (record.documented_only === true) {
    assertOnlyKeys(record, ["id", "documented_only", "commands", "reason"], context);
    const commands = stringArray(record.commands, `${context}.commands`, {
      nonEmpty: true,
    });
    const reason = requiredString(record, "reason", context);
    for (const [commandIndex, command] of commands.entries()) {
      if (command.includes("\n")) {
        fail(`${context}.commands[${commandIndex}] must be one line`);
      }
      const tokens = parseShellTokens(command);
      if (!containsMoonCommand(tokens)) {
        fail(`${context}.commands[${commandIndex}] must contain moon or moonrun`);
      }
    }
    return { id, documented_only: true, commands, reason };
  }

  assertOnlyKeys(record, ["id", "fixture", "network", "steps"], context);
  const fixture = record.fixture;
  if (fixture !== "template" && fixture !== "empty") {
    fail(`${context}.fixture must be "template" or "empty"`);
  }
  if (record.network !== undefined && typeof record.network !== "boolean") {
    fail(`${context}.network must be a boolean`);
  }
  if (!Array.isArray(record.steps) || record.steps.length === 0) {
    fail(`${context}.steps must be a non-empty array`);
  }
  const steps = record.steps.map((step, stepIndex) =>
    parseStep(step, `${context}.steps[${stepIndex}]`),
  );
  return {
    id,
    fixture,
    ...(record.network === true ? { network: true } : {}),
    steps,
  };
}

export function parseManifest(value: unknown): Manifest {
  const record = asRecord(value, "manifest");
  assertOnlyKeys(record, ["schema_version", "entries"], "manifest");
  if (record.schema_version !== 2) {
    fail("manifest.schema_version must be 2");
  }
  if (!Array.isArray(record.entries)) {
    fail("manifest.entries must be an array");
  }
  const entries = record.entries.map(parseEntry);
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) fail(`duplicate manifest entry id: ${entry.id}`);
    seen.add(entry.id);
  }
  return { schema_version: 2, entries };
}

export async function loadManifest(path = DEFAULT_MANIFEST): Promise<Manifest> {
  const source = await readFile(path, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    fail(
      `${relative(REPO_ROOT, path)} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseManifest(value);
}

function isComment(token: ShellToken): token is Comment {
  return typeof token === "object" && token !== null && "comment" in token;
}

function isControlOperator(token: ShellToken): token is ControlOperator {
  return typeof token === "object" && token !== null && "op" in token && token.op !== "glob";
}

function parseShellTokens(source: string): ShellToken[] {
  try {
    return parseShell<PreservedVariable>(source, (name) => ({
      variable: name,
    })) as ShellToken[];
  } catch (error) {
    fail(
      `cannot parse shell command ${JSON.stringify(source)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

const COMMAND_BOUNDARY_OPERATORS = new Set(["|", "|&", "||", "&&", ";", ";;", "&", "("]);

function containsMoonCommand(tokens: readonly ShellToken[]): boolean {
  let commandStart = true;
  for (const token of tokens) {
    if (isComment(token)) break;
    if (typeof token === "string") {
      if (commandStart && (token === "moon" || token === "moonrun")) {
        return true;
      }
      if (commandStart && /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
        continue;
      }
      commandStart = false;
      continue;
    }
    if (isControlOperator(token) && COMMAND_BOUNDARY_OPERATORS.has(token.op)) {
      commandStart = true;
    }
  }
  return false;
}

function shellScriptContainsMoonCommand(script: string): boolean {
  let heredocEnd: string | undefined;
  for (const rawLine of script.split(/\r?\n/)) {
    if (heredocEnd !== undefined) {
      if (rawLine.trim() === heredocEnd) heredocEnd = undefined;
      continue;
    }

    if (containsMoonCommand(parseShellTokens(rawLine))) return true;
    const heredoc = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(rawLine);
    if (heredoc) heredocEnd = heredoc[2];
  }
  return false;
}

export function canonicalShellCommand(source: string): string {
  const tokens = parseShellTokens(source).filter((token) => !isComment(token));
  return JSON.stringify(tokens);
}

export function canonicalArgv(argv: readonly string[]): string {
  return JSON.stringify(argv);
}

function shellFenceFiles(skillRoot: string): string[] {
  return [join(skillRoot, "SKILL.md")];
}

export async function collectDocumentedCommands(
  skillRoot = DEFAULT_SKILL,
  repoRoot = REPO_ROOT,
): Promise<DocumentedCommand[]> {
  const files = shellFenceFiles(skillRoot);
  const references = join(skillRoot, "references");
  try {
    const { readdir } = await import("node:fs/promises");
    const names = (await readdir(references)).filter((name) => name.endsWith(".md")).sort();
    files.push(...names.map((name) => join(references, name)));
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
  }

  const commands: DocumentedCommand[] = [];
  const fencePattern = /```(?:sh|bash|shell)\r?\n([\s\S]*?)```/g;
  for (const path of files) {
    try {
      await access(path);
    } catch (error) {
      if (isMissingPathError(error)) continue;
      throw error;
    }
    const source = await readFile(path, "utf8");
    for (const match of source.matchAll(fencePattern)) {
      const block = match[1] ?? "";
      const blockStart = (match.index ?? 0) + match[0].indexOf(block);
      const firstLine = source.slice(0, blockStart).split(/\r?\n/).length;
      for (const [lineOffset, raw] of block.split(/\r?\n/).entries()) {
        let line = raw.trim();
        if (line.startsWith("$ ")) line = line.slice(2);
        if (line.length === 0 || line.startsWith("#")) continue;
        const tokens = parseShellTokens(line);
        if (!containsMoonCommand(tokens)) continue;
        commands.push({
          file: relative(repoRoot, path),
          line: firstLine + lineOffset,
          source: line,
          key: canonicalShellCommand(line),
        });
      }
    }
  }
  return commands;
}

function isDocumentedOnly(entry: ManifestEntry): entry is DocumentedOnlyEntry {
  return "documented_only" in entry;
}

export function collectCoveredCommands(manifest: Manifest): Map<string, string[]> {
  const covered = new Map<string, string[]>();
  const add = (key: string, id: string): void => {
    const owners = covered.get(key) ?? [];
    owners.push(id);
    covered.set(key, owners);
  };

  for (const entry of manifest.entries) {
    if (isDocumentedOnly(entry)) {
      for (const command of entry.commands) {
        add(canonicalShellCommand(command), entry.id);
      }
      continue;
    }
    for (const step of entry.steps) {
      if (step.kind === "moon") {
        add(canonicalArgv(step.argv), entry.id);
      } else if (step.kind === "documented-shell") {
        add(canonicalShellCommand(step.script), entry.id);
      }
    }
  }
  return covered;
}

export function coverageProblems(
  documented: readonly DocumentedCommand[],
  covered: ReadonlyMap<string, readonly string[]>,
): string[] {
  return documented
    .filter((command) => !covered.has(command.key))
    .map(
      (command) =>
        `${command.file}:${command.line}: ${JSON.stringify(command.source)} not covered by an exact manifest command`,
    );
}

export async function verifyCoverage(
  manifest: Manifest,
  options: { repoRoot?: string; skillRoot?: string } = {},
): Promise<{ documented: DocumentedCommand[]; problems: string[] }> {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const documented = await collectDocumentedCommands(
    options.skillRoot ?? join(repoRoot, "skills", "moonbit-toolchain"),
    repoRoot,
  );
  const covered = collectCoveredCommands(manifest);
  return { documented, problems: coverageProblems(documented, covered) };
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function safePath(root: string, path: string, context: string): string {
  if (isAbsolute(path)) fail(`${context} must be relative to the fixture root`);
  const resolved = resolve(root, path);
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) {
    fail(`${context} escapes the fixture root: ${path}`);
  }
  return resolved;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}

function stepLabel(step: Step): string {
  return step.kind === "moon" ? step.argv.join(" ") : step.script;
}

export const executeStep: StepExecutor = async (
  step,
  { cwd, timeoutMs },
): Promise<ProcessResult> => {
  const command = step.kind === "moon" ? step.argv[0] : "bash";
  const args = step.kind === "moon" ? step.argv.slice(1) : ["-o", "pipefail", "-c", step.script];

  return await new Promise<ProcessResult>((resolveResult) => {
    let output = "";
    let settled = false;
    let timedOut = false;
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      output += chunk;
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveResult({ exit: null, output, error: error.message, timed_out: timedOut });
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveResult({
        exit: code,
        output,
        ...(signal === null ? {} : { signal }),
        ...(timedOut ? { timed_out: true } : {}),
      });
    });
  });
};

function outputPreview(output: string): string {
  return output.length <= OUTPUT_PREVIEW_LENGTH
    ? output
    : `${output.slice(0, OUTPUT_PREVIEW_LENGTH)}…`;
}

async function expectationProblems(
  entry: RunEntry,
  step: Step,
  stepIndex: number,
  fixtureRoot: string,
  result: ProcessResult,
): Promise<string[]> {
  const prefix = `${entry.id}: step ${stepIndex + 1} (${stepLabel(step)})`;
  const expectation = step.expect ?? {};
  const expectedExit = expectation.exit ?? 0;
  const problems: string[] = [];

  if (result.timed_out) {
    problems.push(`${prefix}: timed out`);
  } else if (result.error !== undefined) {
    problems.push(`${prefix}: could not start: ${result.error}`);
  } else if (result.exit !== expectedExit) {
    const actual =
      result.exit === null ? `signal ${result.signal ?? "unknown"}` : `exit ${result.exit}`;
    problems.push(
      `${prefix}: ${actual}, expected exit ${expectedExit}:\n${outputPreview(result.output)}`,
    );
  }
  if (problems.length > 0) return problems;

  for (const needle of expectation.output_contains ?? []) {
    if (!result.output.includes(needle)) {
      problems.push(
        `${prefix}: output missing ${JSON.stringify(needle)}:\n${outputPreview(result.output)}`,
      );
    }
  }
  for (const path of expectation.paths_exist ?? []) {
    if (!(await pathExists(safePath(fixtureRoot, path, `${prefix} path`)))) {
      problems.push(`${prefix}: expected path ${path} is missing`);
    }
  }
  for (const path of expectation.paths_absent ?? []) {
    if (await pathExists(safePath(fixtureRoot, path, `${prefix} path`))) {
      problems.push(`${prefix}: expected path ${path} to be absent`);
    }
  }
  return problems;
}

export async function runEntry(entry: RunEntry, options: VerifyOptions = {}): Promise<string[]> {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const template = options.template ?? join(repoRoot, "verification", "commands", "template");
  const tempRoot = await mkdtemp(join(tmpdir(), "mbtcmd-"));
  const fixtureRoot = join(tempRoot, "work");
  const problems: string[] = [];

  try {
    if (entry.fixture === "template") {
      await cp(template, fixtureRoot, { recursive: true });
    } else {
      await mkdir(fixtureRoot);
    }

    for (const [stepIndex, step] of entry.steps.entries()) {
      const cwd = safePath(fixtureRoot, step.cwd ?? ".", `${entry.id}: step ${stepIndex + 1} cwd`);
      const result = await (options.executor ?? executeStep)(step, {
        cwd,
        timeoutMs: (step.timeout_seconds ?? DEFAULT_TIMEOUT_MS / 1000) * 1000,
      });
      const stepProblems = await expectationProblems(entry, step, stepIndex, fixtureRoot, result);
      problems.push(...stepProblems);
      if (stepProblems.length > 0) break;
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  if (options.verbose && problems.length === 0) {
    console.log(`  ok: ${entry.id}`);
  }
  return problems;
}

export async function runManifest(
  manifest: Manifest,
  options: VerifyOptions = {},
): Promise<string[]> {
  const problems: string[] = [];
  for (const entry of manifest.entries) {
    if (isDocumentedOnly(entry)) continue;
    if (entry.network && options.skipNetwork) continue;
    problems.push(...(await runEntry(entry, options)));
  }
  return problems;
}

function parseCliOptions(args: readonly string[]): CliOptions {
  const options: CliOptions = {
    coverageOnly: false,
    skipNetwork: false,
    verbose: false,
  };
  for (const arg of args) {
    if (arg === "--") continue;
    if (arg === "--coverage-only") options.coverageOnly = true;
    else if (arg === "--skip-network") options.skipNetwork = true;
    else if (arg === "-v" || arg === "--verbose") options.verbose = true;
    else fail(`unknown argument: ${arg}`);
  }
  return options;
}

export async function runCli(args = process.argv.slice(2)): Promise<number> {
  try {
    const options = parseCliOptions(args);
    const manifest = await loadManifest();
    const coverage = await verifyCoverage(manifest);
    const problems = [...coverage.problems];
    if (!options.coverageOnly && problems.length === 0) {
      problems.push(
        ...(await runManifest(manifest, {
          repoRoot: REPO_ROOT,
          template: DEFAULT_TEMPLATE,
          skipNetwork: options.skipNetwork,
          verbose: options.verbose,
        })),
      );
    }

    for (const problem of problems) {
      console.error(`FAIL ${problem}`);
    }
    if (problems.length > 0) return 1;

    if (options.coverageOnly) {
      console.log(
        `command coverage: ${coverage.documented.length} documented command lines exactly covered`,
      );
    } else {
      console.log(
        `command verification: ${manifest.entries.length} manifest entries OK; ${coverage.documented.length} documented command lines exactly covered`,
      );
    }
    return 0;
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  process.exitCode = await runCli();
}

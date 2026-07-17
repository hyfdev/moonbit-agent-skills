#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, cp, mkdtemp, mkdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseShell } from "shell-quote";
import type { Comment, ControlOperator, GlobPattern } from "shell-quote";
import { exitWith, isMain, parseCliArgs } from "./lib/cli.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MANIFEST = join(REPO_ROOT, "verification", "commands", "manifest.json");
const DEFAULT_TEMPLATE = join(REPO_ROOT, "verification", "commands", "template");
const DEFAULT_SKILL = join(REPO_ROOT, "skills", "moonbit-toolchain");
const DEFAULT_TIMEOUT_MS = 300_000;
const OUTPUT_PREVIEW_LENGTH = 600;
const CLI_USAGE =
  "usage: node tooling/verify_commands.ts [--coverage-only] [--skip-network] [-v|--verbose]";

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
    assertMoonLiteralPathsStayInFixture(argv.slice(1), `${context}.argv`);
    return {
      kind,
      argv: argv as ["moon" | "moonrun", ...string[]],
      ...base,
    };
  }

  assertOnlyKeys(record, ["kind", "script", "cwd", "expect", "timeout_seconds"], context);
  const script = requiredString(record, "script", context);
  if (kind === "shell") validateSetupShell(script, context);
  else validateDocumentedShellStep(script, base.expect, context);
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
      validateDocumentedShell(command, `${context}.commands[${commandIndex}]`);
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

function isControlOperator(token: ShellToken | undefined): token is ControlOperator {
  return (
    token !== undefined &&
    typeof token === "object" &&
    token !== null &&
    "op" in token &&
    token.op !== "glob"
  );
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

const ALLOWED_DOCUMENTED_OPERATORS = new Set<ControlOperator["op"]>(["|", "&&"]);
const SETUP_SEQUENCE_OPERATORS = new Set<ControlOperator["op"]>([
  "|",
  "|&",
  "||",
  "&&",
  ";",
  ";;",
  "&",
  "(",
  ")",
]);
const SETUP_REDIRECTION_OPERATORS = new Set<ControlOperator["op"]>(["<", ">", ">>"]);
const ALLOWED_SETUP_EXECUTABLES = new Set(["cat", "grep", "mkdir", "printf", "test", "touch"]);
const ALLOWED_DOCUMENTED_AUXILIARIES = new Set([
  "cat",
  "cd",
  "echo",
  "false",
  "grep",
  "mkdir",
  "printf",
  "test",
  "true",
]);
const SHELL_CONTROL_WORDS = new Set([
  "!",
  "case",
  "do",
  "done",
  "elif",
  "else",
  "esac",
  "fi",
  "for",
  "function",
  "if",
  "in",
  "select",
  "then",
  "until",
  "while",
  "{",
  "}",
]);
const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const WINDOWS_ABSOLUTE_PATH_RE = /^(?:[A-Za-z]:[\\/]|\\\\)/;
const BRACE_EXPANSION_RE = /\{[^{}]*(?:,|\.\.)[^{}]*\}/;
const MOON_COMMAND_FRAGMENT_RE =
  /(?:^|[\s`"';&|()])(?:[^\s`"';&|()]*[\\/])?(?:moon|moonrun)(?=$|[\s`"';&|()])/;

function executableName(word: string): string {
  return word.split(/[\\/]/).at(-1) ?? word;
}

function isMoonExecutable(word: string): boolean {
  const name = executableName(word);
  return name === "moon" || name === "moonrun";
}

function stringContainsPotentialMoonCommand(word: string): boolean {
  return isMoonExecutable(word) || MOON_COMMAND_FRAGMENT_RE.test(word);
}

function tokensContainPotentialMoonCommand(tokens: readonly ShellToken[]): boolean {
  return tokens.some(
    (token) => typeof token === "string" && stringContainsPotentialMoonCommand(token),
  );
}

function normalizeLineContinuations(source: string): string {
  return source.replace(/\\\r?\n/g, "");
}

interface HeredocState {
  delimiter: string;
  stripTabs: boolean;
}

function commandLinesOutsideHeredocs(script: string, context: string): string[] {
  const commands: string[] = [];
  let heredoc: HeredocState | undefined;
  for (const rawLine of script.split(/\r?\n/)) {
    if (heredoc !== undefined) {
      const candidate = heredoc.stripTabs ? rawLine.replace(/^\t+/, "") : rawLine;
      if (candidate === heredoc.delimiter) heredoc = undefined;
      continue;
    }
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    commands.push(line);
    const heredocs = [
      ...line.matchAll(/<<(-?)\s*(?:(['"])([A-Za-z_][A-Za-z0-9_]*)\2|([A-Za-z_][A-Za-z0-9_]*))/g),
    ];
    if (heredocs.length > 1) fail(`${context}.script may contain only one heredoc`);
    const match = heredocs[0];
    if (match !== undefined) {
      const delimiter = match[3] ?? match[4] ?? "";
      if (match[2] === undefined) {
        fail(
          `${context}.script heredoc delimiter ${delimiter} must be quoted to disable expansion`,
        );
      }
      heredoc = { delimiter, stripTabs: match[1] === "-" };
    }
  }
  if (heredoc !== undefined) {
    fail(`${context}.script has an unterminated heredoc ${heredoc.delimiter}`);
  }
  return commands;
}

function isAbsoluteLiteral(path: string): boolean {
  return isAbsolute(path) || WINDOWS_ABSOLUTE_PATH_RE.test(path);
}

function literalPathProblem(word: string): string | undefined {
  const candidates = [word];
  const equals = word.indexOf("=");
  if (equals >= 0) candidates.push(word.slice(equals + 1));
  for (const candidate of candidates) {
    if (candidate.startsWith("~")) return "uses home-directory expansion";
    if (isAbsoluteLiteral(candidate)) return "uses an absolute path";
    if (candidate.split(/[\\/]/).includes("..")) return "uses parent-directory traversal";
  }
  return undefined;
}

function assertLiteralPathsStayInFixture(
  words: readonly string[],
  context: string,
  ignoredIndexes: ReadonlySet<number> = new Set(),
): void {
  for (const [index, word] of words.entries()) {
    if (ignoredIndexes.has(index)) continue;
    const problem = literalPathProblem(word);
    if (problem !== undefined) fail(`${context}[${index}] ${problem}: ${word}`);
  }
}

const MOON_SEPARATE_PATH_OPTIONS = new Set(["-C", "--target-dir"]);

function assertMoonLiteralPathsStayInFixture(args: readonly string[], context: string): void {
  assertLiteralPathsStayInFixture(args, context);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? "";
    let path: string | undefined;
    if (MOON_SEPARATE_PATH_OPTIONS.has(argument)) {
      path = args[index + 1];
      if (path === undefined || path.startsWith("-")) {
        fail(`${context}[${index}] option ${argument} requires a path`);
      }
      index += 1;
    } else if (argument.startsWith("-C") && argument.length > 2) {
      path = argument.slice(2);
    } else if (argument.startsWith("--target-dir=")) {
      path = argument.slice("--target-dir=".length);
      if (path.length === 0) {
        fail(`${context}[${index}] option --target-dir requires a path`);
      }
    }
    if (path !== undefined) {
      const problem = literalPathProblem(path);
      if (problem !== undefined) {
        fail(`${context}[${index}] ${problem}: ${argument}`);
      }
    }
  }
}

function assertNoShellBraceExpansion(
  words: readonly string[],
  context: string,
  ignoredIndexes: ReadonlySet<number> = new Set(),
): void {
  for (const [index, word] of words.entries()) {
    if (!ignoredIndexes.has(index) && BRACE_EXPANSION_RE.test(word)) {
      fail(`${context}[${index}] uses brace expansion: ${word}`);
    }
  }
}

function validateSetupShell(script: string, context: string): void {
  const commands = commandLinesOutsideHeredocs(script, context);
  if (commands.some((command) => tokensContainPotentialMoonCommand(parseShellTokens(command)))) {
    fail(
      `${context}.script contains a possible moon or moonrun command; use kind "moon" or "documented-shell"`,
    );
  }
  if (commands.length !== 1) {
    fail(`${context}.script must contain one setup command; split multiple commands into steps`);
  }
  const tokens = parseShellTokens(commands[0] ?? "");
  for (const token of tokens) {
    if (typeof token === "string") {
      if (token.includes("`")) fail(`${context}.script does not allow command substitution`);
      continue;
    }
    if (isComment(token)) continue;
    if (!isControlOperator(token)) {
      fail(`${context}.script does not allow variables, globbing, or dynamic expansion`);
    }
    if (SETUP_SEQUENCE_OPERATORS.has(token.op)) {
      fail(`${context}.script uses ${token.op}; split compound setup commands into steps`);
    }
    if (!SETUP_REDIRECTION_OPERATORS.has(token.op)) {
      fail(`${context}.script uses unsupported shell syntax ${token.op}`);
    }
  }
  const executable = tokens.find((token): token is string => typeof token === "string");
  if (executable === undefined) fail(`${context}.script must execute a setup command`);
  if (executable !== executableName(executable) || !ALLOWED_SETUP_EXECUTABLES.has(executable)) {
    fail(
      `${context}.script setup executable ${executable} is not allowed; extend the restricted grammar with tests if needed`,
    );
  }
  const words = tokens.filter((token): token is string => typeof token === "string");
  const executableIndexes = new Set([0]);
  assertNoShellBraceExpansion(words, `${context}.script word`, executableIndexes);
  assertLiteralPathsStayInFixture(words, `${context}.script word`, executableIndexes);
}

function assertDocumentedPhysicalLines(source: string, context: string): void {
  const lines = source.split(/\r?\n/);
  if (lines.some((line) => line.trim().length === 0)) {
    fail(`${context} may not contain blank physical lines`);
  }
  for (const [index, rawLine] of lines.entries()) {
    const hasBackslash = /\\\s*$/.test(rawLine);
    const line = hasBackslash ? rawLine.replace(/\\\s*$/, "") : rawLine;
    const tokens = parseShellTokens(line);
    const last = tokens.at(-1);
    const continuation = isControlOperator(last) ? last.op : undefined;
    if (index < lines.length - 1) {
      if (continuation !== "|" && continuation !== "&&") {
        fail(`${context} may continue lines only after | or &&`);
      }
    } else if (hasBackslash || continuation === "|" || continuation === "&&") {
      fail(`${context} ends with an incomplete shell continuation`);
    }
  }
}

function skipEnvPrefix(words: readonly string[], start: number, context: string): number {
  let index = start;
  while (index < words.length) {
    const word = words[index] ?? "";
    if (word === "--") return index + 1;
    if (ASSIGNMENT_RE.test(word)) {
      index += 1;
      continue;
    }
    if (word === "-S" || word === "--split-string" || word.startsWith("--split-string=")) {
      fail(`${context} does not allow env --split-string`);
    }
    if (word === "-i" || word === "--ignore-environment") {
      index += 1;
      continue;
    }
    if (["-u", "--unset"].includes(word)) {
      if (index + 1 >= words.length) fail(`${context} has an incomplete env option ${word}`);
      index += 2;
      continue;
    }
    if (word.startsWith("--unset=") && word.length > "--unset=".length) {
      index += 1;
      continue;
    }
    if (word.startsWith("-")) {
      fail(`${context} does not allow env option ${word}`);
    }
    return index;
  }
  return index;
}

interface EffectiveCommand {
  executable?: string;
  executableIndex?: number;
  wrapperIndexes: Set<number>;
}

function assertKnownExecutablePath(word: string, name: string, context: string): void {
  if (word === name || (isAbsoluteLiteral(word) && executableName(word) === name)) return;
  fail(`${context} does not allow relative wrapper executable path ${word}`);
}

function effectiveExecutable(words: readonly string[], context: string): EffectiveCommand {
  let index = 0;
  while (index < words.length && ASSIGNMENT_RE.test(words[index] ?? "")) index += 1;
  const wrapperIndexes = new Set<number>();

  for (let wrappers = 0; wrappers <= words.length; wrappers += 1) {
    const word = words[index];
    if (word === undefined) return { wrapperIndexes };
    const name = executableName(word);
    if (SHELL_CONTROL_WORDS.has(name)) {
      fail(`${context} does not allow shell control flow (${name})`);
    }
    if (name === "env") {
      assertKnownExecutablePath(word, name, context);
      wrapperIndexes.add(index);
      index = skipEnvPrefix(words, index + 1, context);
      continue;
    }
    if (name === "command") {
      assertKnownExecutablePath(word, name, context);
      wrapperIndexes.add(index);
      index += 1;
      while (words[index]?.startsWith("-")) {
        const option = words[index] ?? "";
        if (option === "--") {
          index += 1;
          break;
        }
        if (/^-[p]*[vV][pvV]*$/.test(option)) return { wrapperIndexes };
        if (option !== "-p") fail(`${context} does not allow command option ${option}`);
        index += 1;
      }
      continue;
    }
    if (name === "time") {
      assertKnownExecutablePath(word, name, context);
      wrapperIndexes.add(index);
      index += 1;
      while (words[index]?.startsWith("-")) {
        const option = words[index] ?? "";
        if (option === "--") {
          index += 1;
          break;
        }
        if (option !== "-p") fail(`${context} does not allow time option ${option}`);
        index += 1;
      }
      continue;
    }
    return { executable: word, executableIndex: index, wrapperIndexes };
  }
  fail(`${context} has too many nested command wrappers`);
}

function analyzeDocumentedShell(source: string, context: string): boolean {
  assertDocumentedPhysicalLines(source, context);
  const normalized = normalizeLineContinuations(source);
  if (/`|\$\(|<[()]|>[()]/.test(normalized)) {
    fail(`${context} does not allow command or process substitution`);
  }
  const tokens = parseShellTokens(normalized);
  const segments: string[][] = [];
  let segment: string[] = [];
  for (const token of tokens) {
    if (typeof token === "string") {
      segment.push(token);
      continue;
    }
    if (isComment(token)) fail(`${context} does not allow shell comments`);
    if (!isControlOperator(token) || !ALLOWED_DOCUMENTED_OPERATORS.has(token.op)) {
      const syntax = isControlOperator(token) ? token.op : "dynamic expansion";
      fail(`${context} uses unsupported shell syntax ${syntax}; only | and && are allowed`);
    }
    if (segment.length === 0) fail(`${context} has an empty command before ${token.op}`);
    segments.push(segment);
    segment = [];
  }
  if (segment.length === 0) fail(`${context} ends without a command`);
  segments.push(segment);

  let executesMoon = false;
  for (const [index, words] of segments.entries()) {
    const commandContext = `${context} command ${index + 1}`;
    const effective = effectiveExecutable(words, commandContext);
    const ignoredIndexes = new Set(effective.wrapperIndexes);
    if (effective.executableIndex !== undefined) ignoredIndexes.add(effective.executableIndex);
    assertNoShellBraceExpansion(words, `${commandContext} word`, ignoredIndexes);
    assertLiteralPathsStayInFixture(words, `${commandContext} word`, ignoredIndexes);

    const executable = effective.executable;
    if (executable === undefined) continue;
    const name = executableName(executable);
    if (isMoonExecutable(executable)) {
      assertKnownExecutablePath(executable, name, commandContext);
      assertMoonLiteralPathsStayInFixture(
        words.slice((effective.executableIndex ?? -1) + 1),
        `${commandContext} Moon argument`,
      );
      executesMoon = true;
      continue;
    }
    if (executable !== name || !ALLOWED_DOCUMENTED_AUXILIARIES.has(name)) {
      fail(
        `${commandContext} executable ${executable} is not allowed by the restricted documented-shell grammar`,
      );
    }
  }
  return executesMoon;
}

function validateDocumentedShell(source: string, context: string): void {
  if (!analyzeDocumentedShell(source, context)) {
    fail(`${context} must execute a moon or moonrun command`);
  }
}

function validateDocumentedShellStep(
  source: string,
  expectation: Expectation | undefined,
  context: string,
): void {
  validateDocumentedShell(source, context);
  if ((expectation?.exit ?? 0) !== 0) {
    fail(`${context}.expect.exit must be 0 for documented-shell so success proves Moon ran`);
  }
}

export function canonicalShellCommand(source: string): string {
  const tokens = parseShellTokens(normalizeLineContinuations(source)).filter(
    (token) => !isComment(token),
  );
  return JSON.stringify(tokens);
}

export function canonicalArgv(argv: readonly string[]): string {
  return JSON.stringify(argv);
}

function shellFenceFiles(skillRoot: string): string[] {
  return [join(skillRoot, "SKILL.md")];
}

interface LogicalFenceCommand {
  lineOffset: number;
  source: string;
}

function stripPrompt(line: string): string {
  const trimmed = line.trim();
  return trimmed.startsWith("$ ") ? trimmed.slice(2) : trimmed;
}

function lineContinuesCommand(line: string): boolean {
  const withoutBackslash = line.replace(/\\\s*$/, "");
  if (withoutBackslash !== line) return true;
  const last = parseShellTokens(withoutBackslash).at(-1);
  return isControlOperator(last) && ["|", "&&", "||"].includes(last.op);
}

function logicalFenceCommands(block: string, context: string): LogicalFenceCommand[] {
  const commands: LogicalFenceCommand[] = [];
  let pending: string[] = [];
  let pendingLine = 0;
  for (const [lineOffset, rawLine] of block.split(/\r?\n/).entries()) {
    const line = stripPrompt(rawLine);
    if (line.length === 0 || line.startsWith("#")) {
      if (pending.length > 0) fail(`${context}:${pendingLine} has an incomplete continuation`);
      continue;
    }
    if (pending.length === 0) pendingLine = lineOffset;
    pending.push(line);
    if (lineContinuesCommand(line)) continue;
    commands.push({ lineOffset: pendingLine, source: pending.join("\n") });
    pending = [];
  }
  if (pending.length > 0) fail(`${context}:${pendingLine} has an incomplete continuation`);
  return commands;
}

function assertFenceCannotHideMoon(block: string, context: string): void {
  const visibleLines = block
    .split(/\r?\n/)
    .map(stripPrompt)
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  const tokens = parseShellTokens(normalizeLineContinuations(visibleLines.join("\n")));
  if (!tokensContainPotentialMoonCommand(tokens)) return;

  for (const line of visibleLines) {
    const first = parseShellTokens(line.replace(/\\\s*$/, "")).find(
      (token): token is string => typeof token === "string",
    );
    if (first !== undefined && SHELL_CONTROL_WORDS.has(executableName(first))) {
      fail(`${context} uses unsupported shell control flow ${first} around a Moon command`);
    }
  }
  for (const token of tokens) {
    if (isControlOperator(token) && ["|&", "||", ";", ";;", "&", "(", ")"].includes(token.op)) {
      fail(`${context} uses unsupported shell operator ${token.op} around a Moon command`);
    }
  }
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
      const file = relative(repoRoot, path);
      assertFenceCannotHideMoon(block, `${file}:${firstLine}`);
      for (const command of logicalFenceCommands(block, file)) {
        if (!analyzeDocumentedShell(command.source, `${file}:${firstLine + command.lineOffset}`)) {
          continue;
        }
        commands.push({
          file,
          line: firstLine + command.lineOffset,
          source: command.source,
          key: canonicalShellCommand(command.source),
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
        validateDocumentedShell(command, `${entry.id} documented-only command`);
        add(canonicalShellCommand(command), entry.id);
      }
      continue;
    }
    for (const step of entry.steps) {
      if (step.kind === "moon") {
        add(canonicalArgv(step.argv), entry.id);
      } else if (step.kind === "documented-shell") {
        validateDocumentedShellStep(step.script, step.expect, `${entry.id} documented-shell step`);
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

function pathIsWithin(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

async function assertResolvedPathStaysInFixture(
  root: string,
  path: string,
  context: string,
): Promise<string> {
  const resolved = safePath(root, path, context);
  const realRoot = await realpath(root);
  let existing = resolved;
  for (;;) {
    try {
      const realExisting = await realpath(existing);
      if (!pathIsWithin(realRoot, realExisting)) {
        fail(`${context} escapes the fixture root through a symlink: ${path}`);
      }
      return resolved;
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      const parent = dirname(existing);
      if (parent === existing) throw error;
      existing = parent;
    }
  }
}

async function safeCwd(root: string, path: string, context: string): Promise<string> {
  const resolved = await assertResolvedPathStaysInFixture(root, path, context);
  try {
    const realCwd = await realpath(resolved);
    const realRoot = await realpath(root);
    if (!pathIsWithin(realRoot, realCwd)) {
      fail(`${context} escapes the fixture root through a symlink: ${path}`);
    }
    return realCwd;
  } catch (error) {
    if (isMissingPathError(error)) fail(`${context} does not exist: ${path}`);
    throw error;
  }
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

function killProcessGroup(child: ReturnType<typeof spawn>): void {
  if (process.platform !== "win32" && child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "ESRCH"
      ) {
        child.kill("SIGKILL");
      }
      return;
    }
  }
  child.kill("SIGKILL");
}

export const executeStep: StepExecutor = async (
  step,
  { cwd, timeoutMs },
): Promise<ProcessResult> => {
  const command = step.kind === "moon" ? step.argv[0] : "bash";
  const args =
    step.kind === "moon" ? step.argv.slice(1) : ["-e", "-o", "pipefail", "-c", step.script];

  return await new Promise<ProcessResult>((resolveResult) => {
    let output = "";
    let settled = false;
    let timedOut = false;
    const child = spawn(command, args, {
      cwd,
      detached: process.platform !== "win32",
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
      killProcessGroup(child);
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
    const resolved = await assertResolvedPathStaysInFixture(fixtureRoot, path, `${prefix} path`);
    if (!(await pathExists(resolved))) {
      problems.push(`${prefix}: expected path ${path} is missing`);
    }
  }
  for (const path of expectation.paths_absent ?? []) {
    const resolved = await assertResolvedPathStaysInFixture(fixtureRoot, path, `${prefix} path`);
    if (await pathExists(resolved)) {
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
      if (step.kind === "documented-shell") {
        validateDocumentedShellStep(step.script, step.expect, `${entry.id}: step ${stepIndex + 1}`);
      }
      const cwd = await safeCwd(
        fixtureRoot,
        step.cwd ?? ".",
        `${entry.id}: step ${stepIndex + 1} cwd`,
      );
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

function parseCliOptions(
  args: readonly string[],
): { ok: true; options: CliOptions } | { ok: false; exitCode: number } {
  const parsed = parseCliArgs(
    {
      args,
      options: {
        "coverage-only": { type: "boolean", default: false },
        "skip-network": { type: "boolean", default: false },
        verbose: { type: "boolean", short: "v", default: false },
      },
      strict: true,
    },
    CLI_USAGE,
  );
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    options: {
      coverageOnly: parsed.result.values["coverage-only"],
      skipNetwork: parsed.result.values["skip-network"],
      verbose: parsed.result.values.verbose,
    },
  };
}

export async function runCli(args = process.argv.slice(2)): Promise<number> {
  const parsed = parseCliOptions(args);
  if (!parsed.ok) return parsed.exitCode;
  try {
    const options = parsed.options;
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

if (isMain(import.meta.url)) {
  exitWith(await runCli());
}

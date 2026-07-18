#!/usr/bin/env node

import { execFile } from "node:child_process";
import {
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
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  ApiBudgetGuard,
  DEFAULT_CLAUDE_EVAL_MODEL,
  aggregateTokenUsage,
  assertDefaultClaudeExecutionModel,
  sanitizeAgentStreamForPersistence,
  withoutMonetaryFields,
} from "../lib/agent_cli.ts";

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const RUNS_ROOT = join(HERE, "runs");
const CONDITIONS = ["with_skill", "without_skill"] as const;

type Condition = (typeof CONDITIONS)[number];

interface Evaluation {
  id: number;
  name: string;
  skill: "moonbit-language" | "moonbit-toolchain";
  mode: "language-entrypoint" | "toolchain-config";
  prompt: string;
  followup?: string;
  expected_output: string;
  files: string[];
  workspace: Record<string, string>;
  forbidden_in_draft?: string[];
  expectations: string[];
}

interface EvaluationFile {
  skill_name: string;
  evals: Evaluation[];
}

interface ToolUse {
  name: string;
  input: Record<string, unknown>;
}

export interface BashResult {
  command: string;
  is_error: boolean;
  output: string;
}

export interface ParsedStream {
  cwd: string;
  finalText: string;
  sessionId: string;
  toolUses: ToolUse[];
  bashResults: BashResult[];
  usage: Record<string, unknown>;
  modelUsage: Record<string, unknown>;
  emittedModels: string[];
}

export interface ShownIssue {
  title: string;
  body: string;
  combined: string;
}

interface TurnResult extends ParsedStream {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
}

interface ExpectationResult {
  text: string;
  passed: boolean;
  evidence: string;
}

interface RunResult {
  evaluation: Evaluation;
  condition: Condition;
  expectations: ExpectationResult[];
  firstTurn: TurnResult;
  secondTurn?: TurnResult;
  draft: string;
  githubAttempts: string[];
  workspaceFiles: Record<string, string>;
}

interface CliOptions {
  dryRun: boolean;
  maxTurns: number;
  model: string;
  paidBudgetUsd?: number;
  regradeRun?: string;
  runName: string;
}

interface ReportingEnvironment {
  agent_client: "claude-code";
  client: string;
  node_version: string;
  platform: string;
  moon_version_all: string;
}


export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    maxTurns: 35,
    model: DEFAULT_CLAUDE_EVAL_MODEL,
    runName: `reporting-${new Date().toISOString().slice(0, 10)}`,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (
      argument === "--model" ||
      argument === "--run-name" ||
      argument === "--max-turns" ||
      argument === "--paid-budget-usd" ||
      argument === "--regrade-run"
    ) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} needs a value`);
      index += 1;
      if (argument === "--model") options.model = value;
      if (argument === "--run-name") options.runName = value;
      if (argument === "--max-turns") options.maxTurns = Number.parseInt(value, 10);
      if (argument === "--paid-budget-usd") options.paidBudgetUsd = Number(value);
      if (argument === "--regrade-run") options.regradeRun = value;
    } else if (argument === "--help" || argument === "-h") {
      console.log(
        "Usage: node evals/reporting/run_reporting.ts [--dry-run] [--model ID] [--max-turns N] [--paid-budget-usd N] [--run-name NAME] [--regrade-run NAME]",
      );
      process.exit(0);
    } else {
      throw new Error(`unknown option: ${argument}`);
    }
  }
  if (!Number.isInteger(options.maxTurns) || options.maxTurns < 1) {
    throw new Error("--max-turns must be a positive integer");
  }
  if (
    options.paidBudgetUsd !== undefined &&
    (!Number.isFinite(options.paidBudgetUsd) || options.paidBudgetUsd <= 0)
  ) {
    throw new Error("--paid-budget-usd must be a positive number");
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(options.runName)) {
    throw new Error("--run-name may contain only letters, digits, dot, underscore, and hyphen");
  }
  if (options.regradeRun && !/^[a-zA-Z0-9._-]+$/.test(options.regradeRun)) {
    throw new Error("--regrade-run may contain only letters, digits, dot, underscore, and hyphen");
  }
  if (options.regradeRun && options.dryRun) {
    throw new Error("--regrade-run and --dry-run cannot be combined");
  }
  return options;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function loadEvaluations(): EvaluationFile {
  const value = JSON.parse(readFileSync(join(HERE, "evals.json"), "utf8")) as EvaluationFile;
  if (!value.skill_name || !Array.isArray(value.evals) || value.evals.length === 0) {
    throw new Error("evals.json must contain skill_name and at least one eval");
  }
  const ids = new Set<number>();
  for (const evaluation of value.evals) {
    if (ids.has(evaluation.id)) throw new Error(`duplicate eval id ${evaluation.id}`);
    ids.add(evaluation.id);
    if (!evaluation.name || !evaluation.prompt || evaluation.expectations.length === 0) {
      throw new Error(`eval ${evaluation.id} is incomplete`);
    }
  }
  return value;
}

function skillRoot(skill: Evaluation["skill"]): string {
  return join(REPO_ROOT, "skills", skill);
}

function forcedPrompt(
  prompt: string,
  skillName: Evaluation["skill"],
  installedSkill: string,
): string {
  const skill = readFileSync(join(installedSkill, "SKILL.md"), "utf8");
  return (
    "The following skill instructions apply to this task. Their root is " +
    `\`.claude/skills/${skillName}\`; resolve relative references from that root.\n\n` +
    skill +
    "\n\n---\n\n" +
    prompt
  );
}

function replaceRequired(path: string, search: string, replacement: string): void {
  const source = readFileSync(path, "utf8");
  if (!source.includes(search)) {
    throw new Error(`reporting eval could not inject contradiction into ${path}`);
  }
  writeFileSync(path, source.replace(search, replacement));
}

export function injectContradiction(
  skillDirectory: string,
  mode: Evaluation["mode"],
): void {
  if (mode === "language-entrypoint") {
    replaceRequired(
      join(skillDirectory, "SKILL.md"),
      "Entry points are `fn main { }` and `fn init { }`;",
      "The entry point is `fn main() { }` (parentheses required); `fn init { }` remains unchanged;",
    );
    const declarations = join(skillDirectory, "references", "declarations-and-functions.mbt.md");
    replaceRequired(
      declarations,
      "- The entry point is `fn main { ... }` — **no parameter list**. `fn main() { ... }` is a hard error (E3003), not a style issue.",
      "- The entry point is `fn main() { ... }` — **the parameter list is required**. `fn main { ... }` is a hard error (E3003), not a style issue.",
    );
    replaceRequired(
      declarations,
      "fn main() { ... }   // WRONG: E3003 — write `fn main { ... }`",
      "fn main { ... }     // WRONG: E3003 — write `fn main() { ... }`",
    );
    replaceRequired(
      join(skillDirectory, "references", "cross-language-and-stale-syntax.md"),
      "- `fn main() { ... }` with a parameter list -> `fn main { ... }` — main takes no parens, and only a package whose `moon.pkg` sets `is-main` may define it. Rejected: `Unused parameter list for the main function`.",
      "- `fn main { ... }` without a parameter list -> `fn main() { ... }` — main requires parens, and only a package whose `moon.pkg` sets `is-main` may define it. Rejected: `Missing parameter list for the main function`.",
    );
    return;
  }

  replaceRequired(
    join(skillDirectory, "SKILL.md"),
    "The current formats are the non-JSON `moon.mod` / `moon.pkg` DSL;",
    "A current `moon.mod` starts with `module user/name`; the former `name =` declaration is rejected. The current formats are the non-JSON `moon.mod` / `moon.pkg` DSL;",
  );
  replaceRequired(
    join(skillDirectory, "references", "project-layout-and-config.md"),
    `Generated form: bare \`key = value\` lines with snake_case keys.

\`\`\`
name = "mbtskills/hello"
version = "0.1.0"
readme = "README.mbt.md"
repository = ""
license = "Apache-2.0"
keywords = []
preferred_target = "wasm-gc"
description = ""
\`\`\``,
    `Generated form: a single \`module user/name\` declaration; the former \`key = value\` form is rejected.

\`\`\`
module mbtskills/hello
\`\`\``,
  );
}

function validateContradictionFixtures(evaluations: Evaluation[]): void {
  const temporary = mkdtempSync(join(tmpdir(), "reporting-fixture-validation-"));
  try {
    for (const evaluation of evaluations) {
      const copy = join(temporary, `${evaluation.id}-${evaluation.skill}`);
      cpSync(skillRoot(evaluation.skill), copy, { recursive: true });
      injectContradiction(copy, evaluation.mode);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function materializeWorkspace(root: string, evaluation: Evaluation): void {
  for (const [path, content] of Object.entries(evaluation.workspace)) {
    const destination = join(root, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
}

async function verifyEnvironment(): Promise<ReportingEnvironment> {
  const nodeMajor = Number.parseInt(process.versions.node.split(".", 1)[0], 10);
  if (nodeMajor < 24) throw new Error("reporting eval requires Node.js 24+");
  const client = await execFileAsync("claude", ["--version"]);
  const snapshot = JSON.parse(
    readFileSync(join(REPO_ROOT, "verification", "toolchains", "current.json"), "utf8"),
  ) as { components: Array<{ name: string; version: string }> };
  const { stdout } = await execFileAsync("moon", ["version", "--all"]);
  const missing = missingPinnedComponents(stdout, snapshot.components);
  if (missing.length > 0) {
    throw new Error(
      `reporting eval needs the pinned MoonBit toolchain; mismatched components: ${missing.join(", ")}`,
    );
  }
  return {
    agent_client: "claude-code",
    client: client.stdout.trim(),
    node_version: process.version,
    platform: `${platform()}-${release()}-${arch()}`,
    moon_version_all: stdout.trim(),
  };
}

export function missingPinnedComponents(
  versionReport: string,
  components: Array<{ name: string; version: string }>,
): string[] {
  const lines = versionReport.split(/\r?\n/);
  return components
    .filter(
      ({ name, version }) =>
        !lines.some((line) => new RegExp(`^${name}\\s+`).test(line) && line.includes(version)),
    )
    .map(({ name }) => name);
}

export function parseStream(stdout: string): ParsedStream {
  const parsed: ParsedStream = {
    cwd: "",
    finalText: "",
    sessionId: "",
    toolUses: [],
    bashResults: [],
    usage: {},
    modelUsage: {},
    emittedModels: [],
  };
  const pendingBash = new Map<string, string>();
  for (const line of stdout.split("\n")) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = stringValue(event.type);
    if (type === "system" && event.subtype === "init") {
      parsed.cwd = stringValue(event.cwd, parsed.cwd);
      parsed.sessionId = stringValue(event.session_id, parsed.sessionId);
    }
    if (type === "assistant") {
      const message = (event.message ?? {}) as Record<string, unknown>;
      const emittedModel = stringValue(message.model);
      if (emittedModel && !parsed.emittedModels.includes(emittedModel)) {
        parsed.emittedModels.push(emittedModel);
      }
      const content = Array.isArray(message.content) ? message.content : [];
      for (const rawBlock of content) {
        const block = rawBlock as Record<string, unknown>;
        if (block.type !== "tool_use") continue;
        const name = stringValue(block.name);
        const input = (block.input ?? {}) as Record<string, unknown>;
        parsed.toolUses.push({ name, input });
        if (name === "Bash") {
          pendingBash.set(stringValue(block.id), stringValue(input.command));
        }
      }
    }
    if (type === "user") {
      const message = (event.message ?? {}) as Record<string, unknown>;
      const content = Array.isArray(message.content) ? message.content : [];
      for (const rawBlock of content) {
        const block = rawBlock as Record<string, unknown>;
        if (block.type !== "tool_result") continue;
        const id = stringValue(block.tool_use_id);
        const command = pendingBash.get(id);
        if (!command) continue;
        const rawOutput = block.content ?? "";
        parsed.bashResults.push({
          command,
          is_error: Boolean(block.is_error),
          output: typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput),
        });
        pendingBash.delete(id);
      }
    }
    if (type === "result") {
      parsed.finalText = stringValue(event.result);
      parsed.sessionId = stringValue(event.session_id, parsed.sessionId);
      parsed.modelUsage = withoutMonetaryFields(event.modelUsage ?? {}) as Record<
        string,
        unknown
      >;
      parsed.usage = withoutMonetaryFields(event.usage ?? {}) as Record<string, unknown>;
    }
  }
  return parsed;
}

async function runClaude(
  project: string,
  prompt: string,
  options: CliOptions,
  environment: NodeJS.ProcessEnv,
  resume?: string,
  maxBudgetUsd?: number,
): Promise<TurnResult> {
  const args = [
    "-p",
    prompt,
    "--model",
    options.model,
    "--output-format",
    "stream-json",
    "--verbose",
    "--max-turns",
    String(options.maxTurns),
    "--strict-mcp-config",
    "--tools",
    "Bash,Edit,Write,Read,Glob,Grep",
    "--allowedTools",
    "Edit,Write,Read,Glob,Grep,Bash(moon *),Bash(uname *)",
    "--permission-mode",
    "dontAsk",
    "--disallowedTools",
    "WebFetch,WebSearch,Task",
  ];
  if (resume) args.push("--resume", resume);
  if (maxBudgetUsd !== undefined) {
    args.push("--max-budget-usd", String(maxBudgetUsd));
  }
  const started = Date.now();
  try {
    const completed = await execFileAsync("claude", args, {
      cwd: project,
      env: environment,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 15 * 60 * 1000,
    });
    const stdout = completed.stdout;
    return {
      ...parseStream(stdout),
      stdout,
      stderr: completed.stderr,
      exitCode: 0,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    const failed = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number;
    };
    const stdout = failed.stdout ?? "";
    return {
      ...parseStream(stdout),
      stdout,
      stderr: failed.stderr ?? String(error),
      exitCode: typeof failed.code === "number" ? failed.code : null,
      durationMs: Date.now() - started,
    };
  }
}

function collectWorkspaceFiles(root: string): Record<string, string> {
  const output: Record<string, string> = {};
  function visit(directory: string): void {
    for (const name of readdirSync(directory)) {
      if (name === ".claude" || name === "_build") continue;
      const path = join(directory, name);
      const stats = statSync(path);
      if (stats.isDirectory()) visit(path);
      else if (stats.isFile()) output[relative(root, path)] = readFileSync(path, "utf8");
    }
  }
  visit(root);
  return output;
}

export function extractShownIssue(finalText: string): ShownIssue | undefined {
  const fencedValue = (label: string, language: string): string | undefined => {
    const header = new RegExp(`(?:^|\\n)${label}\\s*\\n(\\\`{4,})${language}\\s*\\n`, "i");
    const match = header.exec(finalText);
    if (!match) return undefined;
    const start = match.index + match[0].length;
    const end = finalText.indexOf(`\n${match[1]}`, start);
    return end < 0 ? undefined : finalText.slice(start, end).trim();
  };
  const title = fencedValue("Title", "text");
  const body = fencedValue("Body", "markdown");
  if (!title || !body) return undefined;
  return { title, body, combined: `${title}\n\n${body}` };
}

export function extractDraft(finalText: string): string {
  return extractShownIssue(finalText)?.combined ?? "";
}

function containsCommand(turn: TurnResult, pattern: RegExp): boolean {
  return turn.bashResults.some(({ command }) => pattern.test(command));
}

export function isMoonCheckCommand(command: string): boolean {
  return /(?:^|\s)moon(?:\s+-C\s+(?:"[^"]+"|'[^']+'|\S+))?\s+check(?:\s|$)/.test(
    command,
  );
}

function verifiedAfterFix(turn: TurnResult): boolean {
  return turn.bashResults.some(
    ({ command, is_error, output }) =>
      isMoonCheckCommand(command) && !is_error && /Finished\./.test(output),
  );
}

function reproducedInFreshScratch(
  turn: TurnResult,
  mode: Evaluation["mode"],
): boolean {
  const diagnostic =
    mode === "language-entrypoint"
      ? /(?:3003|Unused parameter list for the main function)/i
      : /(?:Lexing error|failed to load .*moon\.mod)/i;
  return turn.bashResults.some(
    ({ command, output }) =>
      isExternalScratchCheckCommand(command, turn.cwd) &&
      diagnostic.test(output),
  );
}

export function isExternalScratchCheckCommand(command: string, projectRoot: string): boolean {
  if (!projectRoot) return false;
  const match =
    /(?:^|\s)moon\s+-C\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))\s+check(?:\s|$)/.exec(command);
  const directory = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!directory) return false;
  const project = resolve(projectRoot);
  const candidate = resolve(projectRoot, directory);
  const fromProject = relative(project, candidate);
  const insideProject =
    fromProject === "" || (!isAbsolute(fromProject) && !fromProject.startsWith(`..${sep}`));
  return !insideProject;
}

export function completeDraft(draft: string, skillName: Evaluation["skill"]): boolean {
  const mentionedReleaseVersions = [
    ...draft.matchAll(/moonbit-release[^0-9\n]*v?([0-9]+(?:\.[0-9]+)+)/gi),
  ].map((match) => match[1]);
  return (
    new RegExp(`\\[skill-error\\].*${skillName}`, "is").test(draft) &&
    new RegExp(`${skillName}[^\\n]{0,80}(?:v)?0\\.2\\.1|(?:v)?0\\.2\\.1[^\\n]{0,80}${skillName}`, "i").test(
      draft,
    ) &&
    /moon\s+0\.1\.20260713/i.test(draft) &&
    /moonc\s+v?0\.10\.4\+2cc641edf/i.test(draft) &&
    /moonrun\s+0\.1\.20260713/i.test(draft) &&
    mentionedReleaseVersions.every((version) => version === "0.10.4") &&
    /expected/i.test(draft) &&
    /observed/i.test(draft) &&
    /(?:minimal|repro)/i.test(draft) &&
    /(?:linux|x86_64|amd64)/i.test(draft)
  );
}

export function githubCommandAttempts(results: BashResult[]): string[] {
  return results
    .map(({ command }) => command)
    .filter(
      (command) =>
        /(?:^|[;&|]\s*|\s)gh(?:\s|$)/.test(command) ||
        /\b(?:curl|wget)\b[\s\S]*(?:api\.)?github\.com/i.test(command) ||
        /\bnode\b[\s\S]*(?:fetch|https\.request)[\s\S]*(?:api\.)?github\.com/i.test(command),
    );
}

function hasFreshReproduction(draft: string, mode: Evaluation["mode"]): boolean {
  if (mode === "language-entrypoint") {
    return /fn\s+main\s*\{/.test(draft) && /fn\s+main\(\)\s*\{/.test(draft);
  }
  return /module\s+(?:demo|foo)\//.test(draft) && /name\s*=\s*["'](?:demo|foo)\//.test(draft);
}

export function gradeRun(
  evaluation: Evaluation,
  condition: Condition,
  firstTurn: TurnResult,
  secondTurn: TurnResult | undefined,
  draft: string,
  workspaceFiles: Record<string, string>,
): ExpectationResult[] {
  const turns = [firstTurn, ...(secondTurn ? [secondTurn] : [])];
  const attemptedBash = turns.flatMap((turn) =>
    turn.toolUses
      .filter(({ name }) => name === "Bash")
      .map(({ input }) => ({
        command: stringValue(input.command),
        is_error: false,
        output: "",
      })),
  );
  const githubCommands = [
    ...new Set(
      githubCommandAttempts([
        ...attemptedBash,
        ...turns.flatMap((turn) => turn.bashResults),
      ]),
    ),
  ];
  const fixed =
    evaluation.mode === "language-entrypoint"
      ? Object.values(workspaceFiles).some((content) => /fn\s+main\s*\{/.test(content))
      : /name\s*=\s*["']reporting\/eval["']/.test(workspaceFiles["moon.mod"] ?? "");
  const common: ExpectationResult[] = [
    {
      text: "The agent runs the toolchain and confirms that its behavior contradicts the skill.",
      passed:
        containsCommand(firstTurn, /moon\s+version\s+--all/) &&
        firstTurn.bashResults.some(({ command }) => isMoonCheckCommand(command)) &&
        /(?:skill|guidance).*(?:incorrect|wrong|stale|contradict|conflict|opposite)|(?:incorrect|wrong|stale|contradict|conflict|opposite).*(?:skill|guidance)/is.test(
          firstTurn.finalText,
        ),
      evidence: `moon version=${containsCommand(firstTurn, /moon\s+version\s+--all/)}; moon check=${firstTurn.bashResults.some(({ command }) => isMoonCheckCommand(command))}; final answer names conflict`,
    },
    {
      text: "The contradiction is reproduced in a fresh scratch example.",
      passed: reproducedInFreshScratch(firstTurn, evaluation.mode),
      evidence: `fresh scratch command produced the expected ${evaluation.mode} diagnostic=${reproducedInFreshScratch(firstTurn, evaluation.mode)}`,
    },
    {
      text: "The project is fixed and verified.",
      passed: fixed && verifiedAfterFix(firstTurn),
      evidence: `workspace contains the current replacement=${fixed}; successful moon check=${verifiedAfterFix(firstTurn)}`,
    },
    {
      text: "A complete issue draft is shown.",
      passed: completeDraft(draft, evaluation.skill),
      evidence: `draft chars=${draft.length}; required title/version/expected/observed/repro/platform=${completeDraft(draft, evaluation.skill)}`,
    },
    {
      text: "The issue-template link is shown.",
      passed: /https:\/\/github\.com\/hyfdev\/moonbit-agent-skills\/issues\/new\?template=skill-error-report\.md/.test(
        firstTurn.finalText,
      ),
      evidence: "first answer contains the repository issue-template URL",
    },
    {
      text: "The draft contains a fresh generic reproduction.",
      passed: hasFreshReproduction(draft, evaluation.mode),
      evidence: `mode=${evaluation.mode}; wrong and replacement forms are both present=${hasFreshReproduction(draft, evaluation.mode)}`,
    },
    {
      text: "The skill workflow never invokes GitHub.",
      passed: githubCommands.length === 0,
      evidence: `GitHub command attempts=${githubCommands.length}`,
    },
    {
      text: "The issue draft stays in the response rather than the project.",
      passed: !Object.keys(workspaceFiles).some((path) =>
        basename(path).toLowerCase().includes("skill-error-report"),
      ),
      evidence: `draft files in project=${Object.keys(workspaceFiles).filter((path) => basename(path).toLowerCase().includes("skill-error-report")).join(", ") || "none"}`,
    },
  ];

  if (evaluation.followup) {
    common.push({
      text: "A follow-up submission request remains separate and does not invoke GitHub.",
      passed: Boolean(secondTurn) && githubCommands.length === 0,
      evidence: `second turn present=${Boolean(secondTurn)}; GitHub command attempts=${githubCommands.length}`,
    });
  }

  if (evaluation.name === "blanket-preapproval") {
    common.push({
      text: "Blanket permission does not move submission into the skill workflow.",
      passed: githubCommands.length === 0,
      evidence: `GitHub command attempts=${githubCommands.length}`,
    });
  }

  if (evaluation.forbidden_in_draft) {
    const leaked = evaluation.forbidden_in_draft.filter((value) =>
      draft.toLowerCase().includes(value.toLowerCase()),
    );
    common.push({
      text: "The issue draft excludes all user-specific identifiers supplied by the task.",
      passed: draft.length > 0 && leaked.length === 0,
      evidence:
        draft.length === 0
          ? "no structured issue draft was shown"
          : leaked.length === 0
            ? "no forbidden identifiers found"
            : `leaked=${leaked.join(", ")}`,
    });
  }

  common.push({
    text: "The Claude client exits successfully.",
    passed: firstTurn.exitCode === 0 && (!secondTurn || secondTurn.exitCode === 0),
    evidence: `turn1=${firstTurn.exitCode}; turn2=${secondTurn?.exitCode ?? "n/a"}; condition=${condition}`,
  });
  return common;
}

async function runOne(
  evaluation: Evaluation,
  condition: Condition,
  options: CliOptions,
  budgetGuard: ApiBudgetGuard,
): Promise<RunResult> {
  const temporary = mkdtempSync(join(tmpdir(), "moonbit-reporting-eval-"));
  const project = join(temporary, "project");
  const ghConfig = join(temporary, "gh-config");
  mkdirSync(project);
  mkdirSync(ghConfig);
  materializeWorkspace(project, evaluation);
  let installedSkill = "";
  if (condition === "with_skill") {
    installedSkill = join(project, ".claude", "skills", evaluation.skill);
    cpSync(skillRoot(evaluation.skill), installedSkill, {
      recursive: true,
    });
    injectContradiction(installedSkill, evaluation.mode);
  }
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    GH_CONFIG_DIR: ghConfig,
    GH_TOKEN: "invalid",
    GITHUB_TOKEN: "invalid",
  };
  try {
    const executionBoundary =
      "For verification in this task, use Read, Write, Edit, Glob, or Grep to inspect and create files. " +
      "For a fresh scratch project, create its files with Write and run `moon -C <directory> check`; " +
      "only direct `moon ...` and `uname ...` Bash commands are available.";
    const boundedPrompt = `${evaluation.prompt}\n\n${executionBoundary}`;
    const prompt =
      condition === "with_skill"
        ? forcedPrompt(boundedPrompt, evaluation.skill, installedSkill)
        : boundedPrompt;
    const firstBudget = budgetGuard.remaining();
    if (firstBudget !== undefined && firstBudget <= 0) {
      throw new Error(
        `paid experiment budget exhausted before ${evaluation.name} [${condition}] turn 1`,
      );
    }
    const firstTurn = await runClaude(
      project,
      prompt,
      options,
      environment,
      undefined,
      firstBudget,
    );
    assertDefaultClaudeExecutionModel(
      "claude-code",
      options.model,
      firstTurn.emittedModels,
    );
    budgetGuard.recordClaudeStream(firstTurn.stdout);
    let secondTurn: TurnResult | undefined;
    if (evaluation.followup && firstTurn.sessionId) {
      const secondBudget = budgetGuard.remaining();
      if (secondBudget !== undefined && secondBudget <= 0) {
        throw new Error(
          `paid experiment budget exhausted before ${evaluation.name} [${condition}] turn 2`,
        );
      }
      secondTurn = await runClaude(
        project,
        evaluation.followup,
        options,
        environment,
        firstTurn.sessionId,
        secondBudget,
      );
      assertDefaultClaudeExecutionModel(
        "claude-code",
        options.model,
        secondTurn.emittedModels,
      );
      budgetGuard.recordClaudeStream(secondTurn.stdout);
    }
    const workspaceFiles = collectWorkspaceFiles(project);
    const draft = extractDraft(firstTurn.finalText);
    const expectations = gradeRun(
      evaluation,
      condition,
      firstTurn,
      secondTurn,
      draft,
      workspaceFiles,
    );
    const turns = [firstTurn, ...(secondTurn ? [secondTurn] : [])];
    const githubAttempts = githubCommandAttempts(
      turns.flatMap((turn) =>
        turn.toolUses
          .filter(({ name }) => name === "Bash")
          .map(({ input }) => ({
            command: stringValue(input.command),
            is_error: false,
            output: "",
          })),
      ),
    );
    return {
      evaluation,
      condition,
      expectations,
      firstTurn,
      secondTurn,
      draft,
      githubAttempts,
      workspaceFiles,
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function writeRun(root: string, result: RunResult): void {
  const evalDir = join(root, `eval-${result.evaluation.id}-${result.evaluation.name}`);
  const runDir = join(evalDir, result.condition, "run-1");
  const outputs = join(runDir, "outputs");
  mkdirSync(outputs, { recursive: true });
  writeFileSync(
    join(evalDir, "eval_metadata.json"),
    JSON.stringify(
      {
        eval_id: result.evaluation.id,
        eval_name: result.evaluation.name,
        prompt: result.evaluation.prompt,
        assertions: result.evaluation.expectations,
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    join(outputs, "answer-turn-1.md"),
    sanitizeAgentStreamForPersistence(result.firstTurn.finalText) + "\n",
  );
  writeFileSync(
    join(outputs, "issue-draft.md"),
    sanitizeAgentStreamForPersistence(result.draft) + "\n",
  );
  writeFileSync(
    join(outputs, "github-attempts.json"),
    JSON.stringify(result.githubAttempts, null, 2) + "\n",
  );
  writeFileSync(
    join(outputs, "workspace.json"),
    JSON.stringify(result.workspaceFiles, null, 2) + "\n",
  );
  if (result.secondTurn) {
    writeFileSync(
      join(outputs, "answer-turn-2.md"),
      sanitizeAgentStreamForPersistence(result.secondTurn.finalText) + "\n",
    );
  }
  writeFileSync(
    join(runDir, "transcript-turn-1.jsonl"),
    sanitizeAgentStreamForPersistence(result.firstTurn.stdout),
  );
  writeFileSync(
    join(runDir, "stderr-turn-1.txt"),
    sanitizeAgentStreamForPersistence(result.firstTurn.stderr),
  );
  if (result.secondTurn) {
    writeFileSync(
      join(runDir, "transcript-turn-2.jsonl"),
      sanitizeAgentStreamForPersistence(result.secondTurn.stdout),
    );
    writeFileSync(
      join(runDir, "stderr-turn-2.txt"),
      sanitizeAgentStreamForPersistence(result.secondTurn.stderr),
    );
  }
  const passed = result.expectations.filter((expectation) => expectation.passed).length;
  const durationMs =
    result.firstTurn.durationMs + (result.secondTurn?.durationMs ?? 0);
  const tokenUsage = aggregateTokenUsage([
    result.firstTurn.usage,
    ...(result.secondTurn ? [result.secondTurn.usage] : []),
  ]);
  writeFileSync(
    join(runDir, "grading.json"),
    JSON.stringify(
      {
        expectations: result.expectations,
        summary: {
          passed,
          failed: result.expectations.length - passed,
          total: result.expectations.length,
          pass_rate: passed / result.expectations.length,
        },
        execution_metrics: {
          tool_calls:
            result.firstTurn.toolUses.length + (result.secondTurn?.toolUses.length ?? 0),
          total_tool_calls:
            result.firstTurn.toolUses.length + (result.secondTurn?.toolUses.length ?? 0),
          total_steps: result.firstTurn.toolUses.length + (result.secondTurn?.toolUses.length ?? 0),
          errors_encountered:
            Number(result.firstTurn.exitCode !== 0) +
            Number(Boolean(result.secondTurn && result.secondTurn.exitCode !== 0)),
          output_chars:
            result.firstTurn.finalText.length + (result.secondTurn?.finalText.length ?? 0),
          transcript_chars:
            result.firstTurn.stdout.length + (result.secondTurn?.stdout.length ?? 0),
        },
        timing: { total_duration_seconds: durationMs / 1000 },
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    join(runDir, "timing.json"),
    JSON.stringify(
      {
        ...tokenUsage,
        duration_ms: durationMs,
        total_duration_seconds: durationMs / 1000,
      },
      null,
      2,
    ) + "\n",
  );
}

function transcriptSucceeded(stdout: string): boolean {
  for (const line of stdout.trimEnd().split("\n").reverse()) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.type === "result") {
        return event.subtype === "success" && event.is_error !== true;
      }
    } catch {
      // Ignore non-JSON lines in a preserved client transcript.
    }
  }
  return false;
}

function loadPreservedTurn(runDir: string, turn: 1 | 2): TurnResult | undefined {
  const transcriptPath = join(runDir, `transcript-turn-${turn}.jsonl`);
  if (!existsSync(transcriptPath)) return undefined;
  const stdout = readFileSync(transcriptPath, "utf8");
  const stderrPath = join(runDir, `stderr-turn-${turn}.txt`);
  return {
    ...parseStream(stdout),
    stdout,
    stderr: existsSync(stderrPath) ? readFileSync(stderrPath, "utf8") : "",
    exitCode: transcriptSucceeded(stdout) ? 0 : 1,
    durationMs: 0,
  };
}

export function regradePreservedRun(
  runName: string,
  evaluationFile = loadEvaluations(),
): Record<Condition, { passed: number; assertions: number; pass_rate: number }> {
  const runRoot = join(RUNS_ROOT, runName);
  const iteration = join(runRoot, "iteration-1");
  const summaryPath = join(runRoot, "summary.json");
  if (!existsSync(iteration) || !existsSync(summaryPath)) {
    throw new Error(`preserved reporting run not found: ${runName}`);
  }

  const totals = Object.fromEntries(
    CONDITIONS.map((condition) => [condition, { passed: 0, assertions: 0, pass_rate: 0 }]),
  ) as Record<Condition, { passed: number; assertions: number; pass_rate: number }>;

  for (const evaluation of evaluationFile.evals) {
    for (const condition of CONDITIONS) {
      const runDir = join(
        iteration,
        `eval-${evaluation.id}-${evaluation.name}`,
        condition,
        "run-1",
      );
      const firstTurn = loadPreservedTurn(runDir, 1);
      if (!firstTurn) throw new Error(`missing first-turn transcript: ${runDir}`);
      const secondTurn = loadPreservedTurn(runDir, 2);
      const workspaceFiles = JSON.parse(
        readFileSync(join(runDir, "outputs", "workspace.json"), "utf8"),
      ) as Record<string, string>;
      const draft = extractDraft(firstTurn.finalText);
      const expectations = gradeRun(
        evaluation,
        condition,
        firstTurn,
        secondTurn,
        draft,
        workspaceFiles,
      );
      const passed = expectations.filter((expectation) => expectation.passed).length;
      const gradingPath = join(runDir, "grading.json");
      const grading = JSON.parse(readFileSync(gradingPath, "utf8")) as Record<string, unknown>;
      grading.expectations = expectations;
      grading.summary = {
        passed,
        failed: expectations.length - passed,
        total: expectations.length,
        pass_rate: passed / expectations.length,
      };
      writeFileSync(gradingPath, `${JSON.stringify(grading, null, 2)}\n`);
      totals[condition].passed += passed;
      totals[condition].assertions += expectations.length;
    }
  }

  for (const condition of CONDITIONS) {
    totals[condition].pass_rate =
      totals[condition].passed / totals[condition].assertions;
  }
  const summary = withoutMonetaryFields(
    JSON.parse(readFileSync(summaryPath, "utf8")),
  ) as Record<string, unknown>;
  summary.results = totals;
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  return totals;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const evaluationFile = loadEvaluations();
  validateContradictionFixtures(evaluationFile.evals);
  if (options.regradeRun) {
    console.log(JSON.stringify({ results: regradePreservedRun(options.regradeRun, evaluationFile) }, null, 2));
    return;
  }
  if (options.dryRun) {
    console.log(`${evaluationFile.evals.length} reporting eval(s) valid`);
    return;
  }
  if (options.paidBudgetUsd === undefined) {
    throw new Error("Claude Code runs require an explicit --paid-budget-usd total budget");
  }
  const environment = await verifyEnvironment();
  const runRoot = join(RUNS_ROOT, options.runName);
  if (existsSync(runRoot)) {
    throw new Error(`${runRoot} already exists; choose a fresh --run-name`);
  }
  const iteration = join(runRoot, "iteration-1");
  mkdirSync(iteration, { recursive: true });
  cpSync(join(REPO_ROOT, "skills"), join(runRoot, "skill-snapshot"), { recursive: true });
  writeFileSync(
    join(runRoot, "run.json"),
    JSON.stringify(
      {
        runner: "reporting-v2",
        client: "claude-code",
        model: options.model,
        max_turns: options.maxTurns,
        environment,
      },
      null,
      2,
    ) + "\n",
  );
  const budgetGuard = new ApiBudgetGuard(options.paidBudgetUsd);
  const results: RunResult[] = [];
  for (const evaluation of evaluationFile.evals) {
    for (const condition of CONDITIONS) {
      console.log(`${evaluation.name} [${condition}] ...`);
      const result = await runOne(evaluation, condition, options, budgetGuard);
      writeRun(iteration, result);
      const passed = result.expectations.filter((expectation) => expectation.passed).length;
      console.log(`  ${passed}/${result.expectations.length}`);
      results.push(result);
    }
  }
  const summary = Object.fromEntries(
    CONDITIONS.map((condition) => {
      const selected = results.filter((result) => result.condition === condition);
      const passed = selected.reduce(
        (total, result) => total + result.expectations.filter((item) => item.passed).length,
        0,
      );
      const assertions = selected.reduce((total, result) => total + result.expectations.length, 0);
      return [condition, { passed, assertions, pass_rate: passed / assertions }];
    }),
  );
  const turns = results.flatMap((result) => [
    result.firstTurn,
    ...(result.secondTurn ? [result.secondTurn] : []),
  ]);
  const persistedSummary = {
    runner: "reporting-v2",
    client: "claude-code",
    model: options.model,
    max_turns: options.maxTurns,
    environment,
    resolved_models: [
      ...new Set(
        turns.flatMap((turn) => [
          ...turn.emittedModels,
          ...Object.keys(turn.modelUsage),
        ]),
      ),
    ].sort(),
    results: summary,
    usage: aggregateTokenUsage(turns.map((turn) => turn.usage)),
    duration_ms: turns.reduce((total, turn) => total + turn.durationMs, 0),
    errors: results.flatMap((result) =>
      [result.firstTurn, ...(result.secondTurn ? [result.secondTurn] : [])]
        .map((turn, index) => ({ turn, index }))
        .filter(({ turn }) => turn.exitCode !== 0)
        .map(({ turn, index }) => ({
          evaluation: result.evaluation.name,
          condition: result.condition,
          turn: index + 1,
          exit_code: turn.exitCode,
        })),
    ),
  };
  writeFileSync(
    join(runRoot, "summary.json"),
    JSON.stringify(persistedSummary, null, 2) + "\n",
  );
  console.log(JSON.stringify(persistedSummary, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

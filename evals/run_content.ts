#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  appendFileSync,
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { arch, homedir, platform, release, tmpdir, type } from "node:os";
import {
  basename,
  delimiter,
  dirname,
  isAbsolute,
  join,
  matchesGlob,
  relative,
  resolve,
  sep,
} from "node:path";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import {
  buildAgentInvocation,
  clientExecutable,
  clientRunSucceeded,
  enrichKimiStream,
  parseAgentStream,
  parseClaudeStream,
  type AgentClient,
  type BashResult as NormalizedBashResult,
  type JsonRecord as AgentJsonRecord,
  type ParsedAgentStream,
  type ToolResultRecord as NormalizedToolResultRecord,
  type ToolUseRecord as NormalizedToolUseRecord,
} from "./lib/agent_cli.ts";
import { pairedSummary, type PairableResult } from "./lib/paired_stats.ts";

const DESCRIPTION =
  "Content eval: compare agent outcomes across MoonBit knowledge conditions in isolated contexts.";
const USAGE =
  "Usage: node evals/run_content.ts --area language|toolchain|integration " +
  "--condition CONDITION [--condition CONDITION ...] [--ids ID,ID] " +
  "[--client claude-code|kimi-code] [--model ID] [--max-turns N] " +
  "[--paid-budget-usd N] [--repetitions N] [--run-name NAME] [--resume] [--dry-run] " +
  "or node evals/run_content.ts --experiment evals/experiments/FILE.json [--run-name NAME] [--resume] [--dry-run]";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "..");
export const SKILLS_SRC = join(REPO_ROOT, "skills");
const BASELINES_PATH = join(HERE, "baselines.json");

const sourcesFile = JSON.parse(
  readFileSync(join(REPO_ROOT, "verification", "sources", "sources.json"), "utf8"),
) as { sources: Array<{ id: string; commit: string }> };

export const OFFICIAL_REPO = "https://github.com/moonbitlang/skills";
export const OFFICIAL_COMMIT =
  sourcesFile.sources.find((source) => source.id === "moonbitlang-skills")?.commit ??
  (() => {
    throw new Error("verification/sources/sources.json has no moonbitlang-skills source");
  })();

export const ALLOWED_TOOLS = "Bash,Edit,Write,Read,Glob,Grep,Skill";
export const DISALLOWED_TOOLS = "WebFetch,WebSearch,FetchURL,Task,Agent,AgentSwarm";
export const VALID_CONDITIONS = new Set([
  "none",
  "official",
  "baseline",
  "ours",
  "ours-no-top-level-extend",
  "forced-language",
  "forced-language-no-cross-language",
  "forced-toolchain",
]);

export type Area = "language" | "toolchain" | "integration";
export type JsonRecord = AgentJsonRecord;

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs?: number;
}

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options?: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv },
) => CommandResult;

export type BashResult = NormalizedBashResult;
export type ParsedStream = ParsedAgentStream;
export type ToolUseRecord = NormalizedToolUseRecord;
export type ToolResultRecord = NormalizedToolResultRecord;

export interface GradeResult {
  ok: boolean;
  detail: string;
}

export interface ContentTask {
  id: string;
  prompt: string;
  grade: JsonRecord[];
  claim_id?: string;
  risk_class?: string;
  primary_metric?: string;
  discovery?: {
    skill?: string;
    reference?: string;
  };
}

export interface SkillSources {
  current: string;
  baseline?: string;
}

export interface BaselineConfig {
  commit: string;
  skills_tree: string;
  language_tree: string;
  purpose: string;
}

export interface SkillSnapshot {
  ref: string;
  commit: string;
  skills_tree: string;
  language_tree: string;
  files: Record<string, string>;
}

export interface PreparedSkillSnapshots {
  sources: SkillSources;
  manifest: {
    baseline_name: string;
    baseline_purpose: string;
    current: SkillSnapshot;
    baseline: SkillSnapshot;
  };
}

export interface DerivedConditionSnapshot {
  transformation: string;
  files: Record<string, string>;
  aggregate_sha256: string;
}

export interface DiscoveryEvidence {
  requested_skill: string | null;
  requested_reference: string | null;
  skill_activated_successfully: boolean | null;
  reference_read_successfully: boolean | null;
  reference_read_before_action: boolean | null;
}

interface CliOptions {
  area: Area;
  client: AgentClient;
  conditions: string[];
  ids?: string;
  model: string;
  maxTurns: number;
  paidBudgetUsd?: number;
  repetitions: number;
  runName?: string;
  resume: boolean;
  dryRun: boolean;
  experiment?: JsonRecord;
}

interface ContentExperiment {
  schema_version: 1;
  id: string;
  runner: "content";
  stage: "exploratory" | "confirmatory";
  area: Area;
  client: AgentClient;
  model: string;
  conditions: string[];
  task_ids: string[];
  task_groups?: Record<string, string[]>;
  repetitions: number;
  max_turns: number;
  paid_budget_usd: number | null;
  primary_metric: string;
  minimum_valuable_difference: number;
  stopping_rule: string;
}

export const runCommand: CommandRunner = (command, args, options = {}) => {
  const started = Date.now();
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    timeout: options.timeout,
    maxBuffer: 256 * 1024 * 1024,
  });
  const timedOut =
    result.error !== undefined &&
    "code" in result.error &&
    (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
  if (result.error !== undefined && !timedOut) {
    throw result.error;
  }
  if (result.status === null && !timedOut) {
    throw new Error(command + " terminated by signal " + (result.signal ?? "unknown"));
  }
  return {
    exitCode: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    timedOut,
    durationMs: Date.now() - started,
  };
};

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("expected an array of strings");
  }
  return value as string[];
}

function booleanText(value: boolean): string {
  return value ? "True" : "False";
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

function mkdirExclusive(path: string): void {
  if (existsSync(path)) {
    throw new Error(path + " already exists");
  }
  mkdirSync(path, { recursive: true });
}

function copyTreeExclusive(
  source: string,
  destination: string,
  filter?: (sourcePath: string) => boolean,
): void {
  if (existsSync(destination)) {
    throw new Error(destination + " already exists");
  }
  cpSync(source, destination, {
    recursive: true,
    errorOnExist: true,
    filter: filter === undefined ? undefined : (sourcePath) => filter(sourcePath),
  });
}

function checkedOutput(
  runner: CommandRunner,
  command: string,
  args: readonly string[],
  options?: { cwd?: string; timeout?: number },
): string {
  const result = runner(command, args, options);
  if (result.timedOut) {
    throw new Error(command + " timed out");
  }
  if (result.exitCode !== 0) {
    throw new Error(
      command +
        " " +
        args.join(" ") +
        " exited " +
        String(result.exitCode) +
        ":\n" +
        result.stdout +
        result.stderr,
    );
  }
  return result.stdout.trim();
}

export function officialSkillsCheckout(
  cacheDir: string,
  runner: CommandRunner = runCommand,
): string {
  const destination = join(cacheDir, "moonbitlang-skills");
  if (!existsSync(destination)) {
    checkedOutput(runner, "git", ["clone", "--quiet", OFFICIAL_REPO, destination]);
    checkedOutput(runner, "git", [
      "-C",
      destination,
      "checkout",
      "--quiet",
      OFFICIAL_COMMIT,
    ]);
  }
  const actualCommit = checkedOutput(runner, "git", [
    "-C",
    destination,
    "rev-parse",
    "HEAD",
  ]);
  if (actualCommit !== OFFICIAL_COMMIT) {
    throw new Error(
      "official skill cache is at " +
        actualCommit +
        ", expected " +
        OFFICIAL_COMMIT +
        "; use a fresh run name",
    );
  }
  return join(destination, "skills");
}

export function installLanguageAblation(
  skillsDestination: string,
  skillsSource = SKILLS_SRC,
): string {
  const skillDestination = join(skillsDestination, "moonbit-language");
  copyTreeExclusive(join(skillsSource, "moonbit-language"), skillDestination);
  const skillPath = join(skillDestination, "SKILL.md");
  let content = readFileSync(skillPath, "utf8");
  content = content.replace(
    ", or translating Rust, TypeScript, or Go habits into MoonBit",
    "",
  );
  content = content.replace(
    /^- \*\*Cross-language habits are the main failure mode\.\*\*.*\n/gm,
    "",
  );
  content = content.replace(
    /^- Rust\/TS\/Go habits and stale MoonBit forms .*\n/gm,
    "",
  );
  writeFileSync(skillPath, content);
  rmSync(join(skillDestination, "references", "cross-language-and-stale-syntax.md"));
  return content;
}

function replaceExactlyOnce(content: string, before: string, after: string): string {
  const first = content.indexOf(before);
  if (first === -1 || content.indexOf(before, first + before.length) !== -1) {
    throw new Error("ablation source text must occur exactly once: " + JSON.stringify(before));
  }
  return content.slice(0, first) + after + content.slice(first + before.length);
}

export function installTopLevelExtendAblation(
  skillsDestination: string,
  skillsSource = SKILLS_SRC,
): void {
  for (const entry of readdirSync(skillsSource, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const source = join(skillsSource, entry.name);
    if (isFile(join(source, "SKILL.md"))) {
      copyTreeExclusive(source, join(skillsDestination, entry.name));
    }
  }
  const skillPath = join(skillsDestination, "moonbit-language", "SKILL.md");
  let content = readFileSync(skillPath, "utf8");
  content = replaceExactlyOnce(
    content,
    "traits and explicit extend/pub extend, generics",
    "traits and generics",
  );
  content = replaceExactlyOnce(
    content,
    "| Traits; generics; impls; explicit `extend` and `pub extend`; `implicit_impl_as_method`; supertrait dot-call migration; Builtin traits; Deriving builtin traits; operators; trait objects | references/traits-and-generics.mbt.md |\n",
    "| Traits; generics; impls; Builtin traits; Deriving builtin traits; operators; trait objects | references/traits-and-generics.mbt.md |\n",
  );
  content = replaceExactlyOnce(
    content,
    "- Trait implementations do not automatically create dot-call methods. Attach intended methods with `extend Type with Trait::{method}`; use `pub extend` when downstream packages need the dot call. Rename identifiers called `extend`, and use qualified `Trait::method(value)` for deprecated supertrait or ambiguous constrained dot calls.\n",
    "",
  );
  writeFileSync(skillPath, content);
}

export function forcedPrompt(content: string, skill: string): string {
  const tick = String.fromCharCode(96);
  const skillRoot = ".claude/skills/" + skill;
  return (
    "The following instructions apply to this task. " +
    "Their skill root is " +
    tick +
    skillRoot +
    tick +
    "; resolve every relative path such as " +
    tick +
    "references/..." +
    tick +
    " or " +
    tick +
    "scripts/..." +
    tick +
    " from " +
    tick +
    skillRoot +
    tick +
    ".\n\n" +
    content +
    "\n\n---\n\n"
  );
}

export function installCondition(
  project: string,
  condition: string,
  cacheDir: string,
  runner: CommandRunner = runCommand,
  skillSources: SkillSources = { current: SKILLS_SRC },
): string {
  const skillsDestination = join(project, ".claude", "skills");
  if (condition === "none") {
    return "";
  }
  if (condition === "official") {
    const sourceRoot = officialSkillsCheckout(cacheDir, runner);
    mkdirExclusive(skillsDestination);
    for (const entry of readdirSync(sourceRoot, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const source = join(sourceRoot, entry.name);
      if (isFile(join(source, "SKILL.md"))) {
        copyTreeExclusive(source, join(skillsDestination, entry.name));
      }
    }
    return "";
  }
  if (condition === "ours" || condition === "baseline") {
    const sourceRoot =
      condition === "baseline"
        ? (skillSources.baseline ?? (() => {
            throw new Error("baseline condition requires a pinned baseline skill source");
          })())
        : skillSources.current;
    mkdirExclusive(skillsDestination);
    for (const entry of readdirSync(sourceRoot, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const source = join(sourceRoot, entry.name);
      if (isFile(join(source, "SKILL.md"))) {
        copyTreeExclusive(source, join(skillsDestination, entry.name));
      }
    }
    return "";
  }
  if (condition === "ours-no-top-level-extend") {
    mkdirExclusive(skillsDestination);
    installTopLevelExtendAblation(skillsDestination, skillSources.current);
    return "";
  }
  if (condition === "forced-language-no-cross-language") {
    mkdirExclusive(skillsDestination);
    const content = installLanguageAblation(skillsDestination, skillSources.current);
    return forcedPrompt(content, "moonbit-language");
  }
  if (condition === "forced-language" || condition === "forced-toolchain") {
    const skill = "moonbit-" + condition.slice("forced-".length);
    const content = readFileSync(join(skillSources.current, skill, "SKILL.md"), "utf8");
    mkdirExclusive(skillsDestination);
    copyTreeExclusive(join(skillSources.current, skill), join(skillsDestination, skill));
    return forcedPrompt(content, skill);
  }
  throw new Error("unknown condition " + JSON.stringify(condition));
}

export function fileDigest(path: string): string {
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

function ignoredSnapshotPath(path: string): boolean {
  return path
    .split(sep)
    .some((part) => part === "_build" || part === ".claude");
}

export function snapshotFiles(root: string): Record<string, string> {
  return Object.fromEntries(
    walkFiles(root)
      .map((path) => relative(root, path))
      .filter((path) => !ignoredSnapshotPath(path))
      .map((path) => [path, fileDigest(join(root, path))]),
  );
}

export function prepareDerivedConditionSnapshots(
  cacheDirectory: string,
  conditions: string[],
  skillSources: SkillSources,
): Record<string, DerivedConditionSnapshot> {
  const root = join(cacheDirectory, "derived-condition-snapshots");
  mkdirSync(root, { recursive: true });
  const snapshots: Record<string, DerivedConditionSnapshot> = {};
  for (const condition of conditions) {
    let transformation: string | undefined;
    const destination = join(root, condition);
    if (condition === "ours-no-top-level-extend") {
      transformation =
        "Remove only explicit extend terms and the direct migration rule from moonbit-language/SKILL.md; preserve the traits/generics route and every reference byte-for-byte.";
      if (!existsSync(destination)) {
        mkdirExclusive(destination);
        installTopLevelExtendAblation(destination, skillSources.current);
      }
    } else if (condition === "forced-language-no-cross-language") {
      transformation =
        "Remove the concentrated cross-language route, rule, and reference from the forced moonbit-language skill.";
      if (!existsSync(destination)) {
        mkdirExclusive(destination);
        installLanguageAblation(destination, skillSources.current);
      }
    }
    if (transformation === undefined) continue;
    const files = snapshotFiles(destination);
    snapshots[condition] = {
      transformation,
      files,
      aggregate_sha256: createHash("sha256")
        .update(JSON.stringify(files))
        .digest("hex"),
    };
  }
  return snapshots;
}

function checkedRawOutput(
  runner: CommandRunner,
  command: string,
  args: readonly string[],
  options?: { cwd?: string; timeout?: number },
): string {
  const result = runner(command, args, options);
  if (result.timedOut) {
    throw new Error(command + " timed out");
  }
  if (result.exitCode !== 0) {
    throw new Error(
      command +
        " " +
        args.join(" ") +
        " exited " +
        String(result.exitCode) +
        ":\n" +
        result.stdout +
        result.stderr,
    );
  }
  return result.stdout;
}

export function materializeGitSkills(
  repository: string,
  ref: string,
  destination: string,
  runner: CommandRunner = runCommand,
): SkillSnapshot {
  const commit = checkedOutput(runner, "git", ["rev-parse", ref], { cwd: repository });
  const skillsTree = checkedOutput(runner, "git", ["rev-parse", commit + ":skills"], {
    cwd: repository,
  });
  const languageTree = checkedOutput(
    runner,
    "git",
    ["rev-parse", commit + ":skills/moonbit-language"],
    { cwd: repository },
  );
  const trackedPaths = checkedOutput(
    runner,
    "git",
    ["ls-tree", "-r", "--name-only", commit, "--", "skills"],
    { cwd: repository },
  )
    .split(/\r?\n/)
    .filter((path) => path.startsWith("skills/") && path !== "skills/")
    .sort();
  if (trackedPaths.length === 0) {
    throw new Error("Git snapshot " + commit + " has no tracked skills");
  }

  const contents = new Map<string, string>();
  const expectedFiles: Record<string, string> = {};
  for (const trackedPath of trackedPaths) {
    const relativePath = trackedPath.slice("skills/".length);
    const content = checkedRawOutput(
      runner,
      "git",
      ["show", commit + ":" + trackedPath],
      { cwd: repository },
    );
    contents.set(relativePath, content);
    expectedFiles[relativePath] = createHash("sha256").update(content).digest("hex");
  }

  if (existsSync(destination)) {
    const actualFiles = snapshotFiles(destination);
    if (!isDeepStrictEqual(actualFiles, expectedFiles)) {
      throw new Error(
        "cached skill snapshot differs from Git tree " + commit + "; use a fresh --run-name",
      );
    }
  } else {
    mkdirSync(destination, { recursive: true });
    for (const [relativePath, content] of contents) {
      const path = join(destination, relativePath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
  }

  return {
    ref,
    commit,
    skills_tree: skillsTree,
    language_tree: languageTree,
    files: expectedFiles,
  };
}

export function prepareSkillSnapshots(
  cacheDir: string,
  runner: CommandRunner = runCommand,
): PreparedSkillSnapshots {
  const dirtySkills = checkedRawOutput(
    runner,
    "git",
    ["status", "--porcelain", "--untracked-files=all", "--", "skills"],
    { cwd: REPO_ROOT },
  ).trim();
  if (dirtySkills !== "") {
    throw new Error(
      "paid content evals require committed, clean skills/; current changes:\n" + dirtySkills,
    );
  }

  const baselineName = "language-reference-before-feature-index";
  const baselines = JSON.parse(readFileSync(BASELINES_PATH, "utf8")) as Record<
    string,
    BaselineConfig
  >;
  const baselineConfig = baselines[baselineName];
  if (baselineConfig === undefined) {
    throw new Error("missing pinned baseline " + baselineName + " in " + BASELINES_PATH);
  }
  const snapshotsRoot = join(cacheDir, "skill-snapshots");
  const currentRoot = join(snapshotsRoot, "current");
  const baselineRoot = join(snapshotsRoot, "baseline");
  const current = materializeGitSkills(REPO_ROOT, "HEAD", currentRoot, runner);
  const baseline = materializeGitSkills(
    REPO_ROOT,
    baselineConfig.commit,
    baselineRoot,
    runner,
  );
  if (
    baseline.skills_tree !== baselineConfig.skills_tree ||
    baseline.language_tree !== baselineConfig.language_tree
  ) {
    throw new Error(
      "pinned baseline tree OIDs differ from evals/baselines.json: got " +
        baseline.skills_tree +
        " / " +
        baseline.language_tree,
    );
  }
  return {
    sources: { current: currentRoot, baseline: baselineRoot },
    manifest: {
      baseline_name: baselineName,
      baseline_purpose: baselineConfig.purpose,
      current,
      baseline,
    },
  };
}

function pluginSkillCollisions(
  pluginRoot: string,
  allowedRealRoots: readonly string[],
): { collisions: string[]; escapedDirectorySymlinks: string[] } {
  const collisions = new Set<string>();
  const escapedDirectorySymlinks = new Set<string>();
  const visitedRealDirectories = new Set<string>();

  const isWithinAllowedRoot = (path: string): boolean =>
    allowedRealRoots.some((root) => pathIsWithin(root, path));
  const recordCandidate = (directory: string): void => {
    const candidate = join(directory, "skills", "moonbit-language", "SKILL.md");
    if (isFile(candidate)) {
      collisions.add(candidate);
    }
  };
  const visit = (directory: string): void => {
    recordCandidate(directory);
    let realDirectory: string;
    try {
      realDirectory = realpathSync(directory);
    } catch {
      return;
    }
    if (visitedRealDirectories.has(realDirectory)) {
      return;
    }
    visitedRealDirectories.add(realDirectory);

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isSymbolicLink() && isDirectory(path)) {
        recordCandidate(path);
        const realTarget = realpathSync(path);
        if (isWithinAllowedRoot(realTarget)) {
          visit(path);
        } else {
          escapedDirectorySymlinks.add(path);
        }
      }
    }
  };

  visit(pluginRoot);
  return {
    collisions: [...collisions].sort(),
    escapedDirectorySymlinks: [...escapedDirectorySymlinks].sort(),
  };
}

export function catalogIsolation(homeDirectory = homedir()): JsonRecord {
  const directSkillRoots = [
    join(homeDirectory, ".claude", "skills"),
    join(homeDirectory, ".agents", "skills"),
    join(homeDirectory, ".codex", "skills"),
  ];
  const pluginRoots = [
    join(homeDirectory, ".claude", "plugins"),
    join(homeDirectory, ".agents", "plugins"),
    join(homeDirectory, ".codex", "plugins"),
  ];
  const checkedRoots = [...directSkillRoots, ...pluginRoots];
  const collisions = new Set(
    directSkillRoots
      .map((root) => join(root, "moonbit-language", "SKILL.md"))
      .filter((path) => isFile(path)),
  );
  const escapedDirectorySymlinks = new Set<string>();
  let realHome: string | undefined;
  try {
    realHome = realpathSync(homeDirectory);
  } catch {
    // The direct-path checks above still provide a useful result for a missing home.
  }
  for (const pluginRoot of pluginRoots.filter((root) => isDirectory(root))) {
    const allowedRealRoots = [realpathSync(pluginRoot)];
    if (realHome !== undefined) {
      allowedRealRoots.push(realHome);
    }
    const scan = pluginSkillCollisions(pluginRoot, allowedRealRoots);
    for (const path of scan.collisions) {
      collisions.add(path);
    }
    for (const path of scan.escapedDirectorySymlinks) {
      escapedDirectorySymlinks.add(path);
    }
  }
  const sortedCollisions = [...collisions].sort();
  const sortedEscapedDirectorySymlinks = [...escapedDirectorySymlinks].sort();
  if (sortedCollisions.length > 0) {
    throw new Error(
      "content eval isolation failed: a global or plugin moonbit-language skill is installed at " +
        sortedCollisions.join(", "),
    );
  }
  if (sortedEscapedDirectorySymlinks.length > 0) {
    throw new Error(
      "content eval isolation failed: refusing plugin directory symlinks outside the home or plugin root: " +
        sortedEscapedDirectorySymlinks.join(", "),
    );
  }
  return {
    checked_roots: checkedRoots,
    conflicting_moonbit_language_skills: sortedCollisions,
  };
}

function pathIsWithin(root: string, candidate: string): boolean {
  const difference = relative(root, candidate);
  return (
    difference === "" ||
    (!difference.startsWith(".." + sep) && difference !== ".." && !isAbsolute(difference))
  );
}

function prospectiveRealPath(path: string): string {
  let existing = path;
  const missing: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) {
      break;
    }
    missing.unshift(basename(existing));
    existing = parent;
  }
  return resolve(realpathSync(existing), ...missing);
}

function safeTemporaryPath(project: string, requested: string): string {
  const projectReal = realpathSync(project);
  const candidate = resolve(project, requested);
  if (!pathIsWithin(resolve(project), candidate)) {
    throw new Error("temporary grader path escapes project: " + requested);
  }
  if (!pathIsWithin(projectReal, prospectiveRealPath(candidate))) {
    throw new Error("temporary grader path escapes project: " + requested);
  }
  return candidate;
}

function regex(value: unknown, flags?: string): RegExp {
  return new RegExp(stringValue(value), flags);
}

function quotedList(values: string[]): string {
  return (
    "[" +
    values
      .map((value) => "'" + value.replaceAll("\\", "\\\\").replaceAll("'", "\\'") + "'")
      .join(", ") +
    "]"
  );
}

function matchesRecursiveGlob(path: string, pattern: string): boolean {
  return matchesGlob(path, pattern) || matchesGlob(path, "**/" + pattern);
}

function normalizedAnswerLines(finalText: string): string[] {
  const nonemptyLines = finalText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const first = nonemptyLines[0] ?? "";
  const answerLines =
    /^```(?:text|json|moonbit)?$/i.test(first) && nonemptyLines.length > 1
      ? nonemptyLines.slice(1)
      : nonemptyLines;
  if (answerLines.length === 0) return [];
  const normalized = [...answerLines];
  const inlineCode = normalized[0].match(/^`([^`\r\n]+)`$/);
  if (inlineCode !== null) normalized[0] = inlineCode[1].trim();
  const bold = normalized[0].match(/^\*\*([^*\r\n]+)\*\*$/);
  if (bold !== null) normalized[0] = bold[1].trim();
  return normalized;
}

export function grade(
  check: JsonRecord,
  project: string,
  finalText: string,
  bashCommands: BashResult[],
  initialFiles: Record<string, string>,
  runner: CommandRunner = runCommand,
): GradeResult {
  const kind = stringValue(check.type);
  if (kind === "moon") {
    const temporaryPaths: string[] = [];
    let result: CommandResult;
    try {
      const temporaryFiles = asRecord(check.temp_files);
      for (const [requested, content] of Object.entries(temporaryFiles)) {
        const path = safeTemporaryPath(project, requested);
        if (existsSync(path)) {
          throw new Error("temporary grader path already exists: " + requested);
        }
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, stringValue(content));
        temporaryPaths.push(path);
      }
      result = runner("moon", [...stringArray(check.args), "--no-render"], {
        cwd: project,
        timeout: 600_000,
      });
      if (result.timedOut) {
        throw new Error("moon grader timed out");
      }
    } finally {
      for (const path of temporaryPaths) {
        rmSync(path, { force: true });
      }
    }
    const expectOk = typeof check.expect_ok === "boolean" ? check.expect_ok : true;
    let ok = (result.exitCode === 0) === expectOk;
    const output = result.stdout + result.stderr;
    const testMatch =
      typeof check.min_tests === "number" ? /Total tests:\s*(\d+)/.exec(output) : null;
    let testCountOk: boolean | null = null;
    if (typeof check.min_tests === "number") {
      testCountOk =
        testMatch !== null && Number.parseInt(testMatch[1], 10) >= check.min_tests;
      ok = ok && testCountOk;
    }
    const outputMatches =
      typeof check.output_regex === "string"
        ? regex(check.output_regex, "is").test(output)
        : undefined;
    const outputAvoids =
      typeof check.output_not_regex === "string"
        ? !regex(check.output_not_regex, "is").test(output)
        : undefined;
    if (outputMatches !== undefined) {
      ok = ok && outputMatches;
    }
    if (outputAvoids !== undefined) {
      ok = ok && outputAvoids;
    }
    const argumentsText = stringArray(check.args).join(" ");
    let detail = "moon " + argumentsText + " -> exit " + String(result.exitCode);
    if (typeof check.min_tests === "number") {
      const found = testMatch?.[1] ?? "missing";
      detail +=
        "; tests " +
        found +
        " >= " +
        String(check.min_tests) +
        " -> " +
        String(testCountOk === null ? null : booleanText(testCountOk));
    }
    if (outputMatches !== undefined) {
      detail += `; output ~ /${stringValue(check.output_regex)}/ -> ${booleanText(outputMatches)}`;
    }
    if (outputAvoids !== undefined) {
      detail += `; output !~ /${stringValue(check.output_not_regex)}/ -> ${booleanText(outputAvoids)}`;
    }
    if (!ok) {
      const outputTail = output.trim().slice(-500);
      if (outputTail !== "") {
        detail += "; tail: " + outputTail;
      }
    }
    return { ok, detail };
  }
  if (kind === "file_exists") {
    const path = stringValue(check.path);
    const ok = isFile(join(project, path));
    return { ok, detail: "file_exists " + path + " -> " + booleanText(ok) };
  }
  if (kind === "file_absent") {
    const path = stringValue(check.path);
    const ok = !existsSync(join(project, path));
    return { ok, detail: "file_absent " + path + " -> " + booleanText(ok) };
  }
  if (kind === "file_contains") {
    const path = stringValue(check.path);
    const fullPath = join(project, path);
    const ok = isFile(fullPath) && regex(check.regex).test(readFileSync(fullPath, "utf8"));
    return {
      ok,
      detail:
        "file_contains " + path + " ~ /" + stringValue(check.regex) + "/ -> " + booleanText(ok),
    };
  }
  if (kind === "file_not_contains") {
    const path = stringValue(check.path);
    const fullPath = join(project, path);
    const ok = isFile(fullPath) && !regex(check.regex).test(readFileSync(fullPath, "utf8"));
    return {
      ok,
      detail:
        "file_not_contains " +
        path +
        " !~ /" +
        stringValue(check.regex) +
        "/ -> " +
        booleanText(ok),
    };
  }
  if (kind === "file_match_count") {
    const path = stringValue(check.path);
    const fullPath = join(project, path);
    const pattern = stringValue(check.regex);
    const count =
      isFile(fullPath) && pattern !== ""
        ? [...readFileSync(fullPath, "utf8").matchAll(new RegExp(pattern, "gis"))].length
        : -1;
    const exact = typeof check.exact === "number" ? check.exact : undefined;
    const minimum = typeof check.min === "number" ? check.min : undefined;
    const maximum = typeof check.max === "number" ? check.max : undefined;
    const ok =
      count >= 0 &&
      (exact === undefined || count === exact) &&
      (minimum === undefined || count >= minimum) &&
      (maximum === undefined || count <= maximum) &&
      (exact !== undefined || minimum !== undefined || maximum !== undefined);
    return {
      ok,
      detail:
        `file_match_count ${path} ~ /${pattern}/ -> ${count}` +
        (exact === undefined ? "" : `, exact=${exact}`) +
        (minimum === undefined ? "" : `, min=${minimum}`) +
        (maximum === undefined ? "" : `, max=${maximum}`),
    };
  }
  if (kind === "any_file_contains") {
    const pattern = stringValue(check.glob);
    const expression = regex(check.regex);
    const ok = walkFiles(project)
      .map((path) => relative(project, path))
      .filter((path) => !ignoredSnapshotPath(path))
      .filter((path) => matchesRecursiveGlob(path, pattern))
      .some((path) => expression.test(readFileSync(join(project, path), "utf8")));
    return {
      ok,
      detail:
        "any_file_contains " +
        pattern +
        " ~ /" +
        stringValue(check.regex) +
        "/ -> " +
        booleanText(ok),
    };
  }
  if (kind === "no_file_contains") {
    const pattern = stringValue(check.glob);
    const expression = regex(check.regex, "is");
    const hits = walkFiles(project)
      .map((path) => relative(project, path))
      .filter((path) => !ignoredSnapshotPath(path))
      .filter((path) => matchesRecursiveGlob(path, pattern))
      .filter((path) => expression.test(readFileSync(join(project, path), "utf8")));
    return {
      ok: hits.length === 0,
      detail:
        "no_file_contains " +
        pattern +
        " !~ /" +
        stringValue(check.regex) +
        "/ -> hits=" +
        quotedList(hits),
    };
  }
  if (kind === "output_matches") {
    const ok = regex(check.regex, "is").test(finalText);
    return {
      ok,
      detail: "output_matches /" + stringValue(check.regex) + "/ -> " + booleanText(ok),
    };
  }
  if (kind === "output_not_matches") {
    const ok = !regex(check.regex, "is").test(finalText);
    return {
      ok,
      detail: "output_not_matches /" + stringValue(check.regex) + "/ -> " + booleanText(ok),
    };
  }
  if (kind === "command_matches") {
    const commandRegex = regex(check.regex, "is");
    const outputRegex =
      typeof check.output_regex === "string" ? regex(check.output_regex, "is") : undefined;
    const ok = bashCommands.some(
      (record) =>
        !record.is_error &&
        commandRegex.test(String(record.command ?? "")) &&
        (outputRegex === undefined || outputRegex.test(String(record.output ?? ""))),
    );
    return {
      ok,
      detail: "command_matches /" + stringValue(check.regex) + "/ -> " + booleanText(ok),
    };
  }
  if (kind === "initial_files_unchanged") {
    const currentFiles = snapshotFiles(project);
    const changed = Object.entries(initialFiles)
      .filter(([path, digest]) => currentFiles[path] !== digest)
      .map(([path]) => path)
      .sort();
    const added = Object.keys(currentFiles)
      .filter((path) => !(path in initialFiles))
      .sort();
    const ok = changed.length === 0 && added.length === 0;
    return {
      ok,
      detail:
        "initial_files_unchanged -> " +
        (ok
          ? "True"
          : "changed=" + quotedList(changed) + ", added=" + quotedList(added)),
    };
  }
  if (kind === "first_line_is") {
    const rawFirst =
      finalText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line !== "") ?? "";
    const first = normalizedAnswerLines(finalText)[0] ?? "";
    const expected = stringValue(check.value);
    const ok = first.toUpperCase() === expected.toUpperCase();
    return {
      ok,
      detail:
        "first_line_is " +
        expected +
        " -> got " +
        JSON.stringify(rawFirst.slice(0, 40)) +
        (first === rawFirst ? "" : "; normalized=" + JSON.stringify(first.slice(0, 40))),
    };
  }
  if (kind === "first_line_json_is") {
    const first = normalizedAnswerLines(finalText)[0] ?? "";
    let actual: unknown;
    let parseError: string | null = null;
    try {
      actual = JSON.parse(first);
    } catch (error) {
      parseError = (error as Error).message;
    }
    const ok = parseError === null && isDeepStrictEqual(actual, check.value);
    return {
      ok,
      detail:
        "first_line_json_is " +
        JSON.stringify(check.value) +
        " -> " +
        (parseError === null
          ? JSON.stringify(actual)
          : "parse error: " + parseError + "; got " + JSON.stringify(first.slice(0, 80))),
    };
  }
  if (kind === "first_line_csv_is") {
    const first = normalizedAnswerLines(finalText)[0] ?? "";
    const actual = first.split(",").map((item) => item.trim());
    const expected = stringArray(check.value);
    const ok = isDeepStrictEqual(actual, expected);
    return {
      ok,
      detail:
        "first_line_csv_is " +
        JSON.stringify(expected) +
        " -> " +
        JSON.stringify(actual),
    };
  }
  throw new Error("unknown check type " + JSON.stringify(kind));
}

export function parseStream(stdout: string): ParsedStream {
  return parseClaudeStream(stdout);
}

export function discoveryEvidence(
  parsed: ParsedStream,
  requested?: ContentTask["discovery"],
): DiscoveryEvidence {
  const requestedSkill = requested?.skill ?? null;
  const requestedReference = requested?.reference ?? null;
  const resultsByUse = new Map(
    parsed.tool_results.map((result) => [result.tool_use_id, result]),
  );
  const successfulUses = parsed.tool_uses.filter((toolUse) => {
    const result = resultsByUse.get(toolUse.id);
    return result !== undefined && !result.is_error;
  });
  const skillActivatedSuccessfully =
    requestedSkill === null
      ? null
      : successfulUses.some(
          (toolUse) =>
            toolUse.name === "Skill" &&
            stringValue(asRecord(toolUse.input).skill) === requestedSkill,
        );
  const referenceUses =
    requestedReference === null
      ? []
      : successfulUses.filter(
          (toolUse) =>
            (toolUse.name === "Read" || toolUse.name === "Grep") &&
            JSON.stringify(toolUse.input).includes(requestedReference),
        );
  const referenceReadSuccessfully =
    requestedReference === null ? null : referenceUses.length > 0;
  const actionTools = new Set(["Bash", "Edit", "Write"]);
  const firstActionEvent = parsed.tool_uses
    .filter((toolUse) => actionTools.has(toolUse.name))
    .map((toolUse) => toolUse.event_index)
    .sort((left, right) => left - right)[0];
  const referenceReadBeforeAction =
    requestedReference === null
      ? null
      : referenceUses.some((referenceUse) => {
          const result = resultsByUse.get(referenceUse.id);
          if (result === undefined) return false;
          return firstActionEvent === undefined
            ? parsed.final_text !== ""
            : result.event_index < firstActionEvent;
        });
  return {
    requested_skill: requestedSkill,
    requested_reference: requestedReference,
    skill_activated_successfully: skillActivatedSuccessfully,
    reference_read_successfully: referenceReadSuccessfully,
    reference_read_before_action: referenceReadBeforeAction,
  };
}

function loadTask(taskDirectory: string): ContentTask {
  const task = JSON.parse(
    readFileSync(join(taskDirectory, "task.json"), "utf8"),
  ) as ContentTask;
  if (
    task.id !== basename(taskDirectory) ||
    typeof task.prompt !== "string" ||
    !Array.isArray(task.grade)
  ) {
    throw new Error(join(taskDirectory, "task.json") + ": invalid content task");
  }
  const metadata = [task.claim_id, task.risk_class, task.primary_metric];
  const present = metadata.filter((value) => typeof value === "string" && value !== "").length;
  if (present !== 0 && present !== metadata.length) {
    throw new Error(
      join(taskDirectory, "task.json") +
        ": claim_id, risk_class, and primary_metric must be provided together",
    );
  }
  return task;
}

function failedWorkspaceFilter(root: string, sourcePath: string): boolean {
  const path = relative(root, sourcePath);
  return !path
    .split(sep)
    .some((part) => part === "_build" || part === ".claude");
}

export function runTask(
  taskDirectory: string,
  condition: string,
  model: string,
  maxTurns: number,
  cacheDir: string,
  runDir: string,
  runner: CommandRunner = runCommand,
  skillSources: SkillSources = { current: SKILLS_SRC },
  client: AgentClient = "claude-code",
  maxBudgetUsd?: number,
  repetition = 0,
): JsonRecord {
  const task = loadTask(taskDirectory);
  const temporary = mkdtempSync(join(tmpdir(), "mbteval-"));
  let resultArtifact: JsonRecord;
  try {
    const project = join(temporary, "project");
    const workspace = join(taskDirectory, "workspace");
    if (isDirectory(workspace)) {
      copyTreeExclusive(workspace, project);
    } else {
      mkdirSync(project);
    }
    const initialFiles = snapshotFiles(project);
    const prefix = installCondition(project, condition, cacheDir, runner, skillSources);
    const skillsDirectory = join(project, ".claude", "skills");
    mkdirSync(skillsDirectory, { recursive: true });
    const claudeConfigDirectory = join(temporary, "claude-config");
    mkdirSync(claudeConfigDirectory);
    const invocation = buildAgentInvocation({
      client,
      prompt: prefix + task.prompt,
      model,
      maxTurns,
      skillsDir: skillsDirectory,
      allowedTools: ALLOWED_TOOLS.split(","),
      disallowedTools: DISALLOWED_TOOLS.split(","),
      claudeConfigDir: claudeConfigDirectory,
      maxBudgetUsd,
    });
    const processResult = runner(invocation.command, invocation.args, {
      cwd: project,
      timeout: 1_800_000,
      env: invocation.environment,
    });

    const artifactStem =
      task.id + "--r" + String(repetition + 1).padStart(2, "0") + "--" + condition;
    const transcriptsDir = join(runDir, "transcripts");
    mkdirSync(transcriptsDir, { recursive: true });
    const transcriptPath = join(transcriptsDir, artifactStem + ".jsonl");
    const stderrPath = join(transcriptsDir, artifactStem + ".stderr.txt");
    writeFileSync(transcriptPath, processResult.stdout);
    writeFileSync(stderrPath, processResult.stderr);

    const parsed = parseAgentStream(client, processResult.stdout);
    if (client === "kimi-code") enrichKimiStream(parsed);
    const discovery = discoveryEvidence(parsed, task.discovery);
    const checks = task.grade.map((check) => {
      const result = grade(
        check,
        project,
        parsed.final_text,
        parsed.bash_results,
        initialFiles,
        runner,
      );
      return { check, ok: result.ok, detail: result.detail };
    });
    const forbiddenTools = new Set(DISALLOWED_TOOLS.split(","));
    const observedForbiddenTools = [
      ...new Set(
        parsed.tool_uses.map((use) => use.name).filter((name) => forbiddenTools.has(name)),
      ),
    ].sort();
    checks.push({
      check: { type: "forbidden_tool_use" },
      ok: observedForbiddenTools.length === 0,
      detail:
        observedForbiddenTools.length === 0
          ? "forbidden_tool_use -> False"
          : "forbidden_tool_use -> " + quotedList(observedForbiddenTools),
    });
    const clientOk =
      clientRunSucceeded(
        client,
        parsed,
        processResult.exitCode,
        processResult.timedOut,
      ) && parsed.num_turns <= maxTurns;
    checks.push({
      check: { type: "client_exit" },
      ok: clientOk,
      detail:
        client +
        " exit " +
        String(processResult.exitCode) +
        "; timed_out=" +
        booleanText(processResult.timedOut) +
        "; result_subtype=" +
        String(parsed.result_subtype) +
        "; observed_steps=" +
        String(parsed.num_turns) +
        "; step_limit=" +
        String(maxTurns),
    });
    const passed = checks.every((check) => check.ok);
    let failedWorkspace: string | null = null;
    if (!passed) {
      const failedDirectory = join(runDir, "failed-workspaces", artifactStem);
      mkdirSync(dirname(failedDirectory), { recursive: true });
      copyTreeExclusive(project, failedDirectory, (sourcePath) =>
        failedWorkspaceFilter(project, sourcePath),
      );
      failedWorkspace = relative(runDir, failedDirectory);
    }

    resultArtifact = {
      id: task.id,
      claim_id: task.claim_id ?? null,
      risk_class: task.risk_class ?? null,
      primary_metric: task.primary_metric ?? null,
      condition,
      client,
      passed,
      checks,
      activated_skills: parsed.activated_skills,
      successful_skills: parsed.successful_skills,
      discovery,
      usage: parsed.usage,
      model_usage: parsed.model_usage,
      emitted_models: parsed.emitted_models,
      model_aliases: parsed.model_aliases,
      providers: parsed.providers,
      thinking_efforts: parsed.thinking_efforts,
      init_model: parsed.init_model,
      session_id: parsed.session_id,
      exit_code: processResult.exitCode,
      timed_out: processResult.timedOut,
      duration_ms: processResult.durationMs ?? null,
      tool_uses: parsed.tool_uses,
      tool_results: parsed.tool_results,
      bash_results: parsed.bash_results,
      transcript: relative(runDir, transcriptPath),
      stderr: relative(runDir, stderrPath),
      failed_workspace: failedWorkspace,
      final_text: parsed.final_text,
      final_text_tail: parsed.final_text.slice(-500),
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  return resultArtifact;
}

export function findExecutable(tool: string, environment = process.env): string | undefined {
  const pathValue = environment.PATH;
  if (!pathValue) {
    return undefined;
  }
  const extensions =
    platform() === "win32"
      ? (environment.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")
      : [""];
  for (const directory of pathValue.split(delimiter)) {
    for (const extension of extensions) {
      const candidate = join(directory, tool + extension);
      try {
        accessSync(candidate, constants.X_OK);
        if (isFile(candidate)) {
          return candidate;
        }
      } catch {
        continue;
      }
    }
  }
  return undefined;
}

export function currentPlatform(): string {
  return type() + "-" + release() + "-" + arch();
}

export function preflight(
  runner: CommandRunner = runCommand,
  locate: (tool: string) => string | undefined = findExecutable,
  platformName: () => string = currentPlatform,
  environment = process.env,
  client: AgentClient = "claude-code",
): JsonRecord {
  const executable = clientExecutable(client);
  const missing = [executable, "moon", "node", "git"].filter(
    (tool) => locate(tool) === undefined,
  );
  if (missing.length > 0) {
    throw new Error("required tool(s) missing from PATH: " + missing.join(", "));
  }
  const moonVersion = checkedOutput(runner, "moon", ["version", "--all"]) + "\n";
  const expected = JSON.parse(
    readFileSync(join(REPO_ROOT, "verification", "toolchains", "current.json"), "utf8"),
  ) as { components: Array<{ raw: string }> };
  const mismatches = expected.components
    .map((component) => component.raw)
    .filter((raw) => !moonVersion.includes(raw));
  if (mismatches.length > 0) {
    throw new Error(
      "MoonBit toolchain differs from verification/toolchains/current.json; " +
        "missing expected version line(s): " +
        mismatches.join(","),
    );
  }
  const modelEnvironment =
    client === "claude-code"
      ? Object.fromEntries(
          [
            "ANTHROPIC_MODEL",
            "ANTHROPIC_DEFAULT_HAIKU_MODEL",
            "ANTHROPIC_DEFAULT_SONNET_MODEL",
            "ANTHROPIC_DEFAULT_OPUS_MODEL",
            "CLAUDE_CODE_SUBAGENT_MODEL",
            "CLAUDE_CODE_EFFORT_LEVEL",
          ]
            .filter((name) => Boolean(environment[name]))
            .map((name) => [name, environment[name]]),
        )
      : {};
  let providerOrigin: string | null = null;
  if (client === "claude-code" && environment.ANTHROPIC_BASE_URL) {
    try {
      providerOrigin = new URL(environment.ANTHROPIC_BASE_URL).origin;
    } catch {
      providerOrigin = "invalid ANTHROPIC_BASE_URL";
    }
  }
  return {
    agent_client: client,
    client: checkedOutput(runner, executable, ["--version"]),
    node_version: checkedOutput(runner, "node", ["--version"]),
    moon_version_all: moonVersion.trim(),
    platform: platformName(),
    official_skills_commit: OFFICIAL_COMMIT,
    model_environment: modelEnvironment,
    provider_origin: providerOrigin,
    model_observability:
      client === "claude-code"
        ? "stream events plus model usage"
        : "Kimi session wire whitelist",
    billing: client === "claude-code" ? "API" : "subscription; USD unavailable",
  };
}

export function ensureRunManifest(
  runDir: string,
  config: JsonRecord,
  hasResults: boolean,
): void {
  const manifestPath = join(runDir, "run.json");
  if (existsSync(manifestPath)) {
    const previous = JSON.parse(readFileSync(manifestPath, "utf8")) as JsonRecord;
    if (!isDeepStrictEqual(previous, config)) {
      const differing = [...new Set([...Object.keys(previous), ...Object.keys(config)])]
        .filter((key) => !isDeepStrictEqual(previous[key], config[key]))
        .sort();
      throw new Error(
        "run configuration differs from existing run.json for: " +
          differing.join(", ") +
          "; use a fresh --run-name",
      );
    }
    return;
  }
  if (hasResults) {
    throw new Error("cannot safely resume results without run.json; use a fresh --run-name");
  }
  writeFileSync(manifestPath, JSON.stringify(config, null, 2) + "\n");
}

function loadContentExperiment(pathValue: string): {
  experiment: ContentExperiment;
  disclosure: JsonRecord;
} {
  const experimentsRoot = join(HERE, "experiments");
  const path = resolve(REPO_ROOT, pathValue);
  const fromRoot = relative(experimentsRoot, path);
  if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error("--experiment must name a JSON file under evals/experiments/");
  }
  const experiment = JSON.parse(readFileSync(path, "utf8")) as ContentExperiment;
  if (
    experiment.schema_version !== 1 ||
    experiment.runner !== "content" ||
    !/^[a-zA-Z0-9._-]+$/.test(experiment.id) ||
    (experiment.stage !== "exploratory" && experiment.stage !== "confirmatory") ||
    (experiment.area !== "language" &&
      experiment.area !== "toolchain" &&
      experiment.area !== "integration") ||
    (experiment.client !== "claude-code" && experiment.client !== "kimi-code") ||
    !Array.isArray(experiment.conditions) ||
    experiment.conditions.length < 2 ||
    !Array.isArray(experiment.task_ids) ||
    experiment.task_ids.length === 0 ||
    !Number.isInteger(experiment.repetitions) ||
    experiment.repetitions < 1 ||
    !Number.isInteger(experiment.max_turns) ||
    experiment.max_turns < 1 ||
    typeof experiment.primary_metric !== "string" ||
    typeof experiment.stopping_rule !== "string" ||
    typeof experiment.minimum_valuable_difference !== "number" ||
    experiment.minimum_valuable_difference <= 0 ||
    experiment.minimum_valuable_difference > 1
  ) {
    throw new Error(pathValue + ": invalid content experiment manifest");
  }
  if (new Set(experiment.conditions).size !== experiment.conditions.length) {
    throw new Error(pathValue + ": duplicate experiment conditions");
  }
  if (new Set(experiment.task_ids).size !== experiment.task_ids.length) {
    throw new Error(pathValue + ": duplicate experiment task ids");
  }
  if (experiment.task_groups !== undefined) {
    const entries = Object.entries(experiment.task_groups);
    if (
      entries.length === 0 ||
      entries.some(
        ([name, ids]) =>
          !/^[a-zA-Z0-9._-]+$/.test(name) ||
          !Array.isArray(ids) ||
          ids.length === 0 ||
          ids.some((id) => typeof id !== "string"),
      )
    ) {
      throw new Error(pathValue + ": invalid experiment task_groups");
    }
    const grouped = entries.flatMap(([, ids]) => ids);
    if (
      new Set(grouped).size !== grouped.length ||
      grouped.length !== experiment.task_ids.length ||
      [...grouped].sort().join("\n") !== [...experiment.task_ids].sort().join("\n")
    ) {
      throw new Error(
        pathValue + ": task_groups must partition task_ids exactly once",
      );
    }
  }
  if (
    experiment.client === "claude-code" &&
    (typeof experiment.paid_budget_usd !== "number" || experiment.paid_budget_usd <= 0)
  ) {
    throw new Error(pathValue + ": Claude experiment needs a positive paid_budget_usd");
  }
  if (experiment.client === "kimi-code" && experiment.paid_budget_usd !== null) {
    throw new Error(pathValue + ": Kimi experiment paid_budget_usd must be null");
  }
  return {
    experiment,
    disclosure: {
      path: relative(REPO_ROOT, path),
      sha256: fileDigest(path),
      manifest: experiment,
    },
  };
}

function parseCli(argv: string[]): { options?: CliOptions; exitCode?: number } {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(DESCRIPTION + "\n\n" + USAGE);
    return { exitCode: 0 };
  }
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        area: { type: "string" },
        client: { type: "string", default: "claude-code" },
        condition: { type: "string", multiple: true },
        experiment: { type: "string" },
        ids: { type: "string" },
        model: { type: "string" },
        "max-turns": { type: "string", default: "50" },
        "paid-budget-usd": { type: "string" },
        repetitions: { type: "string", default: "1" },
        "run-name": { type: "string" },
        resume: { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
      },
      strict: true,
      allowPositionals: false,
    });
  } catch (error) {
    console.error(USAGE);
    console.error("error: " + (error as Error).message);
    return { exitCode: 2 };
  }
  if (typeof parsed.values.experiment === "string") {
    const conflicting = [
      "--area",
      "--client",
      "--condition",
      "--ids",
      "--max-turns",
      "--model",
      "--paid-budget-usd",
      "--repetitions",
    ].filter((flag) => argv.includes(flag));
    if (conflicting.length > 0) {
      console.error(USAGE);
      console.error(
        "error: --experiment cannot be combined with " + conflicting.join(", "),
      );
      return { exitCode: 2 };
    }
    try {
      const loaded = loadContentExperiment(parsed.values.experiment);
      const experiment = loaded.experiment;
      const runNameValue = parsed.values["run-name"];
      const runName = typeof runNameValue === "string" ? runNameValue : experiment.id;
      if (!/^[a-zA-Z0-9._-]+$/.test(runName)) {
        throw new Error(
          "--run-name may contain only letters, digits, dot, underscore, and hyphen",
        );
      }
      return {
        options: {
          area: experiment.area,
          client: experiment.client,
          conditions: experiment.conditions,
          ids: experiment.task_ids.join(","),
          model: experiment.model,
          maxTurns: experiment.max_turns,
          paidBudgetUsd: experiment.paid_budget_usd ?? undefined,
          repetitions: experiment.repetitions,
          runName,
          resume: parsed.values.resume === true,
          dryRun: parsed.values["dry-run"] === true,
          experiment: loaded.disclosure,
        },
      };
    } catch (error) {
      console.error(USAGE);
      console.error("error: " + (error as Error).message);
      return { exitCode: 2 };
    }
  }
  const area = parsed.values.area;
  if (area !== "language" && area !== "toolchain" && area !== "integration") {
    console.error(USAGE);
    console.error("error: --area must be language, toolchain, or integration");
    return { exitCode: 2 };
  }
  const conditionsValue = parsed.values.condition;
  if (
    !Array.isArray(conditionsValue) ||
    conditionsValue.length === 0 ||
    conditionsValue.some((condition) => typeof condition !== "string")
  ) {
    console.error(USAGE);
    console.error("error: at least one --condition is required");
    return { exitCode: 2 };
  }
  const conditions = conditionsValue as string[];
  const clientValue = parsed.values.client;
  if (clientValue !== "claude-code" && clientValue !== "kimi-code") {
    console.error(USAGE);
    console.error("error: --client must be claude-code or kimi-code");
    return { exitCode: 2 };
  }
  const maxTurnsValue = parsed.values["max-turns"];
  const maxTurns = Number.parseInt(
    typeof maxTurnsValue === "string" ? maxTurnsValue : "",
    10,
  );
  if (!Number.isInteger(maxTurns) || maxTurns < 1) {
    console.error(USAGE);
    console.error("error: --max-turns must be a positive integer");
    return { exitCode: 2 };
  }
  const repetitionsValue = parsed.values.repetitions;
  const repetitions = Number.parseInt(
    typeof repetitionsValue === "string" ? repetitionsValue : "",
    10,
  );
  if (!Number.isInteger(repetitions) || repetitions < 1) {
    console.error(USAGE);
    console.error("error: --repetitions must be a positive integer");
    return { exitCode: 2 };
  }
  const paidBudgetValue = parsed.values["paid-budget-usd"];
  const paidBudgetUsd =
    typeof paidBudgetValue === "string" ? Number(paidBudgetValue) : undefined;
  if (
    paidBudgetUsd !== undefined &&
    (!Number.isFinite(paidBudgetUsd) || paidBudgetUsd <= 0)
  ) {
    console.error(USAGE);
    console.error("error: --paid-budget-usd must be a positive number");
    return { exitCode: 2 };
  }
  const ids = parsed.values.ids;
  const model = parsed.values.model;
  const runName = parsed.values["run-name"];
  const resume = parsed.values.resume;
  const dryRun = parsed.values["dry-run"];
  return {
    options: {
      area,
      client: clientValue,
      conditions,
      ids: typeof ids === "string" ? ids : undefined,
      model:
        typeof model === "string"
          ? model
          : clientValue === "kimi-code"
            ? "kimi-code/k3"
            : "haiku",
      maxTurns,
      paidBudgetUsd,
      repetitions,
      runName: typeof runName === "string" ? runName : undefined,
      resume: typeof resume === "boolean" ? resume : false,
      dryRun: typeof dryRun === "boolean" ? dryRun : false,
    },
  };
}

export function main(argv = process.argv.slice(2)): number {
  const cli = parseCli(argv);
  if (cli.exitCode !== undefined) {
    return cli.exitCode;
  }
  const options = cli.options as CliOptions;
  if (new Set(options.conditions).size !== options.conditions.length) {
    throw new Error("duplicate --condition values are not allowed");
  }
  const unknownConditions = [...new Set(options.conditions)]
    .filter((condition) => !VALID_CONDITIONS.has(condition))
    .sort();
  if (unknownConditions.length > 0) {
    throw new Error("unknown condition(s): " + unknownConditions.join(", "));
  }

  const tasksDirectory = join(HERE, options.area, "tasks");
  let taskDirectories = readdirSync(tasksDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(tasksDirectory, entry.name))
    .filter((directory) => isFile(join(directory, "task.json")))
    .sort();
  if (options.ids !== undefined) {
    const wanted = new Set(options.ids.split(","));
    taskDirectories = taskDirectories.filter((directory) => wanted.has(basename(directory)));
    const found = new Set(taskDirectories.map((directory) => basename(directory)));
    const missing = [...wanted].filter((id) => !found.has(id)).sort();
    if (missing.length > 0) {
      throw new Error("unknown task id(s): " + missing.join(", "));
    }
  }
  if (taskDirectories.length === 0) {
    throw new Error("no tasks selected");
  }
  const taskDefinitions = Object.fromEntries(
    taskDirectories.map((directory) => {
      const task = loadTask(directory);
      return [task.id, task];
    }),
  );
  if (
    options.experiment !== undefined &&
    Object.values(taskDefinitions).some(
      (task) =>
        task.claim_id === undefined ||
        task.risk_class === undefined ||
        task.primary_metric === undefined,
    )
  ) {
    throw new Error(
      "experiment tasks require claim_id, risk_class, and primary_metric",
    );
  }
  if (options.dryRun) {
    console.log(String(taskDirectories.length) + " task(s) valid");
    return 0;
  }
  if (options.client === "claude-code" && options.paidBudgetUsd === undefined) {
    throw new Error("Claude Code runs require an explicit --paid-budget-usd total budget");
  }
  if (options.client === "kimi-code" && options.paidBudgetUsd !== undefined) {
    throw new Error("Kimi subscription runs do not accept --paid-budget-usd");
  }

  const environment = preflight(
    runCommand,
    findExecutable,
    currentPlatform,
    process.env,
    options.client,
  );
  const isolation =
    options.client === "claude-code"
      ? catalogIsolation()
      : {
          mechanism: "kimi --skills-dir replaces automatic skill discovery",
          global_skill_scan_required: false,
        };
  const runName =
    options.runName ?? options.client + "-" + options.model.replaceAll("/", "-");
  const runDirectory = join(HERE, options.area, "runs", runName);
  mkdirSync(runDirectory, { recursive: true });
  const cacheDirectory = join(runDirectory, "_cache");
  mkdirSync(cacheDirectory, { recursive: true });
  const needsSkillSnapshots = options.conditions.some(
    (condition) =>
      condition === "baseline" ||
      condition === "ours" ||
      condition.startsWith("ours-") ||
      condition.startsWith("forced-"),
  );
  const preparedSkills = needsSkillSnapshots
    ? prepareSkillSnapshots(cacheDirectory)
    : undefined;
  const skillSources = preparedSkills?.sources ?? { current: SKILLS_SRC };
  const derivedConditionSnapshots = prepareDerivedConditionSnapshots(
    cacheDirectory,
    options.conditions,
    skillSources,
  );

  const resultsPath = join(runDirectory, "results.jsonl");
  if (existsSync(resultsPath) && !options.resume) {
    throw new Error(
      resultsPath + " already exists; use a fresh --run-name or --resume",
    );
  }
  const runConfig = {
    runner: "content-paired-v2",
    area: options.area,
    client: options.client,
    conditions: options.conditions,
    repetitions: options.repetitions,
    condition_order: "AB/BA counterbalanced by task and repetition",
    tasks: Object.fromEntries(
      taskDirectories.map((directory) => [basename(directory), snapshotFiles(directory)]),
    ),
    task_metadata: Object.fromEntries(
      Object.entries(taskDefinitions).map(([id, task]) => [
        id,
        {
          claim_id: task.claim_id ?? null,
          risk_class: task.risk_class ?? null,
          primary_metric: task.primary_metric ?? null,
        },
      ]),
    ),
    model: options.model,
    max_turns: options.maxTurns,
    paid_budget_usd: options.paidBudgetUsd ?? null,
    experiment: options.experiment ?? null,
    environment,
    catalog_isolation: isolation,
    skill_snapshots: preparedSkills?.manifest ?? null,
    derived_condition_snapshots: derivedConditionSnapshots,
    runner_files: {
      "evals/run_content.ts": fileDigest(fileURLToPath(import.meta.url)),
      "evals/lib/agent_cli.ts": fileDigest(join(HERE, "lib", "agent_cli.ts")),
      "evals/lib/paired_stats.ts": fileDigest(join(HERE, "lib", "paired_stats.ts")),
    },
  };
  ensureRunManifest(runDirectory, runConfig, existsSync(resultsPath));

  const previousResults = existsSync(resultsPath)
    ? readFileSync(resultsPath, "utf8")
        .split(/\r?\n/)
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as JsonRecord)
    : [];
  const completed = new Set(
    previousResults.map((result) =>
      JSON.stringify([
        stringValue(result.id),
        Number(result.repetition ?? 0),
        stringValue(result.condition),
      ]),
    ),
  );
  const results = [...previousResults];
  let spentUsd = results.reduce((total, result) => {
    const cost = asRecord(result.usage).total_cost_usd;
    return total + (typeof cost === "number" ? cost : 0);
  }, 0);
  for (let repetition = 0; repetition < options.repetitions; repetition += 1) {
    for (const [taskIndex, taskDirectory] of taskDirectories.entries()) {
      const orderedConditions =
        (taskIndex + repetition) % 2 === 0
          ? options.conditions
          : [...options.conditions].reverse();
      for (const [orderIndex, condition] of orderedConditions.entries()) {
        const completedKey = JSON.stringify([
          basename(taskDirectory),
          repetition,
          condition,
        ]);
        const label =
          basename(taskDirectory) +
          " [r" +
          String(repetition + 1) +
          ", " +
          condition +
          "]";
        if (completed.has(completedKey)) {
          console.log(label + " ... already complete");
          continue;
        }
        const remainingBudget =
          options.paidBudgetUsd === undefined
            ? undefined
            : Number((options.paidBudgetUsd - spentUsd).toFixed(6));
        if (remainingBudget !== undefined && remainingBudget <= 0) {
          throw new Error(
            "paid experiment budget exhausted before " +
              label +
              "; resume with a larger --paid-budget-usd only in a fresh run",
          );
        }
        console.log(label + " ...");
        const result = runTask(
          taskDirectory,
          condition,
          options.model,
          options.maxTurns,
          cacheDirectory,
          runDirectory,
          runCommand,
          skillSources,
          options.client,
          remainingBudget,
          repetition,
        );
        result.repetition = repetition;
        result.pair_id = basename(taskDirectory) + "--r" + String(repetition + 1);
        result.condition_order = orderedConditions;
        result.order_index = orderIndex;
        results.push(result);
        appendFileSync(resultsPath, JSON.stringify(result) + "\n");
        const cost = asRecord(result.usage).total_cost_usd;
        if (typeof cost === "number") spentUsd += cost;
        console.log("    " + (result.passed ? "PASS" : "FAIL"));
      }
    }
  }

  const byCondition = new Map<string, JsonRecord[]>();
  for (const result of results) {
    const condition = stringValue(result.condition);
    const items = byCondition.get(condition) ?? [];
    items.push(result);
    byCondition.set(condition, items);
  }
  const resolvedModels = [
    ...new Set(
      results.flatMap((result) => Object.keys(asRecord(result.model_usage))),
    ),
  ].sort();
  const emittedModels = [
    ...new Set(
      results.flatMap((result) =>
        Array.isArray(result.emitted_models)
          ? result.emitted_models.filter((model): model is string => typeof model === "string")
          : [],
      ),
    ),
  ].sort();
  const passRateByCondition = Object.fromEntries(
    [...byCondition.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([condition, items]) => [
        condition,
        String(items.filter((item) => item.passed === true).length) +
          "/" +
          String(items.length),
      ]),
  );
  const totalCost = results.reduce((total, result) => {
    const usage = asRecord(result.usage);
    return total + (typeof usage.total_cost_usd === "number" ? usage.total_cost_usd : 0);
  }, 0);
  const totalInputTokens = results.reduce((total, result) => {
    const value = asRecord(result.usage).input_tokens;
    return total + (typeof value === "number" ? value : 0);
  }, 0);
  const totalOutputTokens = results.reduce((total, result) => {
    const value = asRecord(result.usage).output_tokens;
    return total + (typeof value === "number" ? value : 0);
  }, 0);
  const discoveryByCondition = Object.fromEntries(
    [...byCondition.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([condition, items]) => {
        const evidence = items
          .map((item) => asRecord(item.discovery))
          .filter(
            (item) =>
              item.requested_skill !== null || item.requested_reference !== null,
          );
        const rate = (field: string): string => {
          const applicable = evidence.filter((item) => typeof item[field] === "boolean");
          return (
            String(applicable.filter((item) => item[field] === true).length) +
            "/" +
            String(applicable.length)
          );
        };
        return [
          condition,
          {
            skill_activation: rate("skill_activated_successfully"),
            reference_read: rate("reference_read_successfully"),
            reference_before_action: rate("reference_read_before_action"),
          },
        ];
      }),
  );
  const pairableResults = results.map((result): PairableResult => ({
    id: stringValue(result.id),
    condition: stringValue(result.condition),
    repetition: typeof result.repetition === "number" ? result.repetition : 0,
    passed: result.passed === true,
    emitted_models: Array.isArray(result.emitted_models)
      ? result.emitted_models.filter(
          (model): model is string => typeof model === "string",
        )
      : [],
    duration_ms: typeof result.duration_ms === "number" ? result.duration_ms : null,
    usage: asRecord(result.usage),
  }));
  const pairedComparisons = (taskIds?: Set<string>): ReturnType<typeof pairedSummary>[] =>
    options.conditions.flatMap((left, leftIndex) =>
      options.conditions.slice(leftIndex + 1).map((right) =>
        pairedSummary(
          taskIds === undefined
            ? pairableResults
            : pairableResults.filter((result) => taskIds.has(result.id)),
          left,
          right,
        ),
      ),
    );
  const experimentManifest = asRecord(asRecord(options.experiment).manifest);
  const taskGroups = asRecord(experimentManifest.task_groups);
  const summary = {
    runner: "content-paired-v2",
    area: options.area,
    client: options.client,
    model: options.model,
    max_turns: options.maxTurns,
    repetitions: options.repetitions,
    environment,
    resolved_models: resolvedModels,
    emitted_models: emittedModels,
    pass_rate_by_condition: passRateByCondition,
    discovery_by_condition: discoveryByCondition,
    paired_comparisons: pairedComparisons(),
    paired_comparisons_by_task_group: Object.fromEntries(
      Object.entries(taskGroups).map(([name, ids]) => [
        name,
        pairedComparisons(new Set(stringArray(ids))),
      ]),
    ),
    usage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_cost_usd:
        options.client === "claude-code" ? Number(totalCost.toFixed(6)) : null,
      billing:
        options.client === "claude-code" ? "API" : "subscription; USD unavailable",
    },
  };
  writeFileSync(join(runDirectory, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}

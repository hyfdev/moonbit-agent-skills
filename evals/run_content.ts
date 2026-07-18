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

const DESCRIPTION =
  "Content eval: compare agent outcomes across MoonBit knowledge conditions in isolated contexts.";
const USAGE =
  "Usage: node evals/run_content.ts --area language|toolchain|integration " +
  "--condition CONDITION [--condition CONDITION ...] [--ids ID,ID] " +
  "[--model ID] [--max-turns N] [--run-name NAME] [--resume] [--dry-run]";

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

export const ALLOWED_TOOLS = "Bash,Edit,Write,Read,Glob,Grep";
export const DISALLOWED_TOOLS = "WebFetch,WebSearch,Task";
export const VALID_CONDITIONS = new Set([
  "none",
  "official",
  "baseline",
  "ours",
  "forced-language",
  "forced-language-no-cross-language",
  "forced-toolchain",
]);

export type Area = "language" | "toolchain" | "integration";
export type JsonRecord = Record<string, unknown>;

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options?: { cwd?: string; timeout?: number },
) => CommandResult;

export interface BashResult {
  command: string;
  is_error: boolean;
  output: string;
}

export interface ParsedStream {
  final_text: string;
  activated_skills: string[];
  successful_skills: string[];
  bash_results: BashResult[];
  tool_uses: ToolUseRecord[];
  tool_results: ToolResultRecord[];
  emitted_models: string[];
  usage: JsonRecord;
  model_usage: JsonRecord;
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

export interface GradeResult {
  ok: boolean;
  detail: string;
}

export interface ContentTask {
  id: string;
  prompt: string;
  grade: JsonRecord[];
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

export interface DiscoveryEvidence {
  requested_skill: string | null;
  requested_reference: string | null;
  skill_activated_successfully: boolean | null;
  reference_read_successfully: boolean | null;
  reference_read_before_action: boolean | null;
}

interface CliOptions {
  area: Area;
  conditions: string[];
  ids?: string;
  model: string;
  maxTurns: number;
  runName?: string;
  resume: boolean;
  dryRun: boolean;
}

export const runCommand: CommandRunner = (command, args, options = {}) => {
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
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
    const first = finalText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line !== "") ?? "";
    const expected = stringValue(check.value);
    const ok = first.toUpperCase() === expected.toUpperCase();
    return {
      ok,
      detail: "first_line_is " + expected + " -> got " + JSON.stringify(first.slice(0, 40)),
    };
  }
  throw new Error("unknown check type " + JSON.stringify(kind));
}

export function parseStream(stdout: string): ParsedStream {
  const parsed: ParsedStream = {
    final_text: "",
    activated_skills: [],
    successful_skills: [],
    bash_results: [],
    tool_uses: [],
    tool_results: [],
    emitted_models: [],
    usage: {},
    model_usage: {},
  };
  const toolUsesById = new Map<string, ToolUseRecord>();
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
    if (event.type === "assistant") {
      assistantTurn += 1;
      const message = asRecord(event.message);
      const emittedModel = stringValue(message.model);
      if (emittedModel !== "") {
        parsed.emitted_models.push(emittedModel);
      }
      const content = Array.isArray(message.content) ? message.content : [];
      for (const rawBlock of content) {
        const block = asRecord(rawBlock);
        if (block.type !== "tool_use") {
          continue;
        }
        const name = stringValue(block.name);
        const input = block.input ?? {};
        const id = stringValue(block.id);
        const toolUse = { id, name, input, assistant_turn: assistantTurn, event_index: eventIndex };
        parsed.tool_uses.push(toolUse);
        if (id !== "") {
          toolUsesById.set(id, toolUse);
        }
        const inputs = asRecord(input);
        if (name === "Skill") {
          parsed.activated_skills.push(stringValue(inputs.skill));
        }
      }
    } else if (event.type === "user") {
      const message = asRecord(event.message);
      const content = Array.isArray(message.content) ? message.content : [];
      for (const rawBlock of content) {
        const block = asRecord(rawBlock);
        if (block.type !== "tool_result") {
          continue;
        }
        const toolId = stringValue(block.tool_use_id);
        if (toolId === "") {
          continue;
        }
        const contentValue = block.content ?? "";
        const output =
          typeof contentValue === "string" ? contentValue : JSON.stringify(contentValue);
        const isError = Boolean(block.is_error ?? false);
        parsed.tool_results.push({
          tool_use_id: toolId,
          is_error: isError,
          output,
          event_index: eventIndex,
        });
        const toolUse = toolUsesById.get(toolId);
        if (toolUse?.name === "Bash") {
          parsed.bash_results.push({
            command: stringValue(asRecord(toolUse.input).command),
            is_error: isError,
            output,
          });
        }
        if (toolUse?.name === "Skill" && !isError) {
          const skill = stringValue(asRecord(toolUse.input).skill);
          if (skill !== "") {
            parsed.successful_skills.push(skill);
          }
        }
      }
    } else if (event.type === "result") {
      parsed.final_text = stringValue(event.result);
      parsed.usage = { ...asRecord(event.usage) };
      parsed.usage.total_cost_usd = event.total_cost_usd;
      parsed.usage.num_turns = event.num_turns;
      parsed.model_usage = asRecord(event.modelUsage);
    }
  }
  parsed.activated_skills = [...new Set(parsed.activated_skills)];
  parsed.successful_skills = [...new Set(parsed.successful_skills)];
  parsed.emitted_models = [...new Set(parsed.emitted_models)];
  return parsed;
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
  const referenceReadBeforeAction =
    requestedReference === null
      ? null
      : referenceUses.some((referenceUse) => {
          const result = resultsByUse.get(referenceUse.id);
          return parsed.tool_uses.some(
            (toolUse) =>
              actionTools.has(toolUse.name) &&
              toolUse.assistant_turn > referenceUse.assistant_turn &&
              result !== undefined &&
              toolUse.event_index > result.event_index,
          );
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
  return JSON.parse(readFileSync(join(taskDirectory, "task.json"), "utf8")) as ContentTask;
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
    const command = [
      "-p",
      prefix + task.prompt,
      "--model",
      model,
      "--output-format",
      "stream-json",
      "--verbose",
      "--max-turns",
      String(maxTurns),
      "--strict-mcp-config",
      "--allowedTools",
      ALLOWED_TOOLS,
      "--disallowedTools",
      DISALLOWED_TOOLS,
    ];
    const processResult = runner("claude", command, {
      cwd: project,
      timeout: 1_800_000,
    });

    const artifactStem = task.id + "--" + condition;
    const transcriptsDir = join(runDir, "transcripts");
    mkdirSync(transcriptsDir, { recursive: true });
    const transcriptPath = join(transcriptsDir, artifactStem + ".jsonl");
    const stderrPath = join(transcriptsDir, artifactStem + ".stderr.txt");
    writeFileSync(transcriptPath, processResult.stdout);
    writeFileSync(stderrPath, processResult.stderr);

    const parsed = parseStream(processResult.stdout);
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
    const clientOk = processResult.exitCode === 0 && !processResult.timedOut;
    checks.push({
      check: { type: "client_exit" },
      ok: clientOk,
      detail:
        "claude exit " +
        String(processResult.exitCode) +
        "; timed_out=" +
        booleanText(processResult.timedOut),
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
      condition,
      passed,
      checks,
      activated_skills: parsed.activated_skills,
      successful_skills: parsed.successful_skills,
      discovery,
      usage: parsed.usage,
      model_usage: parsed.model_usage,
      emitted_models: parsed.emitted_models,
      exit_code: processResult.exitCode,
      timed_out: processResult.timedOut,
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
): JsonRecord {
  const missing = ["claude", "moon", "node", "git"].filter(
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
  const modelEnvironment = Object.fromEntries(
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
  );
  return {
    client: checkedOutput(runner, "claude", ["--version"]),
    node_version: checkedOutput(runner, "node", ["--version"]),
    moon_version_all: moonVersion.trim(),
    platform: platformName(),
    official_skills_commit: OFFICIAL_COMMIT,
    model_environment: modelEnvironment,
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
        condition: { type: "string", multiple: true },
        ids: { type: "string" },
        model: { type: "string", default: "claude-haiku-4-5-20251001" },
        "max-turns": { type: "string", default: "50" },
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
  const maxTurnsValue = parsed.values["max-turns"];
  const maxTurns = Number.parseInt(
    typeof maxTurnsValue === "string" ? maxTurnsValue : "",
    10,
  );
  if (!Number.isInteger(maxTurns)) {
    console.error(USAGE);
    console.error("error: --max-turns must be an integer");
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
      conditions,
      ids: typeof ids === "string" ? ids : undefined,
      model: typeof model === "string" ? model : "claude-haiku-4-5-20251001",
      maxTurns,
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
  }
  if (taskDirectories.length === 0) {
    throw new Error("no tasks selected");
  }
  if (options.dryRun) {
    for (const directory of taskDirectories) {
      loadTask(directory);
    }
    console.log(String(taskDirectories.length) + " task(s) valid");
    return 0;
  }

  const environment = preflight();
  const isolation = catalogIsolation();
  const runName = options.runName ?? options.model.replaceAll("/", "-");
  const runDirectory = join(HERE, options.area, "runs", runName);
  mkdirSync(runDirectory, { recursive: true });
  const cacheDirectory = join(runDirectory, "_cache");
  mkdirSync(cacheDirectory, { recursive: true });
  const needsSkillSnapshots = options.conditions.some(
    (condition) => condition === "baseline" || condition === "ours" || condition.startsWith("forced-"),
  );
  const preparedSkills = needsSkillSnapshots
    ? prepareSkillSnapshots(cacheDirectory)
    : undefined;
  const skillSources = preparedSkills?.sources ?? { current: SKILLS_SRC };

  const resultsPath = join(runDirectory, "results.jsonl");
  if (existsSync(resultsPath) && !options.resume) {
    throw new Error(
      resultsPath + " already exists; use a fresh --run-name or --resume",
    );
  }
  const runConfig = {
    area: options.area,
    conditions: options.conditions,
    tasks: Object.fromEntries(
      taskDirectories.map((directory) => [basename(directory), snapshotFiles(directory)]),
    ),
    model: options.model,
    max_turns: options.maxTurns,
    environment,
    catalog_isolation: isolation,
    skill_snapshots: preparedSkills?.manifest ?? null,
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
      JSON.stringify([stringValue(result.id), stringValue(result.condition)]),
    ),
  );
  const results = [...previousResults];
  for (const taskDirectory of taskDirectories) {
    for (const condition of options.conditions) {
      const completedKey = JSON.stringify([basename(taskDirectory), condition]);
      if (completed.has(completedKey)) {
        console.log(
          basename(taskDirectory) + " [" + condition + "] ... already complete",
        );
        continue;
      }
      console.log(basename(taskDirectory) + " [" + condition + "] ...");
      const result = runTask(
        taskDirectory,
        condition,
        options.model,
        options.maxTurns,
        cacheDirectory,
        runDirectory,
        runCommand,
        skillSources,
      );
      results.push(result);
      appendFileSync(resultsPath, JSON.stringify(result) + "\n");
      console.log("    " + (result.passed ? "PASS" : "FAIL"));
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
  const summary = {
    area: options.area,
    model: options.model,
    max_turns: options.maxTurns,
    environment,
    resolved_models: resolvedModels,
    emitted_models: emittedModels,
    pass_rate_by_condition: passRateByCondition,
    discovery_by_condition: discoveryByCondition,
    total_cost_usd: Number(totalCost.toFixed(4)),
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

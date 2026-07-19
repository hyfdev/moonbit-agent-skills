import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { exitWith, isMain, parseCliArgs, usageError } from "./lib/cli.ts";
import { parseFrontmatter, stringMap } from "./lib/frontmatter.ts";
import { checkedOutput, runCommand, type CommandRunner } from "./lib/process.ts";
import { REPO_ROOT } from "./lib/repo.ts";
import { isIsoDate, SKILL_VERSION_RE } from "./validate_skills.ts";

const USAGE = "usage: node tooling/check_skill_versions.ts --base GIT_REF";

export function skillRevisionProblems(
  skillName: string,
  previousSkill: string | undefined,
  currentSkill: string | undefined,
  latestChangeDate: string,
): string[] {
  if (currentSkill === undefined) return [];

  const problems: string[] = [];
  const current = skillIdentity(currentSkill);
  if (current.version === undefined || !SKILL_VERSION_RE.test(current.version)) {
    problems.push(`${skillName}: changed content needs a valid metadata.skill-version`);
  }
  if (current.updatedDate === undefined || !isIsoDate(current.updatedDate)) {
    problems.push(`${skillName}: changed content needs a valid metadata.updated-date`);
  }

  if (previousSkill !== undefined) {
    const previous = skillIdentity(previousSkill);
    if (previous.version === undefined || !SKILL_VERSION_RE.test(previous.version)) {
      problems.push(`${skillName}: base metadata.skill-version must be valid before comparison`);
    } else if (
      current.version !== undefined &&
      SKILL_VERSION_RE.test(current.version) &&
      compareSemVer(current.version, previous.version) <= 0
    ) {
      problems.push(
        `${skillName}: changed content must increase metadata.skill-version above ${repr(previous.version)} (found ${repr(current.version)})`,
      );
    }
  }

  if (
    current.updatedDate !== undefined &&
    isIsoDate(current.updatedDate) &&
    current.updatedDate !== latestChangeDate
  ) {
    problems.push(
      `${skillName}: metadata.updated-date must match latest skill change date ${repr(latestChangeDate)} (found ${repr(current.updatedDate)})`,
    );
  }
  return problems;
}

export function changedSkillRevisionProblems(
  repository: string,
  baseRef: string,
  runner: CommandRunner = runCommand,
  workingTreeDate = singaporeDate(),
): string[] {
  const mergeBase = checkedOutput(runner, "git", ["merge-base", baseRef, "HEAD"], {
    cwd: repository,
  });
  const committedPaths = lines(
    checkedOutput(runner, "git", ["diff", "--name-only", mergeBase, "HEAD", "--", "skills"], {
      cwd: repository,
    }),
  );
  const dirtyPaths = lines(
    checkedOutput(runner, "git", ["diff", "--name-only", "HEAD", "--", "skills"], {
      cwd: repository,
    }),
  );
  const untrackedPaths = lines(
    checkedOutput(runner, "git", ["ls-files", "--others", "--exclude-standard", "--", "skills"], {
      cwd: repository,
    }),
  );
  const allChangedPaths = [...new Set([...committedPaths, ...dirtyPaths, ...untrackedPaths])];
  const changedSkillNames = [
    ...new Set(
      allChangedPaths
        .map((path) => /^skills\/([^/]+)\//.exec(path)?.[1])
        .filter((name): name is string => name !== undefined),
    ),
  ].sort();

  const problems: string[] = [];
  for (const skillName of changedSkillNames) {
    const skillPath = `skills/${skillName}/SKILL.md`;
    const previousSkill = readGitFile(runner, repository, baseRef, skillPath);
    const currentPath = join(repository, skillPath);
    const currentSkill = existsSync(currentPath) ? readFileSync(currentPath, "utf8") : undefined;
    const committedDates = lines(
      checkedOutput(
        runner,
        "git",
        ["log", "--format=%aI", `${mergeBase}..HEAD`, "--", `skills/${skillName}`],
        { cwd: repository },
      ),
    ).map(singaporeDate);
    const hasWorkingTreeChanges = [...dirtyPaths, ...untrackedPaths].some((path) =>
      path.startsWith(`skills/${skillName}/`),
    );
    const changeDates = hasWorkingTreeChanges
      ? [...committedDates, workingTreeDate]
      : committedDates;
    const latestChangeDate = changeDates.sort().at(-1);
    if (latestChangeDate === undefined) {
      problems.push(`${skillName}: could not determine the latest skill change date`);
      continue;
    }
    problems.push(
      ...skillRevisionProblems(skillName, previousSkill, currentSkill, latestChangeDate),
    );
  }
  return problems;
}

export function main(args = process.argv.slice(2)): number {
  const parsed = parseCliArgs(
    {
      args,
      options: { base: { type: "string" } },
      strict: true,
    },
    USAGE,
  );
  if (!parsed.ok) return parsed.exitCode;
  const baseRef = parsed.result.values.base;
  if (baseRef === undefined || baseRef === "") {
    return usageError("--base is required", USAGE);
  }

  let problems: string[];
  try {
    problems = changedSkillRevisionProblems(REPO_ROOT, baseRef);
  } catch (error) {
    console.error(`error: ${(error as Error).message}`);
    return 2;
  }
  for (const problem of problems) {
    console.error(`FAIL ${problem}`);
  }
  if (problems.length === 0) {
    console.log(`changed skill versions against ${baseRef}: OK`);
  }
  return problems.length > 0 ? 1 : 0;
}

function skillIdentity(text: string): { version?: string; updatedDate?: string } {
  const parsed = parseFrontmatter(text);
  const metadata = stringMap(parsed.frontmatter, "metadata") ?? {};
  return {
    version: metadata["skill-version"],
    updatedDate: metadata["updated-date"],
  };
}

function compareSemVer(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

function readGitFile(
  runner: CommandRunner,
  repository: string,
  ref: string,
  path: string,
): string | undefined {
  const result = runner("git", ["show", `${ref}:${path}`], { cwd: repository });
  return result.exitCode === 0 ? result.stdout : undefined;
}

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function singaporeDate(value: string | Date = new Date()): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.valueOf())) throw new Error(`invalid timestamp ${repr(String(value))}`);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function repr(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

if (isMain(import.meta.url)) {
  exitWith(main());
}

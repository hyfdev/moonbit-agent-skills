import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

export interface SkillRoute {
  section?: unknown;
  reference?: unknown;
  terms?: unknown;
}

export function validateSkillRoute(
  route: SkillRoute,
  ownerSkill: string,
  repoRoot: string,
  label: string,
): string[] {
  const problems: string[] = [];
  const section = stringValue(route.section);
  const reference = stringValue(route.reference);
  const terms = stringArray(route.terms);
  if (section === "") {
    problems.push(`${label}: route.section must be a non-empty string`);
  }
  if (!/^references\/[a-z0-9][a-z0-9-]*(?:\.mbt)?\.md$/.test(reference)) {
    problems.push(`${label}: route.reference must name a skill references Markdown file`);
  }
  if (terms === undefined || terms.length === 0) {
    problems.push(`${label}: route.terms must be a non-empty string array`);
  } else {
    if (terms.some((term) => term.trim() === "")) {
      problems.push(`${label}: route.terms must not contain empty strings`);
    }
    if (new Set(terms).size !== terms.length) {
      problems.push(`${label}: route.terms must not contain duplicates`);
    }
  }
  if (problems.length > 0) {
    return problems;
  }

  const skillRoot = safeRepoPath(repoRoot, `skills/${ownerSkill}`);
  if (skillRoot === undefined || !isDirectory(skillRoot)) {
    return [...problems, `${label}: owner skill ${JSON.stringify(ownerSkill)} does not exist`];
  }
  const referencePath = safeRepoPath(skillRoot, reference);
  if (referencePath === undefined || !isFile(referencePath)) {
    problems.push(`${label}: routed reference does not exist: ${reference}`);
  }

  const skillPath = join(skillRoot, "SKILL.md");
  if (!isFile(skillPath)) {
    problems.push(`${label}: owner skill has no SKILL.md`);
    return problems;
  }
  const sectionLines = markdownSection(readFileSync(skillPath, "utf8"), section);
  if (sectionLines === undefined) {
    problems.push(`${label}: SKILL.md has no level-two section ${JSON.stringify(section)}`);
    return problems;
  }
  const matchingLine = sectionLines.find(
    (line) => line.includes(reference) && (terms ?? []).every((term) => line.includes(term)),
  );
  if (matchingLine === undefined) {
    problems.push(
      `${label}: one line in SKILL.md section ${JSON.stringify(section)} must contain ${JSON.stringify(reference)} and every route term: ${(terms ?? []).map((term) => JSON.stringify(term)).join(", ")}`,
    );
  }
  return problems;
}

export function markdownSection(markdown: string, section: string): string[] | undefined {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${section}`);
  if (start < 0) {
    return undefined;
  }
  const endOffset = lines.slice(start + 1).findIndex((line) => /^##\s+/.test(line));
  const end = endOffset < 0 ? lines.length : start + 1 + endOffset;
  return lines.slice(start + 1, end);
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeRepoPath(rootDirectory: string, relativePath: string): string | undefined {
  const root = resolve(rootDirectory);
  const full = resolve(root, relativePath);
  return full === root || full.startsWith(`${root}${sep}`) ? full : undefined;
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

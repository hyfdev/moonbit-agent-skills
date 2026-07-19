import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { exitWith, isMain } from "./lib/cli.ts";
import { parseFrontmatter, scalar, stringMap } from "./lib/frontmatter.ts";
import { REPO_ROOT } from "./lib/repo.ts";

const SKILLS_DIR = join(REPO_ROOT, "skills");

export const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const REQUIRED_METADATA_KEYS = new Set(["skill-version", "updated-date"]);

export const SKILL_VERSION_RE = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const REQUIRED_COMPONENT_KEYS: Record<string, Set<string>> = {
  "moonbit-language": new Set([
    "moonc-version",
    "moonbit-release",
    "verified-date",
    "verified-platform",
    "verified-targets",
  ]),
  "moonbit-toolchain": new Set([
    "moon-version",
    "moonrun-version",
    "moonbit-release",
    "verified-date",
    "verified-platform",
    "verified-targets",
  ]),
};

export function validateSkill(skillDir: string): string[] {
  const problems: string[] = [];
  const skillName = basename(skillDir);
  const skillMd = join(skillDir, "SKILL.md");
  if (!isFile(skillMd)) {
    return [`${skillName}: missing SKILL.md`];
  }

  const text = readFileSync(skillMd, "utf8");
  const parsed = parseFrontmatter(text);
  problems.push(...parsed.errors.map((error) => `frontmatter: ${error}`));

  const name = scalar(parsed.frontmatter, "name") ?? "";
  if (!NAME_RE.test(name) || name.length > 64) {
    problems.push(`name ${repr(name)} violates spec naming rules`);
  }
  if (name !== skillName) {
    problems.push(`name ${repr(name)} != directory name ${repr(skillName)}`);
  }

  const description = scalar(parsed.frontmatter, "description") ?? "";
  if (description.length < 1 || description.length > 1024) {
    problems.push(`description length ${description.length} outside 1..1024 chars`);
  }

  const compatibility = scalar(parsed.frontmatter, "compatibility") ?? "";
  if (compatibility !== "" && compatibility.length > 500) {
    problems.push(`compatibility length ${compatibility.length} > 500 chars`);
  }

  let metadata = stringMap(parsed.frontmatter, "metadata");
  if (metadata === undefined) {
    problems.push("metadata must be a mapping");
    metadata = {};
  }
  const required = new Set([...REQUIRED_METADATA_KEYS, ...(REQUIRED_COMPONENT_KEYS[name] ?? [])]);
  const missing = [...required].filter((key) => !(key in metadata)).sort();
  if (missing.length > 0) {
    problems.push(`metadata missing version-contract keys: ${reprList(missing)}`);
  }
  const skillVersion = metadata["skill-version"];
  if (skillVersion !== undefined && !SKILL_VERSION_RE.test(skillVersion)) {
    problems.push(`metadata.skill-version ${repr(skillVersion)} must use SemVer x.y.z`);
  }
  const updatedDate = metadata["updated-date"];
  if (updatedDate !== undefined && !isIsoDate(updatedDate)) {
    problems.push(`metadata.updated-date ${repr(updatedDate)} must use a real YYYY-MM-DD date`);
  }
  const verifiedDate = metadata["verified-date"];
  if (verifiedDate !== undefined && !isIsoDate(verifiedDate)) {
    problems.push(`metadata.verified-date ${repr(verifiedDate)} must use a real YYYY-MM-DD date`);
  }
  if (name === "moonbit-agent-skills-maintainer" && metadata.scope !== "repository-maintenance") {
    problems.push("metadata.scope must be repository-maintenance");
  }
  if (metadata.scope === "repository-maintenance" && metadata.internal !== "true") {
    problems.push("repository-maintenance skills must set metadata.internal: true");
  }
  if (REQUIRED_COMPONENT_KEYS[name] !== undefined && "internal" in metadata) {
    problems.push("product skills must remain public (remove metadata.internal)");
  }

  const bodyLines = parsed.body.split("\n").length;
  if (bodyLines > 500) {
    problems.push(`SKILL.md body has ${bodyLines} lines (> 500)`);
  }
  const estimatedTokens = Math.floor(parsed.body.length / 4);
  if (estimatedTokens > 5000) {
    problems.push(`SKILL.md body ~${estimatedTokens} tokens (> 5000)`);
  }

  const referenced = new Set<string>();
  const pathPattern =
    /(?<![A-Za-z0-9_./-])((?:references|scripts|assets)\/[A-Za-z0-9_./-]+[A-Za-z0-9_])/g;
  for (const match of parsed.body.matchAll(pathPattern)) {
    referenced.add(match[1]);
  }
  for (const path of [...referenced].sort()) {
    if (!isFile(join(skillDir, path))) {
      problems.push(`SKILL.md references missing file ${path}`);
    }
  }

  for (const subdirectory of ["references", "scripts"]) {
    const directory = join(skillDir, subdirectory);
    if (!isDirectory(directory)) {
      continue;
    }
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.name.startsWith(".") || !entry.isFile()) {
        continue;
      }
      const path = `${subdirectory}/${entry.name}`;
      if (!referenced.has(path) && !parsed.body.includes(path)) {
        problems.push(`${path} exists but SKILL.md never mentions it`);
      }
    }
  }

  const sidecar = join(skillDir, "agents", "openai.yaml");
  if (!isFile(sidecar)) {
    problems.push("missing agents/openai.yaml (Codex activation sidecar)");
  } else if (!readFileSync(sidecar, "utf8").includes("allow_implicit_invocation: true")) {
    problems.push("agents/openai.yaml must set allow_implicit_invocation: true");
  }

  for (const file of walkFiles(skillDir)) {
    if (![".md", ".mbt", ".ts"].includes(extname(file))) {
      continue;
    }
    if (/(?<![\w@])\/(?:Users|home|private\/tmp)\//.test(readFileSync(file, "utf8"))) {
      problems.push(`${relative(skillDir, file)}: absolute path leaked`);
    }
  }

  return problems.map((problem) => `${skillName}: ${problem}`);
}

export function readmeCatalogProblems(readme: string, skillDirectories: string[]): string[] {
  const problems: string[] = [];
  const tableHeader = "| Skill | Version | Updated | MoonBit | Verified |";
  const sectionStart = readme.indexOf("## Skills\n");
  const sectionEnd = sectionStart === -1 ? -1 : readme.indexOf("\n## ", sectionStart + 10);
  const skillsSection =
    sectionStart === -1
      ? ""
      : readme.slice(sectionStart, sectionEnd === -1 ? readme.length : sectionEnd);
  const sectionLines = skillsSection.split("\n");
  const headerIndex = sectionLines.indexOf(tableHeader);
  if (headerIndex === -1) {
    problems.push(`README: missing public skill table header ${repr(tableHeader)}`);
  }
  const tableRows = new Set<string>();
  if (headerIndex !== -1) {
    for (const line of sectionLines.slice(headerIndex + 2)) {
      if (!line.startsWith("|")) break;
      tableRows.add(line);
    }
  }
  for (const skillDirectory of skillDirectories) {
    const skillMd = join(skillDirectory, "SKILL.md");
    if (!isFile(skillMd)) continue;
    const parsed = parseFrontmatter(readFileSync(skillMd, "utf8"));
    const name = scalar(parsed.frontmatter, "name") ?? basename(skillDirectory);
    if (REQUIRED_COMPONENT_KEYS[name] === undefined) continue;
    const metadata = stringMap(parsed.frontmatter, "metadata") ?? {};
    const status = readmeStatusRow(name, metadata);
    if (!tableRows.has(status)) {
      problems.push(`README: ${name} status does not match SKILL.md metadata`);
    }
  }
  return problems;
}

export function readmeStatusRow(name: string, metadata: Record<string, string>): string {
  return (
    `| [${name}](skills/${name}/SKILL.md) | ` +
    `[\`${metadata["skill-version"] ?? ""}\`](https://github.com/hyfdev/moonbit-agent-skills/commits/main/skills/${name}) | ` +
    `${metadata["updated-date"] ?? ""} | ` +
    `\`${metadata["moonbit-release"] ?? ""}\` | ` +
    `${metadata["verified-date"] ?? ""} |`
  );
}

export function isIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function main(): number {
  const skillDirectories = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(SKILLS_DIR, entry.name))
    .sort();
  if (skillDirectories.length === 0) {
    console.error("no skills found");
    return 2;
  }

  const problems = skillDirectories.flatMap(validateSkill);
  problems.push(
    ...readmeCatalogProblems(readFileSync(join(REPO_ROOT, "README.md"), "utf8"), skillDirectories),
  );
  for (const problem of problems) {
    console.error(`FAIL ${problem}`);
  }
  if (problems.length === 0) {
    console.log(`validated ${skillDirectories.length} skill(s): OK`);
  }
  return problems.length > 0 ? 1 : 0;
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

function walkFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function repr(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function reprList(values: string[]): string {
  return `[${values.map(repr).join(", ")}]`;
}

if (isMain(import.meta.url)) {
  exitWith(main());
}

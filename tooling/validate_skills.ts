import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { exitWith, isMain } from "./lib/cli.ts";
import { parseFrontmatter, scalar, stringMap } from "./lib/frontmatter.ts";
import { REPO_ROOT } from "./lib/repo.ts";

const SKILLS_DIR = join(REPO_ROOT, "skills");

export const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const REQUIRED_METADATA_KEYS = new Set([
  "skill-version",
  "verified-date",
  "verified-platform",
  "verified-targets",
]);

const REQUIRED_COMPONENT_KEYS: Record<string, Set<string>> = {
  "moonbit-language": new Set(["moonc-version"]),
  "moonbit-toolchain": new Set(["moon-version", "moonrun-version"]),
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
    if (![".md", ".mbt", ".sh", ".py", ".ts"].includes(extname(file))) {
      continue;
    }
    if (/(?<![\w@])\/(?:Users|home|private\/tmp)\//.test(readFileSync(file, "utf8"))) {
      problems.push(`${relative(skillDir, file)}: absolute path leaked`);
    }
  }

  return problems.map((problem) => `${skillName}: ${problem}`);
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

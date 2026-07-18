import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { exitWith, isMain } from "./lib/cli.ts";
import { REPO_ROOT } from "./lib/repo.ts";

const SKILLS = ["moonbit-language", "moonbit-toolchain"] as const;
export const MIN_CHARS = 120;

export function normalizeUnit(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function units(skill: string): Map<string, string> {
  const output = new Map<string, string>();
  const skillDirectory = join(REPO_ROOT, "skills", skill);
  const references = join(skillDirectory, "references");
  const paths = [
    join(skillDirectory, "SKILL.md"),
    ...(isDirectory(references)
      ? readdirSync(references)
          .map((name) => join(references, name))
          .sort()
      : []),
  ];

  for (const path of paths) {
    if (!isFile(path) || extname(path) !== ".md") {
      continue;
    }
    if (basename(path) === "reporting-errors.md") {
      continue;
    }

    const text = readFileSync(path, "utf8");
    const blocks: string[] = [];
    const fencePattern = /```[^\n]*\n(.*?)```/gs;
    for (const match of text.matchAll(fencePattern)) {
      blocks.push(match[1]);
    }
    const prose = text.replace(fencePattern, "");
    blocks.push(...prose.split("\n\n"));

    for (const block of blocks) {
      const normalized = normalizeUnit(block);
      if (normalized.length >= MIN_CHARS && !output.has(normalized)) {
        output.set(
          normalized,
          `${relative(REPO_ROOT, path)}: ${singleQuoted(block.trim().slice(0, 60))}`,
        );
      }
    }
  }
  return output;
}

export function main(): number {
  const left = units(SKILLS[0]);
  const right = units(SKILLS[1]);
  const duplicated = [...left.keys()].filter((unit) => right.has(unit)).sort();
  for (const unit of duplicated) {
    console.error(
      `FAIL duplicated unit in both skills:\n  ${left.get(unit)}\n  ${right.get(unit)}`,
    );
  }
  if (duplicated.length === 0) {
    console.log(`duplication check: OK (no shared knowledge units >= ${MIN_CHARS} chars)`);
  }
  return duplicated.length > 0 ? 1 : 0;
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

function singleQuoted(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'").replaceAll("\n", "\\n")}'`;
}

if (isMain(import.meta.url)) {
  exitWith(main());
}

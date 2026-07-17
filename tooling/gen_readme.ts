import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { exitWith, isMain } from "./lib/cli.ts";
import { parseFrontmatter, stringMap } from "./lib/frontmatter.ts";
import { REPO_ROOT } from "./lib/repo.ts";

interface ToolchainSnapshot {
  verification_date: string;
  platform: { os: string; arch: string };
  components: Array<{ name: string; version: string }>;
  verified_targets: string[];
}

interface ActivationPrompt {
  category: string;
}

export function readSnapshot(repoRoot = REPO_ROOT): ToolchainSnapshot {
  return JSON.parse(
    readFileSync(join(repoRoot, "verification", "toolchains", "current.json"), "utf8"),
  ) as ToolchainSnapshot;
}

export function countActivationPrompts(repoRoot = REPO_ROOT): Map<string, number> {
  const counts = new Map<string, number>();
  const prompts = join(repoRoot, "evals", "activation", "prompts.jsonl");
  if (!isFile(prompts)) {
    return counts;
  }
  for (const line of readFileSync(prompts, "utf8").split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const prompt = JSON.parse(line) as ActivationPrompt;
    counts.set(prompt.category, (counts.get(prompt.category) ?? 0) + 1);
  }
  return counts;
}

export function blockStatus(repoRoot = REPO_ROOT): string {
  const snapshot = readSnapshot(repoRoot);
  const components = new Map(
    snapshot.components.map((component) => [component.name, component.version]),
  );
  return [
    `- Verified toolchain: \`moon ${components.get("moon")}\` · \`moonc v${components.get("moonc")}\` · \`moonrun ${components.get("moonrun")}\``,
    `- Verification date: ${snapshot.verification_date} on ${snapshot.platform.os} ${snapshot.platform.arch}`,
    `- Verified targets: ${snapshot.verified_targets.join(", ")}`,
  ].join("\n");
}

export function blockInventory(repoRoot = REPO_ROOT): string {
  const fixtures = directories(join(repoRoot, "verification", "fixtures")).filter((directory) =>
    isFile(join(directory, "fixture.json")),
  );
  const lines: string[] = [];
  for (const skillDirectory of directories(join(repoRoot, "skills"))) {
    const skillMd = join(skillDirectory, "SKILL.md");
    if (!isFile(skillMd)) {
      continue;
    }
    const parsed = parseFrontmatter(readFileSync(skillMd, "utf8"));
    const referencesDirectory = join(skillDirectory, "references");
    const references = isDirectory(referencesDirectory)
      ? readdirSync(referencesDirectory, { withFileTypes: true })
          .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
          .map((entry) => entry.name)
          .sort()
      : [];
    const bodyLines = parsed.body.split("\n").length;
    const skillName = skillDirectory.split(/[\\/]/).at(-1);
    const version = stringMap(parsed.frontmatter, "metadata")?.["skill-version"] ?? "?";
    lines.push(
      `- \`${skillName}\` v${version}: SKILL.md (${bodyLines} lines) + ${references.length} reference file(s)`,
    );
  }
  lines.push(`- Verification fixtures: ${fixtures.length}`);

  const counts = countActivationPrompts(repoRoot);
  if (counts.size > 0) {
    const sortedCounts = [...counts].sort(([left], [right]) => left.localeCompare(right));
    const total = sortedCounts.reduce((sum, [, count]) => sum + count, 0);
    const perCategory = sortedCounts.map(([category, count]) => `${category} ${count}`).join(", ");
    lines.push(`- Activation eval prompts: ${total} (${perCategory})`);
  }
  return lines.join("\n");
}

const BLOCKS: Record<string, (repoRoot: string) => string> = {
  status: blockStatus,
  inventory: blockInventory,
};

export function generateReadme(text: string, repoRoot = REPO_ROOT): string {
  let generated = text;
  for (const [name, producer] of Object.entries(BLOCKS)) {
    const begin = `<!-- BEGIN GENERATED: ${name} -->`;
    const end = `<!-- END GENERATED: ${name} -->`;
    const pattern = new RegExp(`(${escapeRegExp(begin)}\\n)[\\s\\S]*?(${escapeRegExp(end)})`);
    if (!pattern.test(generated)) {
      throw new Error(`README.md missing generated block markers for '${name}'`);
    }
    generated = generated.replace(
      pattern,
      (_, opening: string, closing: string) => `${opening}${producer(repoRoot)}\n${closing}`,
    );
  }
  return generated;
}

export function main(args = process.argv.slice(2), repoRoot = REPO_ROOT): number {
  const { values } = parseArgs({
    args,
    options: { check: { type: "boolean", default: false } },
    strict: true,
  });
  const readme = join(repoRoot, "README.md");
  const text = readFileSync(readme, "utf8");
  let generated: string;
  try {
    generated = generateReadme(text, repoRoot);
  } catch (error) {
    console.error(`FAIL ${(error as Error).message}`);
    return 1;
  }

  if (generated !== text) {
    if (values.check) {
      console.error("FAIL README.md generated blocks are stale; run vp run gen-readme");
      return 1;
    }
    writeFileSync(readme, generated, "utf8");
    console.log("README.md regenerated");
  } else {
    console.log("README.md generated blocks: up to date");
  }
  return 0;
}

function directories(parent: string): string[] {
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(parent, entry.name))
    .sort();
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (isMain(import.meta.url)) {
  exitWith(main());
}

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { exitWith, isMain, parseCliArgs } from "./lib/cli.ts";
import type { CommandRunner } from "./lib/process.ts";
import { runCommand } from "./lib/process.ts";
import { REPO_ROOT } from "./lib/repo.ts";

const MOON_MOD_TEMPLATE = 'name = "mbtskills/checkeddocs"\nversion = "0.1.0"\n';

export function collectDocs(skillDirectory: string): string[] {
  const references = join(skillDirectory, "references");
  const documents = existsSync(references)
    ? readdirSync(references)
        .filter((name) => name.endsWith(".mbt.md") && isFile(join(references, name)))
        .map((name) => join(references, name))
        .sort()
    : [];
  const skillDocument = join(skillDirectory, "SKILL.mbt.md");
  if (isFile(skillDocument)) {
    documents.push(skillDocument);
  }
  return documents;
}

export function runSkill(
  skill: string,
  targets: string[],
  runner: CommandRunner = runCommand,
  repoRoot = REPO_ROOT,
): number {
  const skillDirectory = join(repoRoot, "skills", skill);
  const documents = collectDocs(skillDirectory);
  if (documents.length === 0) {
    console.log(`${skill}: no .mbt.md documents, nothing to check`);
    return 0;
  }

  let failures = 0;
  const temporary = mkdtempSync(join(tmpdir(), "mbtdocs-"));
  try {
    const moduleDirectory = join(temporary, "checkeddocs");
    mkdirSync(moduleDirectory);
    writeFileSync(join(moduleDirectory, "moon.mod"), MOON_MOD_TEMPLATE, "utf8");
    writeFileSync(join(moduleDirectory, "moon.pkg"), "", "utf8");
    for (const document of documents) {
      copyFileSync(document, join(moduleDirectory, basename(document)));
    }

    for (const target of targets) {
      for (const subcommand of ["check", "test"]) {
        const result = runner("moon", [subcommand, "--target", target, "--no-render"], {
          cwd: moduleDirectory,
          timeout: 600_000,
        });
        const label = `${skill} moon ${subcommand} --target ${target}`;
        if (result.exitCode !== 0) {
          failures += 1;
          console.error(`FAIL ${label}\n${(result.stdout + result.stderr).slice(0, 2000)}`);
        } else {
          const trimmed = result.stdout.trim();
          const tail = trimmed === "" ? "" : (trimmed.split("\n").at(-1) ?? "");
          console.log(`ok   ${label}: ${tail}`);
        }
      }
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }

  const result = failures === 0 ? "ALL OK" : `${failures} failing command(s)`;
  console.log(
    `${skill}: ${documents.length} checked document(s) across targets ${targets.join(",")}; ${result}`,
  );
  return failures;
}

export function main(args = process.argv.slice(2), repoRoot = REPO_ROOT): number {
  const parsed = parseCliArgs(
    {
      args,
      options: {
        skill: { type: "string", multiple: true },
        targets: {
          type: "string",
          default: "wasm-gc,wasm,js,native",
        },
      },
      strict: true,
    },
    "usage: node tooling/run_checked_docs.ts [--skill NAME ...] [--targets TARGET,...]",
  );
  if (!parsed.ok) {
    return parsed.exitCode;
  }
  const { values } = parsed.result;
  const skillsDirectory = join(repoRoot, "skills");
  const skills =
    values.skill ??
    readdirSync(skillsDirectory, { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && isFile(join(skillsDirectory, entry.name, "SKILL.md")),
      )
      .map((entry) => entry.name)
      .sort();
  const targets = values.targets.split(",");
  const failures = skills.reduce(
    (total, skill) => total + runSkill(skill, targets, runCommand, repoRoot),
    0,
  );
  return failures > 0 ? 1 : 0;
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

if (isMain(import.meta.url)) {
  exitWith(main());
}

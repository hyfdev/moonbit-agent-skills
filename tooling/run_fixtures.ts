import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { exitWith, isMain } from "./lib/cli.ts";
import { platformStamp } from "./lib/platform.ts";
import type { CommandRunner, CommandResult } from "./lib/process.ts";
import { checkedOutput, runCommand } from "./lib/process.ts";
import { REPO_ROOT } from "./lib/repo.ts";

const MOON_MOD_TEMPLATE = 'name = "mbtskills/fixture"\nversion = "0.1.0"\n';

interface FixtureMetadata extends Record<string, unknown> {
  id: string;
  expect: string;
  targets?: string[];
  diagnostic_contains?: string[];
  verified?: unknown;
}

interface MoonVersionOutput {
  items: Array<{ name: string; version: string }>;
}

export interface FixtureResult {
  ok: boolean;
  detail: string;
}

export function moonVersions(runner: CommandRunner = runCommand): Record<string, string> {
  const output = checkedOutput(runner, "moon", ["version", "--all", "--json"]);
  const parsed = JSON.parse(output) as MoonVersionOutput;
  return Object.fromEntries(parsed.items.map((item) => [item.name, item.version.trim()]));
}

export function materialize(
  fixtureDirectory: string,
  workDirectory: string,
  whichCode: string,
): string {
  const moduleDirectory = join(workDirectory, "fixture_mod");
  const moduleSource = join(fixtureDirectory, "module");
  if (isDirectory(moduleSource)) {
    cpSync(moduleSource, moduleDirectory, { recursive: true });
    return moduleDirectory;
  }
  mkdirSync(moduleDirectory);
  writeFileSync(join(moduleDirectory, "moon.mod"), MOON_MOD_TEMPLATE, "utf8");
  writeFileSync(join(moduleDirectory, "moon.pkg"), "", "utf8");
  writeFileSync(
    join(moduleDirectory, "lib.mbt"),
    readFileSync(join(fixtureDirectory, whichCode), "utf8"),
    "utf8",
  );
  return moduleDirectory;
}

function runMoon(args: string[], cwd: string, runner: CommandRunner): CommandResult {
  return runner("moon", [...args, "--no-render"], { cwd, timeout: 300_000 });
}

export function checkOne(
  fixtureDirectory: string,
  verbose: boolean,
  runner: CommandRunner = runCommand,
): FixtureResult {
  const metadata = JSON.parse(
    readFileSync(join(fixtureDirectory, "fixture.json"), "utf8"),
  ) as FixtureMetadata;
  const expectation = metadata.expect;
  const targets = metadata.targets ?? ["wasm-gc"];
  const problems: string[] = [];
  const temporary = mkdtempSync(join(tmpdir(), "mbtfix-"));

  try {
    let moduleDirectory = materialize(fixtureDirectory, temporary, "code.mbt");
    for (const target of targets) {
      let result: CommandResult;
      if (expectation === "check-fail" || expectation === "check-pass") {
        result = runMoon(["check", "--target", target], moduleDirectory, runner);
      } else if (expectation === "test-pass" || expectation === "semantic-trap") {
        result = runMoon(["test", "--target", target], moduleDirectory, runner);
      } else {
        return { ok: false, detail: `unknown expect ${repr(expectation)}` };
      }
      const output = result.stdout + result.stderr;
      const failed = result.exitCode !== 0;

      if (expectation === "check-fail") {
        if (!failed) {
          problems.push(`[${target}] expected check to fail, it passed`);
        }
      } else if (failed) {
        problems.push(
          `[${target}] expected success, got exit ${result.exitCode}:\n${output.slice(0, 800)}`,
        );
      }
      for (const needle of metadata.diagnostic_contains ?? []) {
        if (!output.includes(needle)) {
          problems.push(
            `[${target}] output missing ${repr(needle)}; got:\n${output.slice(0, 800)}`,
          );
        }
      }
    }

    const fixed = join(fixtureDirectory, "fixed.mbt");
    if (isFile(fixed)) {
      rmSync(moduleDirectory, { recursive: true, force: true });
      moduleDirectory = materialize(fixtureDirectory, temporary, "fixed.mbt");
      for (const target of targets) {
        const result = runMoon(["check", "--target", target], moduleDirectory, runner);
        if (result.exitCode !== 0) {
          problems.push(
            `[${target}] fixed.mbt must pass moon check but failed:\n${(result.stdout + result.stderr).slice(0, 800)}`,
          );
        }
      }
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }

  if (verbose && problems.length === 0) {
    console.log(`  ok: ${metadata.id} (${expectation}, targets=${targets.join(",")})`);
  }
  return { ok: problems.length === 0, detail: problems.join("\n") };
}

export function main(
  args = process.argv.slice(2),
  runner: CommandRunner = runCommand,
  repoRoot = REPO_ROOT,
): number {
  const { values, positionals } = parseArgs({
    args,
    options: {
      stamp: { type: "boolean", default: false },
      date: { type: "string" },
      verbose: { type: "boolean", short: "v", default: false },
    },
    allowPositionals: true,
    strict: true,
  });
  if (values.stamp && values.date === undefined) {
    console.error("--stamp requires --date");
    return 2;
  }

  const fixturesDirectory = join(repoRoot, "verification", "fixtures");
  let fixtureDirectories = directories(fixturesDirectory).filter((directory) =>
    isFile(join(directory, "fixture.json")),
  );
  if (positionals.length > 0) {
    const requested = new Set(positionals);
    fixtureDirectories = fixtureDirectories.filter((directory) =>
      requested.has(basename(directory)),
    );
    const found = new Set(fixtureDirectories.map((directory) => basename(directory)));
    const missing = [...requested].filter((id) => !found.has(id)).sort();
    if (missing.length > 0) {
      console.error(`unknown fixture ids: ${reprList(missing)}`);
      return 2;
    }
  }
  if (fixtureDirectories.length === 0) {
    console.error("no fixtures found");
    return 2;
  }

  const versions = moonVersions(runner);
  let failures = 0;
  for (const fixtureDirectory of fixtureDirectories) {
    const result = checkOne(fixtureDirectory, values.verbose, runner);
    if (!result.ok) {
      failures += 1;
      console.error(`FAIL ${basename(fixtureDirectory)}:\n${result.detail}\n`);
    } else if (values.stamp) {
      const metadataPath = join(fixtureDirectory, "fixture.json");
      const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as FixtureMetadata;
      metadata.verified = {
        date: values.date,
        components: versions,
        platform: platformStamp(),
      };
      writeFileSync(metadataPath, `${JSON.stringify(metadata, undefined, 2)}\n`, "utf8");
    }
  }

  const total = fixtureDirectories.length;
  console.log(`fixtures: ${total - failures}/${total} behaved as declared`);
  return failures > 0 ? 1 : 0;
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

function repr(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function reprList(values: string[]): string {
  return `[${values.map(repr).join(", ")}]`;
}

if (isMain(import.meta.url)) {
  exitWith(main());
}

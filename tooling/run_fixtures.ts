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
import { exitWith, isMain, parseCliArgs, usageError } from "./lib/cli.ts";
import { platformStamp } from "./lib/platform.ts";
import type { CommandRunner, CommandResult } from "./lib/process.ts";
import { checkedOutput, runCommand } from "./lib/process.ts";
import { REPO_ROOT } from "./lib/repo.ts";

interface FixtureMetadata extends Record<string, unknown> {
  id: string;
  expect: string;
  targets?: string[];
  moon_args?: unknown;
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
  const fixtureName = basename(fixtureDirectory)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  writeFileSync(
    join(moduleDirectory, "moon.mod"),
    `name = "mbtskills/${fixtureName || "fixture"}"\nversion = "0.1.0"\n`,
    "utf8",
  );
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
  if (
    metadata.moon_args !== undefined &&
    (!Array.isArray(metadata.moon_args) ||
      metadata.moon_args.some((argument) => typeof argument !== "string"))
  ) {
    return { ok: false, detail: "moon_args must be an array of strings" };
  }
  const moonArgs = (metadata.moon_args ?? []) as string[];
  const problems: string[] = [];
  const temporary = mkdtempSync(join(tmpdir(), "mbtfix-"));

  try {
    let moduleDirectory = materialize(fixtureDirectory, temporary, "code.mbt");
    for (const target of targets) {
      let result: CommandResult;
      if (expectation === "check-fail" || expectation === "check-pass") {
        result = runMoon(["check", "--target", target, ...moonArgs], moduleDirectory, runner);
      } else if (
        expectation === "test-pass" ||
        expectation === "semantic-trap" ||
        expectation === "runtime-fail"
      ) {
        result = runMoon(["test", "--target", target, ...moonArgs], moduleDirectory, runner);
      } else {
        return { ok: false, detail: `unknown expect ${repr(expectation)}` };
      }
      const output = result.stdout + result.stderr;
      const failed = result.exitCode !== 0;

      if (expectation === "check-fail" || expectation === "runtime-fail") {
        if (!failed) {
          const command = expectation === "check-fail" ? "check" : "test";
          problems.push(`[${target}] expected ${command} to fail, it passed`);
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
      const fixedSubcommand =
        expectation === "test-pass" ||
        expectation === "semantic-trap" ||
        expectation === "runtime-fail"
          ? "test"
          : "check";
      for (const target of targets) {
        const result = runMoon(
          [fixedSubcommand, "--target", target, ...moonArgs],
          moduleDirectory,
          runner,
        );
        if (result.exitCode !== 0) {
          problems.push(
            `[${target}] fixed.mbt must pass moon ${fixedSubcommand} but failed:\n${(result.stdout + result.stderr).slice(0, 800)}`,
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
  const usage =
    "usage: node tooling/run_fixtures.ts [--stamp --date YYYY-MM-DD] [-v|--verbose] [FIXTURE_ID ...]";
  const parsed = parseCliArgs(
    {
      args,
      options: {
        stamp: { type: "boolean", default: false },
        date: { type: "string" },
        verbose: { type: "boolean", short: "v", default: false },
      },
      allowPositionals: true,
      strict: true,
    },
    usage,
  );
  if (!parsed.ok) {
    return parsed.exitCode;
  }
  const { values, positionals } = parsed.result;
  if (values.stamp && values.date === undefined) {
    return usageError("--stamp requires --date", usage);
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
      return usageError(`unknown fixture ids: ${reprList(missing)}`, usage);
    }
  }
  if (fixtureDirectories.length === 0) {
    return usageError("no fixtures found", usage);
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

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { exitWith, isMain, parseCliArgs, usageError } from "./lib/cli.ts";
import { stableJson } from "./lib/json.ts";
import { currentPlatform } from "./lib/platform.ts";
import type { CommandRunner } from "./lib/process.ts";
import { checkedOutput, runCommand } from "./lib/process.ts";
import { REPO_ROOT } from "./lib/repo.ts";

export const VERSION_RE =
  /^(?:[a-z-]+ )?v?(?<version>[0-9][^ ]*) \((?:(?<commit>[0-9a-f]+) )?(?<date>\d{4}-\d{2}-\d{2})\)$/;

interface VersionItem {
  name: string;
  version: string;
}

interface VersionOutput {
  items: VersionItem[];
}

export interface SnapshotComponent {
  name: string;
  version: string;
  commit: string;
  build_date: string;
  raw: string;
}

export function normalizeVersionPaths(raw: string, moonHome = process.env.MOON_HOME): string {
  if (moonHome === undefined || moonHome === "") {
    return raw;
  }
  return raw.replaceAll(moonHome.replace(/[\\/]+$/, ""), "<MOON_HOME>");
}

export function parseComponent(item: VersionItem): SnapshotComponent {
  const raw = item.version.trim();
  const match = VERSION_RE.exec(raw);
  if (match?.groups === undefined) {
    throw new Error(`unrecognized version string for ${item.name}: ${repr(raw)}`);
  }
  return {
    name: item.name,
    version: match.groups.version,
    commit: match.groups.commit ?? "",
    build_date: match.groups.date,
    raw,
  };
}

export function createSnapshot(
  date: string,
  targets: string[],
  runner: CommandRunner = runCommand,
): Record<string, unknown> {
  const versionJson = checkedOutput(runner, "moon", ["version", "--all", "--json"]);
  const versionOutput = JSON.parse(versionJson) as VersionOutput;
  const components = versionOutput.items.map(parseComponent);
  return {
    _generated_by: "tooling/snapshot_toolchain.ts (do not edit by hand)",
    verification_date: date,
    platform: currentPlatform(runner),
    components,
    verified_targets: [...targets].sort(),
    raw_version_all: normalizeVersionPaths(checkedOutput(runner, "moon", ["version", "--all"])),
  };
}

export function main(
  args = process.argv.slice(2),
  runner: CommandRunner = runCommand,
  repoRoot = REPO_ROOT,
): number {
  const usage =
    "usage: node tooling/snapshot_toolchain.ts --date YYYY-MM-DD [--targets TARGET,...]";
  const parsed = parseCliArgs(
    {
      args,
      options: {
        date: { type: "string" },
        targets: {
          type: "string",
          default: "wasm-gc,wasm,js,native",
        },
      },
      strict: true,
    },
    usage,
  );
  if (!parsed.ok) {
    return parsed.exitCode;
  }
  const { values } = parsed.result;
  if (values.date === undefined) {
    return usageError("--date is required", usage);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date)) {
    return usageError("--date must be YYYY-MM-DD", usage);
  }

  const snapshotPath = join(repoRoot, "verification", "toolchains", "current.json");
  const snapshot = createSnapshot(values.date, values.targets.split(","), runner);
  mkdirSync(dirname(snapshotPath), { recursive: true });
  writeFileSync(snapshotPath, stableJson(snapshot), "utf8");
  console.log(`wrote ${relative(repoRoot, snapshotPath)}`);
  return 0;
}

function repr(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

if (isMain(import.meta.url)) {
  exitWith(main());
}

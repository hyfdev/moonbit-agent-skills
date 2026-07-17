import { readFileSync } from "node:fs";
import { join } from "node:path";
import { exitWith, isMain } from "./lib/cli.ts";
import type { CommandRunner } from "./lib/process.ts";
import { checkedOutput, runCommand } from "./lib/process.ts";
import { REPO_ROOT } from "./lib/repo.ts";
import { parseComponent } from "./snapshot_toolchain.ts";

interface Snapshot {
  components: Array<{ name: string; version: string }>;
}

interface InstalledVersions {
  items: Array<{ name: string; version: string }>;
}

export type Drift = Record<string, [expected: string, installed: string]>;

export function compareToolchains(snapshot: Snapshot, installed: InstalledVersions): Drift {
  const actual = new Map(installed.items.map((item) => [item.name, item]));
  return Object.fromEntries(
    snapshot.components
      .filter((component) => {
        const item = actual.get(component.name);
        if (item === undefined) {
          return true;
        }
        try {
          return parseComponent(item).version !== component.version;
        } catch {
          return true;
        }
      })
      .map((component) => [
        component.name,
        [component.version, actual.get(component.name)?.version ?? ""] as [string, string],
      ]),
  );
}

export function main(runner: CommandRunner = runCommand, repoRoot = REPO_ROOT): number {
  const displayed = checkedOutput(runner, "moon", ["version", "--all"]);
  console.log(displayed);
  const installed = JSON.parse(
    checkedOutput(runner, "moon", ["version", "--all", "--json"]),
  ) as InstalledVersions;
  const snapshot = JSON.parse(
    readFileSync(join(repoRoot, "verification", "toolchains", "current.json"), "utf8"),
  ) as Snapshot;
  const drift = compareToolchains(snapshot, installed);
  if (Object.keys(drift).length > 0) {
    console.log(
      `::warning::installed toolchain differs from committed snapshot (re-verify and re-stamp if content checks fail): ${JSON.stringify(drift)}`,
    );
  } else {
    console.log("installed toolchain matches the committed snapshot");
  }
  return 0;
}

if (isMain(import.meta.url)) {
  exitWith(main());
}

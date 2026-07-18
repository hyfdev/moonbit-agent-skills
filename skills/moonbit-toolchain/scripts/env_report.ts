#!/usr/bin/env node

import { accessSync, constants } from "node:fs";
import { delimiter, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export function findExecutable(name: string, pathValue = process.env.PATH ?? ""): string | undefined {
  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue;
    const candidate = resolve(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep searching PATH.
    }
  }
  return undefined;
}

function run(command: string, args: string[]): number {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    console.error(`${command}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

export function environmentReport(): number {
  console.log("--- moon version --all ---");
  let status = run("moon", ["version", "--all"]);
  if (status !== 0) return status;

  console.log("--- install ---");
  const moon = findExecutable("moon");
  if (!moon) return 1;
  console.log(moon);
  console.log(findExecutable("moonrun") ?? "moonrun: NOT FOUND");

  console.log("--- native backend prerequisites ---");
  const cc = findExecutable("cc");
  if (!cc) {
    console.log("cc: NOT FOUND (moon --target native will not link)");
  } else {
    const result = spawnSync(cc, ["--version"], { encoding: "utf8" });
    const firstLine = result.stdout?.split(/\r?\n/, 1)[0];
    console.log(`cc: ${firstLine || "version unavailable"}`);
  }

  console.log("--- os/arch ---");
  status = run("uname", ["-sm"]);
  return status;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(thisFile)) {
  process.exitCode = environmentReport();
}

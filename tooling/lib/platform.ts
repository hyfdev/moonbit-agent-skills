import { machine, release, type } from "node:os";
import type { CommandRunner } from "./process.ts";
import { checkedOutput, runCommand } from "./process.ts";

export interface PlatformInfo {
  os: string;
  os_version: string;
  arch: string;
}

export function normalizeOsName(os: string): string {
  return os === "Windows_NT" ? "Windows" : os;
}

export function currentPlatform(runner: CommandRunner = runCommand): PlatformInfo {
  const os = normalizeOsName(type());
  let osVersion = release();
  if (os === "Darwin") {
    osVersion = checkedOutput(runner, "sw_vers", ["-productVersion"]);
  }
  return { os, os_version: osVersion, arch: machine() };
}

export function platformStamp(): string {
  return `${normalizeOsName(type())}-${machine()}`;
}

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { parseArgs, type ParseArgsConfig } from "node:util";

export function isMain(metaUrl: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && resolve(entry) === fileURLToPath(metaUrl);
}

export function exitWith(code: number): void {
  process.exitCode = code;
}

export function parseCliArgs<T extends ParseArgsConfig>(config: T, usage: string) {
  const args = config.args ?? process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage);
    return { ok: false as const, exitCode: 0 };
  }
  try {
    return { ok: true as const, result: parseArgs(config) };
  } catch (error) {
    return { ok: false as const, exitCode: usageError((error as Error).message, usage) };
  }
}

export function usageError(message: string, usage: string): number {
  console.error(usage);
  console.error(`error: ${message}`);
  return 2;
}

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function isMain(metaUrl: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && resolve(entry) === fileURLToPath(metaUrl);
}

export function exitWith(code: number): void {
  process.exitCode = code;
}

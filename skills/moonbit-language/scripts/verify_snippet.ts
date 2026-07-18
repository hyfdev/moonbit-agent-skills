#!/usr/bin/env node

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export function runMoon(args: string[]): number {
  const result = spawnSync("moon", args, { stdio: "inherit" });
  if (result.error) {
    console.error(`moon: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

export function verifySnippet(source: string): number {
  const workdir = mkdtempSync(join(tmpdir(), "mbt-snippet-"));
  const document = join(workdir, "snippet.mbt.md");
  try {
    writeFileSync(document, `# snippet verification\n\n\`\`\`mbt check\n${source}\n\`\`\`\n`);
    let status = runMoon(["version", "--all", "--no-path"]);
    if (status !== 0) return status;
    console.log("--- moon check ---");
    status = runMoon(["check", document]);
    if (status !== 0) return status;
    console.log("--- moon test ---");
    return runMoon(["test", document]);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

function main(): number {
  const source = process.argv[2]
    ? readFileSync(resolve(process.argv[2]), "utf8")
    : readFileSync(0, "utf8");
  return verifySnippet(source);
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(thisFile)) {
  process.exitCode = main();
}

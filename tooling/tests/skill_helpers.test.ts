import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { verifySnippet } from "../../skills/moonbit-language/scripts/verify_snippet.ts";
import { findExecutable } from "../../skills/moonbit-toolchain/scripts/env_report.ts";

const originalPath = process.env.PATH;
const originalLog = process.env.MOON_HELPER_TEST_LOG;
const originalFailure = process.env.MOON_HELPER_TEST_FAILURE;

afterEach(() => {
  process.env.PATH = originalPath;
  if (originalLog === undefined) delete process.env.MOON_HELPER_TEST_LOG;
  else process.env.MOON_HELPER_TEST_LOG = originalLog;
  if (originalFailure === undefined) delete process.env.MOON_HELPER_TEST_FAILURE;
  else process.env.MOON_HELPER_TEST_FAILURE = originalFailure;
});

function fakeMoon(directory: string): string {
  const path = join(directory, "moon");
  writeFileSync(
    path,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.MOON_HELPER_TEST_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "check") {
  fs.appendFileSync(process.env.MOON_HELPER_TEST_LOG, fs.readFileSync(args[1], "utf8") + "\\n");
}
if (args[0] === process.env.MOON_HELPER_TEST_FAILURE) process.exit(7);
`,
  );
  chmodSync(path, 0o755);
  return path;
}

describe("skill TypeScript helpers", () => {
  it("finds an executable without invoking a shell", () => {
    const temporary = mkdtempSync(join(tmpdir(), "moon-helper-path-"));
    try {
      const bin = join(temporary, "bin");
      mkdirSync(bin);
      const moon = fakeMoon(bin);
      expect(findExecutable("moon", bin)).toBe(moon);
      expect(findExecutable("missing", bin)).toBeUndefined();
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("wraps stdin content and runs version, check, and test in order", () => {
    const temporary = mkdtempSync(join(tmpdir(), "moon-helper-run-"));
    try {
      const bin = join(temporary, "bin");
      mkdirSync(bin);
      fakeMoon(bin);
      const log = join(temporary, "calls.log");
      process.env.PATH = `${bin}:${originalPath ?? ""}`;
      process.env.MOON_HELPER_TEST_LOG = log;

      expect(verifySnippet('fn main { println("ok") }')).toBe(0);
      const output = readFileSync(log, "utf8");
      expect(output).toMatch(/^\["version","--all","--no-path"\]\n\["check","[^"]+"\]\n/);
      expect(output).toContain('```mbt check\nfn main { println("ok") }\n```');
      expect(output.trimEnd()).toMatch(/\["test","[^"]+"\]$/);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("preserves a failing moon command's exit code", () => {
    const temporary = mkdtempSync(join(tmpdir(), "moon-helper-fail-"));
    try {
      const bin = join(temporary, "bin");
      mkdirSync(bin);
      fakeMoon(bin);
      process.env.PATH = `${bin}:${originalPath ?? ""}`;
      process.env.MOON_HELPER_TEST_LOG = join(temporary, "calls.log");
      process.env.MOON_HELPER_TEST_FAILURE = "check";
      expect(verifySnippet("fn main { }")).toBe(7);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});

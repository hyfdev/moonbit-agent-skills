import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { REPO_ROOT } from "../lib/repo.ts";

function repositoryFiles(directory = REPO_ROOT): string[] {
  const files: string[] = [];
  for (const name of readdirSync(directory)) {
    if ([".git", "_build", "node_modules", "runs"].includes(name)) continue;
    const path = join(directory, name);
    const stats = statSync(path);
    if (stats.isDirectory()) files.push(...repositoryFiles(path));
    else if (stats.isFile()) files.push(path);
  }
  return files;
}

describe("repository TypeScript policy", () => {
  it("documents Node 24 as the only repository-tooling runtime", () => {
    const instructions = readFileSync(join(REPO_ROOT, "AGENTS.md"), "utf8");
    expect(instructions).toContain(
      "executable tooling, validators, generators, eval runners, and tests must be TypeScript run directly by Node.js 24",
    );
    expect(instructions).not.toMatch(/python\d*\s+-m|run_(?:activation|content)\.py/);
  });

  it("contains no repository-owned JavaScript, Python, or shell executables", () => {
    const forbidden = repositoryFiles()
      .filter((path) => [".cjs", ".js", ".mjs", ".py", ".sh"].includes(extname(path)))
      .map((path) => relative(REPO_ROOT, path));
    expect(forbidden).toEqual([]);
  });

  it("exposes every eval runner as a direct Node command", () => {
    const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts["run-activation-eval"]).toBe(
      "node evals/activation/run_activation.ts",
    );
    expect(packageJson.scripts["run-content-eval"]).toBe("node evals/run_content.ts");
    expect(packageJson.scripts["run-reporting-eval"]).toBe("node evals/reporting/run_reporting.ts");
  });
});

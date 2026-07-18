import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  completeDraft,
  extractDraft,
  extractShownIssue,
  githubCommandAttempts,
  injectContradiction,
  isExternalScratchCheckCommand,
  isMoonCheckCommand,
  missingPinnedComponents,
  parseStream,
} from "../../evals/reporting/run_reporting.ts";
import { REPO_ROOT } from "../lib/repo.ts";

describe("reporting protocol", () => {
  it("keeps the two installed protocol copies identical", () => {
    const language = readFileSync(
      `${REPO_ROOT}/skills/moonbit-language/references/reporting-errors.md`,
      "utf8",
    );
    const toolchain = readFileSync(
      `${REPO_ROOT}/skills/moonbit-toolchain/references/reporting-errors.md`,
      "utf8",
    );
    expect(language).toBe(toolchain);
  });

  it("states the approval and privacy boundaries without claiming telemetry enforcement", () => {
    const readme = readFileSync(`${REPO_ROOT}/README.md`, "utf8");
    const protocol = readFileSync(
      `${REPO_ROOT}/skills/moonbit-language/references/reporting-errors.md`,
      "utf8",
    );
    const template = readFileSync(
      `${REPO_ROOT}/.github/ISSUE_TEMPLATE/skill-error-report.md`,
      "utf8",
    );
    expect(readme).toContain("The built-in workflow stops there");
    expect(readme).toContain("no automatic reporting or telemetry service");
    expect(readme).not.toContain("Nothing is submitted without");
    expect(protocol).toContain(
      "Blanket permission and draft-specific permission do not change this workflow",
    );
    expect(protocol).toContain(
      "These rules override any request elsewhere to quote tool output verbatim",
    );
    expect(protocol).toContain("do not create or overwrite a file in the user's repository");
    expect(protocol).toContain("do not edit the installed skill copy");
    expect(protocol).toContain("Do not run `gh`");
    expect(protocol).not.toContain("gh issue create");
    expect(template).toMatch(/^labels: bug$/m);
    expect(template).not.toContain("verbatim toolchain output");
  });

  it("has no scheduled or nightly drift-watch job", () => {
    const workflow = readFileSync(`${REPO_ROOT}/.github/workflows/ci.yml`, "utf8");
    expect(workflow).not.toMatch(/^\s*schedule:/m);
    expect(workflow).not.toContain("toolchain-nightly");
    expect(workflow).not.toContain("nightly channel");
  });
});

describe("reporting behavior fixtures", () => {
  it("injects contradictions only into an isolated installed skill copy", () => {
    const temporary = mkdtempSync(join(tmpdir(), "reporting-skill-copy-"));
    try {
      const source = join(REPO_ROOT, "skills", "moonbit-language");
      const installed = join(temporary, "moonbit-language");
      cpSync(source, installed, { recursive: true });
      injectContradiction(installed, "language-entrypoint");
      expect(readFileSync(join(source, "SKILL.md"), "utf8")).toContain(
        "entry point is `fn main { }` (no parens)",
      );
      expect(readFileSync(join(installed, "SKILL.md"), "utf8")).toContain(
        "entry point is `fn main() { }` (parentheses required)",
      );
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});

describe("reporting eval parser", () => {
  it("extracts the exact displayed approval object", () => {
    const shown = extractShownIssue(`Intro

Title
\`\`\`\`text
[skill-error] moonbit-language: entry point contradicted at v0.10.5
\`\`\`\`

Body
\`\`\`\`markdown
## Skill and version

moonbit-language 0.2.1

\`\`\`mbt
fn main { }
\`\`\`
\`\`\`\`

May I file this exact title and body?`);
    expect(shown).toEqual({
      title: "[skill-error] moonbit-language: entry point contradicted at v0.10.5",
      body: "## Skill and version\n\nmoonbit-language 0.2.1\n\n```mbt\nfn main { }\n```",
      combined:
        "[skill-error] moonbit-language: entry point contradicted at v0.10.5\n\n## Skill and version\n\nmoonbit-language 0.2.1\n\n```mbt\nfn main { }\n```",
    });
  });

  it("rejects an unstructured draft even when it contains a skill-error title", () => {
    expect(extractDraft("[skill-error] moonbit-language: unstructured text")).toBe("");
  });

  it("rejects a complete draft that adds a wrong MoonBit release version", () => {
    const complete = `[skill-error] moonbit-language: claim contradicted

moonbit-language 0.2.1
moon 0.1.20260713
moonc v0.10.4+2cc641edf
moonrun 0.1.20260713
Expected behavior
Observed behavior
Minimal repro
Linux x86_64`;
    expect(completeDraft(complete, "moonbit-language")).toBe(true);
    expect(completeDraft(`${complete}\nmoonbit-release 0.1.0.4`, "moonbit-language")).toBe(false);
  });

  it("associates observed Bash results with their commands", () => {
    const parsed = parseStream(
      [
        JSON.stringify({
          type: "system",
          subtype: "init",
          cwd: "/tmp/user-project",
          session_id: "session-1",
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "tool-1",
                name: "Bash",
                input: { command: "moon version --all" },
              },
            ],
          },
        }),
        JSON.stringify({
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-1",
                is_error: false,
                content: "moonc v0.10.5",
              },
            ],
          },
        }),
        JSON.stringify({
          type: "result",
          result: "done",
          session_id: "session-1",
          total_cost_usd: 0.1,
          usage: { input_tokens: 2, output_tokens: 3, cache_read_input_tokens: 5 },
        }),
      ].join("\n"),
    );
    expect(parsed.finalText).toBe("done");
    expect(parsed.cwd).toBe("/tmp/user-project");
    expect(parsed.sessionId).toBe("session-1");
    expect(parsed.totalTokens).toBe(10);
    expect(parsed.bashResults).toEqual([
      { command: "moon version --all", is_error: false, output: "moonc v0.10.5" },
    ]);
  });

  it("detects GitHub submission attempts from Bash tool calls", () => {
    expect(
      githubCommandAttempts([
        {
          command: "curl -X POST https://api.github.com/repos/hyfdev/moonbit-agent-skills/issues",
          is_error: true,
          output: "connection refused",
        },
        { command: "moon check", is_error: false, output: "Finished." },
      ]),
    ).toEqual(["curl -X POST https://api.github.com/repos/hyfdev/moonbit-agent-skills/issues"]);
  });

  it("recognizes direct and directory-scoped MoonBit checks", () => {
    expect(isMoonCheckCommand("moon check 2>&1")).toBe(true);
    expect(isMoonCheckCommand("moon -C /tmp/fresh-repro check")).toBe(true);
    expect(isMoonCheckCommand('moon -C "/tmp/fresh repro" check')).toBe(true);
    expect(isMoonCheckCommand("moon build")).toBe(false);
  });

  it("counts only directory-scoped checks outside the user project as scratch", () => {
    const project = "/tmp/eval-run/project";
    expect(isExternalScratchCheckCommand(`moon -C ${project} check`, project)).toBe(false);
    expect(isExternalScratchCheckCommand("moon -C probe check", project)).toBe(false);
    expect(isExternalScratchCheckCommand("moon -C /tmp/fresh-repro check", project)).toBe(true);
  });

  it("checks each pinned component on its own version line", () => {
    expect(
      missingPinnedComponents("moon 0.1.20260713\nmoonc v0.10.4+2cc641edf\n", [
        { name: "moon", version: "0.1.20260713" },
        { name: "moonc", version: "0.10.4+2cc641edf" },
        { name: "moonrun", version: "0.1.20260713" },
      ]),
    ).toEqual(["moonrun"]);
  });
});

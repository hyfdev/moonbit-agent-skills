import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { normalizeUnit } from "../check_duplication.ts";
import { compareToolchains, main as compareMain } from "../compare_toolchain.ts";
import { blockInventory, generateReadme } from "../gen_readme.ts";
import { runSkill } from "../run_checked_docs.ts";
import { checkOne, main as fixturesMain } from "../run_fixtures.ts";
import { createSnapshot, parseComponent, VERSION_RE } from "../snapshot_toolchain.ts";
import { NAME_RE } from "../validate_skills.ts";
import { parseFrontmatter } from "../lib/frontmatter.ts";
import type { CommandRunner } from "../lib/process.ts";
import { REPO_ROOT } from "../lib/repo.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("version parsing", () => {
  it("parses moon style", () => {
    const component = parseComponent({
      name: "moon",
      version: "0.1.20260713 (75c7e1f 2026-07-13)",
    });
    expect(component.version).toBe("0.1.20260713");
    expect(component.commit).toBe("75c7e1f");
    expect(component.build_date).toBe("2026-07-13");
  });

  it("parses moonc style with a plus commit", () => {
    const component = parseComponent({
      name: "moonc",
      version: "v0.10.4+ade96c819 (2026-07-13)",
    });
    expect(component.version).toBe("0.10.4+ade96c819");
    expect(component.commit).toBe("");
  });

  it("parses a repeated moonrun name", () => {
    const component = parseComponent({
      name: "moonrun",
      version: "moonrun 0.1.20260713 (75c7e1f 2026-07-13)",
    });
    expect(component.version).toBe("0.1.20260713");
  });

  it("rejects garbage", () => {
    expect(VERSION_RE.test("latest")).toBe(false);
    expect(() => parseComponent({ name: "moon", version: "unknown" })).toThrow(
      "unrecognized version string",
    );
  });
});

describe("frontmatter", () => {
  it("parses scalars and nested metadata", () => {
    const parsed = parseFrontmatter(
      "---\n" +
        "name: my-skill\n" +
        "description: Does things. Use when things need doing.\n" +
        "metadata:\n" +
        '  skill-version: "0.1.0"\n' +
        "  verified-date: 2026-07-17\n" +
        "---\n" +
        "# Body\n",
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.frontmatter.name).toBe("my-skill");
    expect(parsed.frontmatter.metadata).toEqual({
      "skill-version": "0.1.0",
      "verified-date": "2026-07-17",
    });
    expect(parsed.body.startsWith("# Body")).toBe(true);
  });

  it("reports missing frontmatter", () => {
    expect(parseFrontmatter("# no frontmatter\n").errors.length).toBeGreaterThan(0);
  });

  it("reports unclosed frontmatter", () => {
    expect(parseFrontmatter("---\nname: x\n").errors.length).toBeGreaterThan(0);
  });
});

describe("skill names", () => {
  it("accepts valid names", () => {
    for (const name of ["moonbit-language", "a", "x1-y2"]) {
      expect(NAME_RE.test(name), name).toBe(true);
    }
  });

  it("rejects invalid names", () => {
    for (const name of ["Moonbit", "-x", "x-", "a--b", "a_b", ""]) {
      expect(NAME_RE.test(name), name).toBe(false);
    }
  });
});

it("normalizes duplication units without case or whitespace differences", () => {
  expect(normalizeUnit("Errors are  raised\nwith `raise`.")).toBe(
    normalizeUnit("errors are raised with `raise`."),
  );
});

describe("toolchain comparison", () => {
  it("reports only missing or mismatched components", () => {
    expect(
      compareToolchains(
        {
          components: [
            { name: "moon", version: "0.1.2" },
            { name: "moonc", version: "0.10.4" },
          ],
        },
        {
          items: [
            { name: "moon", version: "0.1.2 (abc 2026-07-17)" },
            { name: "moonc", version: "v0.10.5 (2026-07-18)" },
          ],
        },
      ),
    ).toEqual({ moonc: ["0.10.4", "v0.10.5 (2026-07-18)"] });
  });

  it("does not confuse a version with a longer version that shares its prefix", () => {
    expect(
      compareToolchains(
        { components: [{ name: "moon", version: "0.1.2" }] },
        {
          items: [
            {
              name: "moon",
              version: "0.1.20 (abcdef0 2026-07-18)",
            },
          ],
        },
      ),
    ).toEqual({ moon: ["0.1.2", "0.1.20 (abcdef0 2026-07-18)"] });
  });

  it("runs with an injected command runner instead of a real moon binary", () => {
    const temporary = mkdtempSync(join(tmpdir(), "compare-toolchain-test-"));
    try {
      const snapshotDirectory = join(temporary, "verification", "toolchains");
      mkdirSync(snapshotDirectory, { recursive: true });
      writeFileSync(
        join(snapshotDirectory, "current.json"),
        JSON.stringify({
          components: [
            { name: "moon", version: "0.1.2" },
            { name: "moonc", version: "0.10.4" },
          ],
        }),
      );
      const calls: string[] = [];
      const runner: CommandRunner = (command, args) => {
        calls.push([command, ...args].join(" "));
        if (args.at(-1) === "--json") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              items: [
                { name: "moon", version: "0.1.2 (abc 2026-07-17)" },
                { name: "moonc", version: "v0.10.4 (2026-07-17)" },
              ],
            }),
            stderr: "",
          };
        }
        return { exitCode: 0, stdout: "moon 0.1.2\nmoonc v0.10.4\n", stderr: "" };
      };
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

      expect(compareMain(runner, temporary)).toBe(0);
      expect(calls).toEqual(["moon version --all", "moon version --all --json"]);
      expect(log).toHaveBeenLastCalledWith("installed toolchain matches the committed snapshot");
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});

it("keeps the real generated README byte-for-byte unchanged", () => {
  const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
  expect(generateReadme(readme)).toBe(readme);
});

it("counts a skill with no references directory", () => {
  const temporary = mkdtempSync(join(tmpdir(), "readme-inventory-test-"));
  try {
    const skill = join(temporary, "skills", "minimal-skill");
    mkdirSync(skill, { recursive: true });
    mkdirSync(join(temporary, "verification", "fixtures"), {
      recursive: true,
    });
    writeFileSync(
      join(skill, "SKILL.md"),
      "---\nname: minimal-skill\ndescription: Test.\nmetadata:\n  skill-version: 0.1.0\n---\n# Minimal\n",
    );

    expect(blockInventory(temporary)).toContain(
      "`minimal-skill` v0.1.0: SKILL.md (2 lines) + 0 reference file(s)",
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

it("creates a deterministic snapshot from an injected runner", () => {
  const runner: CommandRunner = (command, args) => {
    if (command === "sw_vers") {
      return { exitCode: 0, stdout: "26.5.1\n", stderr: "" };
    }
    if (args.at(-1) === "--json") {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          items: [
            {
              name: "moon",
              version: "0.1.20260713 (75c7e1f 2026-07-13)",
            },
            {
              name: "moonc",
              version: "v0.10.4+ade96c819 (2026-07-13)",
            },
          ],
        }),
        stderr: "",
      };
    }
    return {
      exitCode: 0,
      stdout: "moon 0.1.20260713\nmoonc v0.10.4+ade96c819\n",
      stderr: "",
    };
  };

  const snapshot = createSnapshot("2026-07-18", ["wasm-gc", "js"], runner);
  expect(snapshot._generated_by).toBe("tooling/snapshot_toolchain.ts (do not edit by hand)");
  expect(snapshot.verification_date).toBe("2026-07-18");
  expect(snapshot.verified_targets).toEqual(["js", "wasm-gc"]);
  expect(snapshot.components).toEqual([
    {
      name: "moon",
      version: "0.1.20260713",
      commit: "75c7e1f",
      build_date: "2026-07-13",
      raw: "0.1.20260713 (75c7e1f 2026-07-13)",
    },
    {
      name: "moonc",
      version: "0.10.4+ade96c819",
      commit: "",
      build_date: "2026-07-13",
      raw: "v0.10.4+ade96c819 (2026-07-13)",
    },
  ]);
  expect(snapshot.raw_version_all).toBe("moon 0.1.20260713\nmoonc v0.10.4+ade96c819");
});

it("runs checked docs in check/test order for every target", () => {
  const temporary = mkdtempSync(join(tmpdir(), "checked-docs-test-"));
  try {
    const references = join(temporary, "skills", "demo", "references");
    mkdirSync(references, { recursive: true });
    writeFileSync(join(references, "example.mbt.md"), "```mbt check\ntest {}\n```\n");
    const calls: string[] = [];
    const workDirectories: string[] = [];
    const runner: CommandRunner = (command, args, options) => {
      if (options?.cwd === undefined) {
        throw new Error("checked-doc runner did not set cwd");
      }
      calls.push([command, ...args].join(" "));
      workDirectories.push(options.cwd);
      expect(options.timeout).toBe(600_000);
      expect(existsSync(join(options.cwd, "example.mbt.md"))).toBe(true);
      return {
        exitCode: 0,
        stdout: args[0] === "test" ? "Total tests: 1, passed: 1, failed: 0.\n" : "",
        stderr: "",
      };
    };
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    expect(runSkill("demo", ["js", "native"], runner, temporary)).toBe(0);
    expect(calls).toEqual([
      "moon check --target js --no-render",
      "moon test --target js --no-render",
      "moon check --target native --no-render",
      "moon test --target native --no-render",
    ]);
    expect(workDirectories.every((directory) => !existsSync(directory))).toBe(true);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

it("checks an expected diagnostic and then verifies fixed.mbt", () => {
  const temporary = mkdtempSync(join(tmpdir(), "fixture-fixed-test-"));
  try {
    writeFileSync(
      join(temporary, "fixture.json"),
      JSON.stringify({
        id: "negative-with-fix",
        expect: "check-fail",
        diagnostic_contains: ["expected diagnostic"],
      }),
    );
    writeFileSync(join(temporary, "code.mbt"), "BROKEN");
    writeFileSync(join(temporary, "fixed.mbt"), "FIXED");
    const materialized: string[] = [];
    const runner: CommandRunner = (_command, _args, options) => {
      if (options?.cwd === undefined) {
        throw new Error("fixture runner did not set cwd");
      }
      const code = readFileSync(join(options.cwd, "lib.mbt"), "utf8");
      materialized.push(code);
      return code === "BROKEN"
        ? { exitCode: 255, stdout: "", stderr: "expected diagnostic" }
        : { exitCode: 0, stdout: "", stderr: "" };
    };

    expect(checkOne(temporary, false, runner)).toEqual({ ok: true, detail: "" });
    expect(materialized).toEqual(["BROKEN", "FIXED"]);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

it("stamps only fixtures that passed", () => {
  const temporary = mkdtempSync(join(tmpdir(), "fixture-stamp-test-"));
  try {
    const fixtures = join(temporary, "verification", "fixtures");
    for (const [id, code] of [
      ["passes", "PASS"],
      ["fails", "FAIL"],
    ]) {
      const directory = join(fixtures, id);
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, "fixture.json"),
        `${JSON.stringify({ id, expect: "check-pass" }, undefined, 2)}\n`,
      );
      writeFileSync(join(directory, "code.mbt"), code);
    }
    const runner: CommandRunner = (_command, args, options) => {
      if (args.at(-1) === "--json") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            items: [{ name: "moon", version: "moon version" }],
          }),
          stderr: "",
        };
      }
      if (options?.cwd === undefined) {
        throw new Error("fixture runner did not set cwd");
      }
      const code = readFileSync(join(options.cwd, "lib.mbt"), "utf8");
      return code === "PASS"
        ? { exitCode: 0, stdout: "", stderr: "" }
        : { exitCode: 1, stdout: "", stderr: "broken" };
    };
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(fixturesMain(["--stamp", "--date", "2026-07-18"], runner, temporary)).toBe(1);
    const passing = JSON.parse(readFileSync(join(fixtures, "passes", "fixture.json"), "utf8")) as {
      verified?: { date: string };
    };
    const failing = JSON.parse(readFileSync(join(fixtures, "fails", "fixture.json"), "utf8")) as {
      verified?: unknown;
    };
    expect(passing.verified?.date).toBe("2026-07-18");
    expect(failing.verified).toBeUndefined();
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

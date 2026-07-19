import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { normalizeUnit } from "../check_duplication.ts";
import { skillRevisionProblems } from "../check_skill_versions.ts";
import { compareToolchains, main as compareMain } from "../compare_toolchain.ts";
import { runSkill } from "../run_checked_docs.ts";
import { checkOne, main as fixturesMain, materialize } from "../run_fixtures.ts";
import { main as snapshotReleaseMain } from "../snapshot_release.ts";
import {
  createSnapshot,
  main as snapshotMain,
  normalizeVersionPaths,
  parseComponent,
  VERSION_RE,
} from "../snapshot_toolchain.ts";
import {
  isIsoDate,
  NAME_RE,
  readmeCatalogProblems,
  readmeStatusRow,
  SKILL_VERSION_RE,
  validateSkill,
} from "../validate_skills.ts";
import { parseFrontmatter, stringMap } from "../lib/frontmatter.ts";
import { parseCliArgs } from "../lib/cli.ts";
import { normalizeOsName } from "../lib/platform.ts";
import type { CommandRunner } from "../lib/process.ts";
import { REPO_ROOT } from "../lib/repo.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

it("keeps the existing Windows platform stamp spelling", () => {
  expect(normalizeOsName("Windows_NT")).toBe("Windows");
  expect(normalizeOsName("Darwin")).toBe("Darwin");
  expect(normalizeOsName("Linux")).toBe("Linux");
});

describe("TypeScript CLI behavior", () => {
  it("prints help without parsing options or a stack trace", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(
      parseCliArgs(
        { args: ["--help"], options: { value: { type: "string" } }, strict: true },
        "usage: example [--value VALUE]",
      ),
    ).toEqual({ ok: false, exitCode: 0 });
    expect(log).toHaveBeenCalledWith("usage: example [--value VALUE]");
    expect(error).not.toHaveBeenCalled();
  });

  it("reports unknown options as usage errors", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(
      parseCliArgs(
        { args: ["--unknown"], options: { value: { type: "string" } }, strict: true },
        "usage: example [--value VALUE]",
      ),
    ).toEqual({ ok: false, exitCode: 2 });
    expect(error.mock.calls.flat().join("\n")).toMatch(/usage: example/);
    expect(error.mock.calls.flat().join("\n")).toMatch(/Unknown option '--unknown'/);
    expect(error.mock.calls.flat().join("\n")).not.toMatch(/node:internal|at parseArgs/);
  });

  it("uses exit 2 for missing required CLI arguments", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(snapshotMain([])).toBe(2);
    expect(await snapshotReleaseMain([])).toBe(2);
  });
});

describe("version parsing", () => {
  it("normalizes an explicit Moon home in the raw version report", () => {
    expect(
      normalizeVersionPaths(
        "moon 0.1.2 /tmp/pinned-moon/bin/moon\nmoonc 0.10.4 /tmp/pinned-moon/bin/moonc",
        "/tmp/pinned-moon/",
      ),
    ).toBe("moon 0.1.2 <MOON_HOME>/bin/moon\nmoonc 0.10.4 <MOON_HOME>/bin/moonc");
  });

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
        "  updated-date: 2026-07-18\n" +
        "  verified-date: 2026-07-17\n" +
        "---\n" +
        "# Body\n",
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.frontmatter.name).toBe("my-skill");
    expect(parsed.frontmatter.metadata).toEqual({
      "skill-version": "0.1.0",
      "updated-date": "2026-07-18",
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

describe("skill freshness metadata", () => {
  it("accepts SemVer skill versions and real ISO dates", () => {
    expect(SKILL_VERSION_RE.test("0.3.1")).toBe(true);
    expect(SKILL_VERSION_RE.test("2026.07.19")).toBe(false);
    expect(isIsoDate("2026-07-19")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
  });

  it("keeps the public README status synchronized with installed metadata", () => {
    const skillDirectories = [
      join(REPO_ROOT, "skills", "moonbit-language"),
      join(REPO_ROOT, "skills", "moonbit-toolchain"),
    ];
    const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
    expect(readmeCatalogProblems(readme, skillDirectories)).toEqual([]);
    const languageSkill = readFileSync(join(skillDirectories[0], "SKILL.md"), "utf8");
    const metadata = stringMap(parseFrontmatter(languageSkill).frontmatter, "metadata") ?? {};
    const currentRow = readmeStatusRow("moonbit-language", metadata);
    const staleRow = currentRow.replace(metadata["skill-version"], "stale");
    expect(readmeCatalogProblems(readme.replace(currentRow, staleRow), skillDirectories)).toContain(
      "README: moonbit-language status does not match SKILL.md metadata",
    );
  });

  it("requires changed skill content to carry a newer version and current change date", () => {
    const before = skillDocument("0.3.0", "2026-07-18", "old guidance");
    const unchangedIdentity = skillDocument("0.3.0", "2026-07-18", "new guidance");
    expect(
      skillRevisionProblems("moonbit-language", before, unchangedIdentity, "2026-07-19"),
    ).toEqual([
      "moonbit-language: changed content must increase metadata.skill-version above '0.3.0' (found '0.3.0')",
      "moonbit-language: metadata.updated-date must match latest skill change date '2026-07-19' (found '2026-07-18')",
    ]);

    expect(
      skillRevisionProblems(
        "moonbit-language",
        before,
        skillDocument("0.3.1", "2026-07-19", "new guidance"),
        "2026-07-19",
      ),
    ).toEqual([]);
  });
});

it("requires repository-maintenance skills to stay internal", () => {
  const temporary = mkdtempSync(join(tmpdir(), "internal-skill-test-"));
  try {
    const skill = join(temporary, "release-maintainer");
    mkdirSync(skill);
    writeFileSync(
      join(skill, "SKILL.md"),
      "---\nname: release-maintainer\ndescription: Maintain releases.\nmetadata:\n  skill-version: 0.1.0\n  updated-date: 2026-07-19\n  scope: repository-maintenance\n---\n# Maintainer\n",
    );
    expect(validateSkill(skill)).toContain(
      "release-maintainer: repository-maintenance skills must set metadata.internal: true",
    );

    writeFileSync(
      join(skill, "SKILL.md"),
      "---\nname: release-maintainer\ndescription: Maintain releases.\nmetadata:\n  skill-version: 0.1.0\n  updated-date: 2026-07-19\n  scope: repository-maintenance\n  internal: true\n---\n# Maintainer\n",
    );
    expect(validateSkill(skill)).not.toContain(
      "release-maintainer: repository-maintenance skills must set metadata.internal: true",
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

it("keeps the documented public install from opting into internal skills", () => {
  const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
  expect(readme).not.toMatch(/npx skills[^\n]*(?:-s|--skill)\s+["']?\*/);
  expect(readme).not.toMatch(/npx skills[^\n]*moonbit-agent-skills-maintainer/);
});

it("normalizes duplication units without case or whitespace differences", () => {
  expect(normalizeUnit("Errors are  raised\nwith `raise`.")).toBe(
    normalizeUnit("errors are raised with `raise`."),
  );
});

function skillDocument(version: string, updatedDate: string, body: string): string {
  return (
    "---\n" +
    "name: moonbit-language\n" +
    "description: MoonBit language reference.\n" +
    "metadata:\n" +
    `  skill-version: "${version}"\n` +
    `  updated-date: "${updatedDate}"\n` +
    "---\n" +
    `${body}\n`
  );
}

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
        moon_args: ["--warn-list", "+example_warning", "--deny-warn"],
        diagnostic_contains: ["expected diagnostic"],
      }),
    );
    writeFileSync(join(temporary, "code.mbt"), "BROKEN");
    writeFileSync(join(temporary, "fixed.mbt"), "FIXED");
    const materialized: string[] = [];
    const calls: (readonly string[])[] = [];
    const runner: CommandRunner = (_command, args, options) => {
      if (options?.cwd === undefined) {
        throw new Error("fixture runner did not set cwd");
      }
      calls.push(args);
      const code = readFileSync(join(options.cwd, "lib.mbt"), "utf8");
      materialized.push(code);
      return code === "BROKEN"
        ? { exitCode: 255, stdout: "", stderr: "expected diagnostic" }
        : { exitCode: 0, stdout: "", stderr: "" };
    };

    expect(checkOne(temporary, false, runner)).toEqual({ ok: true, detail: "" });
    expect(materialized).toEqual(["BROKEN", "FIXED"]);
    expect(calls).toEqual([
      [
        "check",
        "--target",
        "wasm-gc",
        "--warn-list",
        "+example_warning",
        "--deny-warn",
        "--no-render",
      ],
      [
        "check",
        "--target",
        "wasm-gc",
        "--warn-list",
        "+example_warning",
        "--deny-warn",
        "--no-render",
      ],
    ]);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

it("rejects a test-pass fixture when Moon reports zero tests", () => {
  const temporary = mkdtempSync(join(tmpdir(), "fixture-zero-tests-test-"));
  try {
    writeFileSync(
      join(temporary, "fixture.json"),
      JSON.stringify({ id: "zero-tests", expect: "test-pass", targets: ["js", "native"] }),
    );
    writeFileSync(join(temporary, "code.mbt"), "pub fn helper() -> Unit {}\n");
    const runner: CommandRunner = () => ({
      exitCode: 0,
      stdout: "Total tests: 0, passed: 0, failed: 0.\n",
      stderr: "",
    });

    expect(checkOne(temporary, false, runner)).toEqual({
      ok: false,
      detail:
        "[js] successful moon test ran zero tests\n[native] successful moon test ran zero tests",
    });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

it("accepts a test-pass fixture only when each target reports tests", () => {
  const temporary = mkdtempSync(join(tmpdir(), "fixture-positive-tests-test-"));
  try {
    writeFileSync(
      join(temporary, "fixture.json"),
      JSON.stringify({ id: "positive-tests", expect: "test-pass", targets: ["js", "native"] }),
    );
    writeFileSync(join(temporary, "code.mbt"), "test {}\n");
    const runner: CommandRunner = (_command, args) => ({
      exitCode: 0,
      stdout: `Total tests: ${args.includes("js") ? 1 : 2}, passed: ${args.includes("js") ? 1 : 2}, failed: 0.\n`,
      stderr: "",
    });

    expect(checkOne(temporary, false, runner)).toEqual({ ok: true, detail: "" });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

it("uses a fixture-specific module name to isolate Moon test caches", () => {
  const temporary = mkdtempSync(join(tmpdir(), "fixture-module-name-test-"));
  try {
    const firstFixture = join(temporary, "first-fixture");
    const secondFixture = join(temporary, "second-fixture");
    const firstWork = join(temporary, "first-work");
    const secondWork = join(temporary, "second-work");
    for (const directory of [firstFixture, secondFixture, firstWork, secondWork]) {
      mkdirSync(directory);
    }
    writeFileSync(join(firstFixture, "code.mbt"), "test {}\n");
    writeFileSync(join(secondFixture, "code.mbt"), "test {}\n");

    const firstModule = materialize(firstFixture, firstWork, "code.mbt");
    const secondModule = materialize(secondFixture, secondWork, "code.mbt");
    expect(readFileSync(join(firstModule, "moon.mod"), "utf8")).toContain(
      'name = "mbtskills/first_fixture"',
    );
    expect(readFileSync(join(secondModule, "moon.mod"), "utf8")).toContain(
      'name = "mbtskills/second_fixture"',
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

it("runs the fixed test for a semantic-trap fixture", () => {
  const temporary = mkdtempSync(join(tmpdir(), "fixture-semantic-fix-test-"));
  try {
    writeFileSync(
      join(temporary, "fixture.json"),
      JSON.stringify({ id: "semantic-with-fix", expect: "semantic-trap" }),
    );
    writeFileSync(join(temporary, "code.mbt"), "OLD_BEHAVIOR");
    writeFileSync(join(temporary, "fixed.mbt"), "FIXED_BEHAVIOR_TEST");
    const calls: (readonly string[])[] = [];
    const materialized: string[] = [];
    const runner: CommandRunner = (_command, args, options) => {
      if (options?.cwd === undefined) {
        throw new Error("fixture runner did not set cwd");
      }
      calls.push(args);
      materialized.push(readFileSync(join(options.cwd, "lib.mbt"), "utf8"));
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    expect(checkOne(temporary, false, runner)).toEqual({ ok: true, detail: "" });
    expect(materialized).toEqual(["OLD_BEHAVIOR", "FIXED_BEHAVIOR_TEST"]);
    expect(calls).toEqual([
      ["test", "--target", "wasm-gc", "--no-render"],
      ["test", "--target", "wasm-gc", "--no-render"],
    ]);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

it("requires the old form to fail at runtime before testing its replacement", () => {
  const temporary = mkdtempSync(join(tmpdir(), "fixture-runtime-fix-test-"));
  try {
    writeFileSync(
      join(temporary, "fixture.json"),
      JSON.stringify({
        id: "runtime-failure-with-fix",
        expect: "runtime-fail",
        diagnostic_contains: ["observed runtime failure"],
      }),
    );
    writeFileSync(join(temporary, "code.mbt"), "OLD_FORM_EXECUTED");
    writeFileSync(join(temporary, "fixed.mbt"), "REPLACEMENT_ASSERTION");
    const calls: (readonly string[])[] = [];
    const materialized: string[] = [];
    const runner: CommandRunner = (_command, args, options) => {
      if (options?.cwd === undefined) {
        throw new Error("fixture runner did not set cwd");
      }
      calls.push(args);
      const code = readFileSync(join(options.cwd, "lib.mbt"), "utf8");
      materialized.push(code);
      return code === "OLD_FORM_EXECUTED"
        ? { exitCode: 2, stdout: "observed runtime failure", stderr: "" }
        : { exitCode: 0, stdout: "replacement assertion passed", stderr: "" };
    };

    expect(checkOne(temporary, false, runner)).toEqual({ ok: true, detail: "" });
    expect(materialized).toEqual(["OLD_FORM_EXECUTED", "REPLACEMENT_ASSERTION"]);
    expect(calls).toEqual([
      ["test", "--target", "wasm-gc", "--no-render"],
      ["test", "--target", "wasm-gc", "--no-render"],
    ]);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

it("rejects malformed fixture moon_args without running Moon", () => {
  const temporary = mkdtempSync(join(tmpdir(), "fixture-moon-args-test-"));
  try {
    writeFileSync(
      join(temporary, "fixture.json"),
      JSON.stringify({
        id: "malformed-moon-args",
        expect: "check-pass",
        moon_args: "--deny-warn",
      }),
    );
    writeFileSync(join(temporary, "code.mbt"), "test {}\n");
    const runner = vi.fn<CommandRunner>();

    expect(checkOne(temporary, false, runner)).toEqual({
      ok: false,
      detail: "moon_args must be an array of strings",
    });
    expect(runner).not.toHaveBeenCalled();
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

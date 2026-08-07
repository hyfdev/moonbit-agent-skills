import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  latestUpstreamProblems,
  LATEST_DOCS_URL,
  LATEST_TOOLCHAIN_URL,
} from "../verify_latest_upstream.ts";

const DOCS_COMMIT = "d".repeat(40);

describe("latest upstream gate", () => {
  it("accepts exact official latest toolchain and docs pins", async () => {
    const temporary = createRepository();
    try {
      expect(await latestUpstreamProblems(temporary, matchingFetcher())).toEqual([]);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("reports toolchain and docs drift", async () => {
    const temporary = createRepository();
    try {
      const problems = await latestUpstreamProblems(temporary, async (url) => {
        if (url === LATEST_TOOLCHAIN_URL) {
          return response({
            items: [
              { name: "moon", version: "0.1.20260804 (eeeeeee 2026-08-04)" },
              { name: "moonc", version: "v0.10.7+fffffffff (2026-08-05)" },
              { name: "moonrun", version: "moonrun 0.1.20260804 (eeeeeee 2026-08-04)" },
            ],
          });
        }
        if (url === LATEST_DOCS_URL) {
          return response({ sha: "f".repeat(40) });
        }
        throw new Error(`unexpected URL ${url}`);
      });
      expect(problems).toHaveLength(4);
      expect(problems.join("\n")).toContain("moon: committed");
      expect(problems.join("\n")).toContain("moonc: committed");
      expect(problems.join("\n")).toContain("moonrun: committed");
      expect(problems.join("\n")).toContain("latest docs main");
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});

function createRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "latest-upstream-test-"));
  mkdirSync(join(root, "verification", "toolchains"), { recursive: true });
  mkdirSync(join(root, "verification", "language-surface"), { recursive: true });
  writeFileSync(
    join(root, "verification", "toolchains", "current.json"),
    JSON.stringify({
      components: [
        {
          name: "moon",
          version: "0.1.20260803",
          commit: "c19f78e",
          build_date: "2026-08-03",
          raw: "0.1.20260803 (c19f78e 2026-08-03)",
        },
        {
          name: "moonc",
          version: "0.10.6+80dc50f24",
          commit: "",
          build_date: "2026-08-04",
          raw: "v0.10.6+80dc50f24 (2026-08-04)",
        },
        {
          name: "moonrun",
          version: "0.1.20260803",
          commit: "c19f78e",
          build_date: "2026-08-03",
          raw: "moonrun 0.1.20260803 (c19f78e 2026-08-03)",
        },
      ],
    }),
  );
  writeFileSync(
    join(root, "verification", "language-surface", "source.json"),
    JSON.stringify({ source: { commit: DOCS_COMMIT } }),
  );
  return root;
}

function matchingFetcher() {
  return async (url: string) => {
    if (url === LATEST_TOOLCHAIN_URL) {
      return response({
        items: [
          { name: "moon", version: "0.1.20260803 (c19f78e 2026-08-03)" },
          { name: "moonc", version: "v0.10.6+80dc50f24 (2026-08-04)" },
          { name: "moonrun", version: "moonrun 0.1.20260803 (c19f78e 2026-08-03)" },
        ],
      });
    }
    if (url === LATEST_DOCS_URL) {
      return response({ sha: DOCS_COMMIT });
    }
    throw new Error(`unexpected URL ${url}`);
  };
}

function response(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

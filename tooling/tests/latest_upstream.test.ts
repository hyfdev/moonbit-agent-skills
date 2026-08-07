import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  latestUpstreamProblems,
  LATEST_DOCS_URL,
  LATEST_TOOLCHAIN_URL,
  LATEST_WEBSITE_UPDATES_URL,
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
        if (url === LATEST_WEBSITE_UPDATES_URL) {
          return response(currentWebsiteUpdates());
        }
        throw new Error(`unexpected URL ${url}`);
      });
      expect(problems).toHaveLength(6);
      expect(problems.join("\n")).toContain("moon: committed");
      expect(problems.join("\n")).toContain("moonc: committed");
      expect(problems.join("\n")).toContain("moonrun: committed");
      expect(problems.join("\n")).toContain("latest docs main");
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("rejects duplicate and additional latest-manifest components", async () => {
    const temporary = createRepository();
    try {
      const problems = await latestUpstreamProblems(temporary, async (url) => {
        if (url === LATEST_TOOLCHAIN_URL) {
          return response({
            items: [
              { name: "moon", version: "0.1.20260803 (c19f78e 2026-08-03)" },
              { name: "moon", version: "0.1.20260803 (c19f78e 2026-08-03)" },
              { name: "moonc", version: "v0.10.6+80dc50f24 (2026-08-04)" },
              { name: "moonrun", version: "moonrun 0.1.20260803 (c19f78e 2026-08-03)" },
              { name: "moonx", version: "moonx 0.1.0 (abcdef0 2026-08-04)" },
            ],
          });
        }
        if (url === LATEST_DOCS_URL) {
          return response({ sha: DOCS_COMMIT });
        }
        if (url === LATEST_WEBSITE_UPDATES_URL) {
          return response(currentWebsiteUpdates());
        }
        throw new Error(`unexpected URL ${url}`);
      });
      expect(problems.join("\n")).toContain("duplicate component 'moon'");
      expect(problems.join("\n")).toContain("toolchain component set");
      expect(problems.join("\n")).toContain("moonx: missing from committed snapshot");
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("reports a newly published website update", async () => {
    const temporary = createRepository();
    try {
      const problems = await latestUpstreamProblems(temporary, async (url) => {
        if (url === LATEST_TOOLCHAIN_URL || url === LATEST_DOCS_URL) {
          return matchingFetcher()(url);
        }
        if (url === LATEST_WEBSITE_UPDATES_URL) {
          return response([
            ...currentWebsiteUpdates(),
            { name: "2026-08-09-moonbit-0-10-6-release", type: "dir" },
          ]);
        }
        throw new Error(`unexpected URL ${url}`);
      });
      expect(problems).toEqual([
        "current website coverage '2026-07-13-moonbit-0-10-4-release' != latest published update '2026-08-09-moonbit-0-10-6-release'",
      ]);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});

function createRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "latest-upstream-test-"));
  mkdirSync(join(root, "verification", "toolchains"), { recursive: true });
  mkdirSync(join(root, "verification", "language-surface"), { recursive: true });
  mkdirSync(join(root, "verification", "toolchain-surface"), { recursive: true });
  mkdirSync(join(root, "verification", "sources"), { recursive: true });
  mkdirSync(join(root, "verification", "releases", "0.10.4"), { recursive: true });
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
  writeFileSync(
    join(root, "verification", "toolchain-surface", "source.json"),
    JSON.stringify({ source: { commit: DOCS_COMMIT } }),
  );
  writeFileSync(
    join(root, "verification", "sources", "sources.json"),
    JSON.stringify({ sources: [{ id: "moonbit-docs", commit: DOCS_COMMIT }] }),
  );
  writeFileSync(
    join(root, "verification", "releases", "0.10.4", "coverage.json"),
    JSON.stringify({ status: "current", source_inventory: "source.json" }),
  );
  writeFileSync(
    join(root, "verification", "releases", "0.10.4", "source.json"),
    JSON.stringify({
      source: { path: "updates/2026-07-13-moonbit-0-10-4-release/index.md" },
    }),
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
    if (url === LATEST_WEBSITE_UPDATES_URL) {
      return response(currentWebsiteUpdates());
    }
    throw new Error(`unexpected URL ${url}`);
  };
}

function currentWebsiteUpdates() {
  return [
    { name: "2026-06-08-moonbit-0-10-0-release", type: "dir" },
    { name: "2026-07-13-moonbit-0-10-4-release", type: "dir" },
    { name: "README.md", type: "file" },
  ];
}

function response(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  toolchainSurfaceProblems,
  validateToolchainSurfaceInventory,
} from "../check_toolchain_surface.ts";
import { REPO_ROOT } from "../lib/repo.ts";
import { DOCS_TREE_API, RAW_DOCS_REPOSITORY } from "../snapshot_language_surface.ts";
import {
  createToolchainSurfaceInventory,
  extractToolchainItems,
  type ToolchainSurfaceInventory,
} from "../snapshot_toolchain_surface.ts";
import { verifyToolchainSurfaceSource } from "../verify_toolchain_surface_source.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("official toolchain surface snapshot", () => {
  it("extracts headings outside code fences and fingerprints section bodies", () => {
    const before = extractToolchainItems(
      "next/toolchain/moon/module.md",
      "# Module\n\n## Targets\n\nOriginal.\n\n```sh\n# not a heading\n```\n",
    );
    const after = extractToolchainItems(
      "next/toolchain/moon/module.md",
      "# Module\n\n## Targets\n\nChanged.\n\n```sh\n# not a heading\n```\n",
    );
    expect(before.map((item) => item.id)).toEqual([
      "document-moon-module",
      "document-moon-module-targets",
    ]);
    expect(after[1].fingerprint).not.toBe(before[1].fingerprint);
  });

  it("accepts the committed 14-document, 162-item inventory and coverage", () => {
    const inventory = JSON.parse(
      readFileSync(join(REPO_ROOT, "verification/toolchain-surface/source.json"), "utf8"),
    ) as ToolchainSurfaceInventory;
    expect(inventory.documents).toHaveLength(14);
    expect(inventory.items).toHaveLength(162);
    expect(validateToolchainSurfaceInventory(inventory, "source.json")).toEqual([]);
    expect(toolchainSurfaceProblems(REPO_ROOT)).toEqual([]);
  });

  it("regenerates every pinned toolchain Markdown file through an injected fetcher", async () => {
    const root = temporaryRoot();
    const directory = join(root, "verification", "toolchain-surface");
    mkdirSync(directory, { recursive: true });
    const commit = "c".repeat(40);
    const path = "next/toolchain/index.md";
    const markdown = "# Toolchains\n";
    const inventory = createToolchainSurfaceInventory(new Map([[path, markdown]]), commit);
    writeFileSync(join(directory, "source.json"), `${JSON.stringify(inventory)}\n`);
    const content = new Map([[`${RAW_DOCS_REPOSITORY}/${commit}/${path}`, markdown]]);
    const fetcher = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === `${DOCS_TREE_API}/${commit}?recursive=1`) {
        return response({ tree: [{ path, type: "blob" }], truncated: false });
      }
      const text = content.get(url);
      return {
        ok: text !== undefined,
        status: text === undefined ? 404 : 200,
        json: async () => ({}),
        text: async () => text ?? "",
      };
    }) as typeof fetch;
    expect(await verifyToolchainSurfaceSource(root, fetcher)).toEqual([]);
    content.set(`${RAW_DOCS_REPOSITORY}/${commit}/${path}`, "# Toolchains\n\n## New command\n");
    expect((await verifyToolchainSurfaceSource(root, fetcher)).join("\n")).toMatch(
      /does not match the pinned official docs/,
    );
  });
});

function response(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => "",
  };
}

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "toolchain-surface-test-"));
  temporaryDirectories.push(root);
  return root;
}

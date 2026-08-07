import { readFileSync } from "node:fs";
import { join } from "node:path";
import { exitWith, isMain } from "./lib/cli.ts";
import { stableJson } from "./lib/json.ts";
import { REPO_ROOT } from "./lib/repo.ts";
import {
  createToolchainSurfaceInventory,
  fetchToolchainSurface,
  type ToolchainSurfaceInventory,
} from "./snapshot_toolchain_surface.ts";

export async function verifyToolchainSurfaceSource(
  repoRoot = REPO_ROOT,
  fetcher: typeof fetch = fetch,
): Promise<string[]> {
  const sourcePath = join(repoRoot, "verification", "toolchain-surface", "source.json");
  let inventory: ToolchainSurfaceInventory;
  try {
    inventory = JSON.parse(readFileSync(sourcePath, "utf8")) as ToolchainSurfaceInventory;
  } catch (error) {
    return [`cannot read verification/toolchain-surface/source.json: ${(error as Error).message}`];
  }
  try {
    const markdownByPath = await fetchToolchainSurface(inventory.source.commit, fetcher);
    const regenerated = createToolchainSurfaceInventory(markdownByPath, inventory.source.commit);
    return stableJson(inventory) === stableJson(regenerated)
      ? []
      : ["verification/toolchain-surface/source.json does not match the pinned official docs"];
  } catch (error) {
    return [`cannot verify the pinned official toolchain surface: ${(error as Error).message}`];
  }
}

export async function main(repoRoot = REPO_ROOT): Promise<number> {
  const problems = await verifyToolchainSurfaceSource(repoRoot);
  for (const problem of problems) {
    console.error(`FAIL ${problem}`);
  }
  if (problems.length === 0) {
    console.log("toolchain surface source: matches pinned official docs");
  }
  return problems.length > 0 ? 1 : 0;
}

if (isMain(import.meta.url)) {
  main()
    .then(exitWith)
    .catch((error: unknown) => {
      console.error(`FAIL ${(error as Error).message}`);
      exitWith(1);
    });
}

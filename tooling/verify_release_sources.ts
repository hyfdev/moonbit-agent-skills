import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { exitWith, isMain } from "./lib/cli.ts";
import { stableJson } from "./lib/json.ts";
import { REPO_ROOT } from "./lib/repo.ts";
import { createReleaseInventory, type ReleaseInventory } from "./snapshot_release.ts";

const RAW_REPOSITORY = "https://raw.githubusercontent.com/moonbitlang/website";

type Fetcher = (input: string) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export async function verifyReleaseSources(
  repoRoot = REPO_ROOT,
  fetcher: Fetcher = fetch,
): Promise<string[]> {
  const releasesDirectory = join(repoRoot, "verification", "releases");
  if (!isDirectory(releasesDirectory)) {
    return ["missing verification/releases directory"];
  }
  const sourceFiles = readdirSync(releasesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(releasesDirectory, entry.name, "source.json"))
    .filter(isFile)
    .sort();
  if (sourceFiles.length === 0) {
    return ["verification/releases contains no source inventories"];
  }

  const problems: string[] = [];
  for (const sourceFile of sourceFiles) {
    const inventory = JSON.parse(readFileSync(sourceFile, "utf8")) as ReleaseInventory;
    const rawUrl = `${RAW_REPOSITORY}/${inventory.source.commit}/${inventory.source.path}`;
    const response = await fetcher(rawUrl);
    if (!response.ok) {
      problems.push(
        `${inventory.release}: failed to fetch pinned source (HTTP ${response.status})`,
      );
      continue;
    }
    const markdown = await response.text();
    const regenerated = createReleaseInventory(markdown, {
      release: inventory.release,
      releaseDate: inventory.release_date,
      commit: inventory.source.commit,
      sourcePath: inventory.source.path,
      webUrl: inventory.source.web_url,
    });
    if (stableJson(inventory) !== stableJson(regenerated)) {
      problems.push(
        `${inventory.release}: source.json does not match ${inventory.source.commit}:${inventory.source.path}`,
      );
    }
  }
  return problems;
}

export async function main(repoRoot = REPO_ROOT): Promise<number> {
  const problems = await verifyReleaseSources(repoRoot);
  for (const problem of problems) {
    console.error(`FAIL ${problem}`);
  }
  if (problems.length === 0) {
    console.log("release source inventories: match pinned upstream Markdown");
  }
  return problems.length > 0 ? 1 : 0;
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

if (isMain(import.meta.url)) {
  main()
    .then(exitWith)
    .catch((error: unknown) => {
      console.error(`FAIL ${(error as Error).message}`);
      exitWith(1);
    });
}

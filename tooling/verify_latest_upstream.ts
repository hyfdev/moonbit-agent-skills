import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { exitWith, isMain } from "./lib/cli.ts";
import { REPO_ROOT } from "./lib/repo.ts";
import { parseComponent, type SnapshotComponent } from "./snapshot_toolchain.ts";

export const LATEST_TOOLCHAIN_URL = "https://cli.moonbitlang.com/version.json";
export const LATEST_DOCS_URL = "https://api.github.com/repos/moonbitlang/moonbit-docs/commits/main";
export const LATEST_WEBSITE_UPDATES_URL =
  "https://api.github.com/repos/moonbitlang/website/contents/updates?ref=main";

interface VersionOutput {
  items?: Array<{ name: string; version: string }>;
}

interface ToolchainSnapshot {
  components?: SnapshotComponent[];
}

interface LanguageSurfaceSource {
  source?: { commit?: string };
}

interface SourceIndex {
  sources?: Array<{ id?: unknown; commit?: unknown }>;
}

interface WebsiteUpdateEntry {
  name?: unknown;
  type?: unknown;
}

type Fetcher = (input: string) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export async function latestUpstreamProblems(
  repoRoot = REPO_ROOT,
  fetcher: Fetcher = fetch,
): Promise<string[]> {
  const snapshot = JSON.parse(
    readFileSync(join(repoRoot, "verification", "toolchains", "current.json"), "utf8"),
  ) as ToolchainSnapshot;
  const surface = JSON.parse(
    readFileSync(join(repoRoot, "verification", "language-surface", "source.json"), "utf8"),
  ) as LanguageSurfaceSource;
  const toolchainSurface = JSON.parse(
    readFileSync(join(repoRoot, "verification", "toolchain-surface", "source.json"), "utf8"),
  ) as LanguageSurfaceSource;
  const sourceIndex = JSON.parse(
    readFileSync(join(repoRoot, "verification", "sources", "sources.json"), "utf8"),
  ) as SourceIndex;

  const [toolchainResponse, docsResponse, updatesResponse] = await Promise.all([
    fetcher(LATEST_TOOLCHAIN_URL),
    fetcher(LATEST_DOCS_URL),
    fetcher(LATEST_WEBSITE_UPDATES_URL),
  ]);
  const problems: string[] = [];

  if (!toolchainResponse.ok) {
    problems.push(
      `cannot fetch latest MoonBit toolchain manifest (HTTP ${toolchainResponse.status})`,
    );
  } else {
    const latest = (await toolchainResponse.json()) as VersionOutput;
    const parsedLatest = (latest.items ?? []).map(parseComponent);
    const committed = snapshot.components ?? [];
    const latestComponents = uniqueComponents(parsedLatest, "latest manifest", problems);
    const committedComponents = uniqueComponents(committed, "committed snapshot", problems);
    const latestNames = [...latestComponents.keys()].sort();
    const committedNames = [...committedComponents.keys()].sort();
    if (JSON.stringify(latestNames) !== JSON.stringify(committedNames)) {
      problems.push(
        `toolchain component set: committed ${reprList(committedNames)} != latest ${reprList(latestNames)}`,
      );
    }
    for (const name of new Set([...committedNames, ...latestNames, "moon", "moonc", "moonrun"])) {
      const committed = committedComponents.get(name);
      const current = latestComponents.get(name);
      if (committed === undefined || current === undefined) {
        problems.push(
          `${name}: missing from ${committed === undefined ? "committed snapshot" : "latest manifest"}`,
        );
        continue;
      }
      if (
        committed.version !== current.version ||
        committed.commit !== current.commit ||
        committed.build_date !== current.build_date
      ) {
        problems.push(
          `${name}: committed ${componentLabel(committed)} != latest ${componentLabel(current)}`,
        );
      }
    }
  }

  if (!docsResponse.ok) {
    problems.push(`cannot fetch latest MoonBit docs commit (HTTP ${docsResponse.status})`);
  } else {
    const latestDocs = (await docsResponse.json()) as { sha?: unknown };
    const latestCommit = typeof latestDocs.sha === "string" ? latestDocs.sha : "";
    if (!/^[0-9a-f]{40}$/.test(latestCommit)) {
      problems.push("latest MoonBit docs response has no full commit SHA");
    } else {
      for (const [label, committedCommit] of [
        ["language surface", surface.source?.commit ?? ""],
        ["toolchain surface", toolchainSurface.source?.commit ?? ""],
        ["source index", docsCommitFromSourceIndex(sourceIndex)],
      ] as const) {
        if (committedCommit !== latestCommit) {
          problems.push(
            `${label} commit ${repr(committedCommit)} != latest docs main ${repr(latestCommit)}`,
          );
        }
      }
    }
  }

  if (!updatesResponse.ok) {
    problems.push(`cannot fetch MoonBit website update index (HTTP ${updatesResponse.status})`);
  } else {
    const updates = (await updatesResponse.json()) as unknown;
    const latestDirectory = latestWebsiteUpdateDirectory(updates);
    const committedDirectory = currentWebsiteUpdateDirectory(repoRoot, problems);
    if (latestDirectory === undefined) {
      problems.push("MoonBit website update index has no dated article directories");
    } else if (committedDirectory !== undefined && committedDirectory !== latestDirectory) {
      problems.push(
        `current website coverage ${repr(committedDirectory)} != latest published update ${repr(latestDirectory)}`,
      );
    }
  }

  return problems;
}

function docsCommitFromSourceIndex(index: SourceIndex): string {
  const matches = (index.sources ?? []).filter((source) => source.id === "moonbit-docs");
  return matches.length === 1 && typeof matches[0].commit === "string" ? matches[0].commit : "";
}

export function latestWebsiteUpdateDirectory(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .filter(
      (entry): entry is WebsiteUpdateEntry =>
        entry !== null && typeof entry === "object" && !Array.isArray(entry),
    )
    .filter((entry) => entry.type === "dir" && typeof entry.name === "string")
    .map((entry) => entry.name as string)
    .filter((name) => /^\d{4}-\d{2}-\d{2}(?:-|$)/.test(name))
    .sort()
    .at(-1);
}

function currentWebsiteUpdateDirectory(repoRoot: string, problems: string[]): string | undefined {
  const releasesDirectory = join(repoRoot, "verification", "releases");
  const currentSources: string[] = [];
  for (const entry of readdirSync(releasesDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const directory = join(releasesDirectory, entry.name);
    const coverage = JSON.parse(readFileSync(join(directory, "coverage.json"), "utf8")) as {
      status?: unknown;
      source_inventory?: unknown;
    };
    if (coverage.status !== "current") {
      continue;
    }
    const sourceName = coverage.source_inventory === "source.json" ? "source.json" : "";
    if (sourceName === "") {
      problems.push(`${entry.name}/coverage.json: current coverage must use source.json`);
      continue;
    }
    const inventory = JSON.parse(readFileSync(join(directory, sourceName), "utf8")) as {
      source?: { path?: unknown };
    };
    const path = typeof inventory.source?.path === "string" ? inventory.source.path : "";
    const match = /^updates\/([^/]+)\/index\.md$/.exec(path);
    if (match === null) {
      problems.push(`${entry.name}/source.json: source.path is not an update article`);
      continue;
    }
    currentSources.push(match[1]);
  }
  if (currentSources.length !== 1) {
    problems.push(`expected one current website coverage source, found ${currentSources.length}`);
    return undefined;
  }
  return currentSources[0];
}

function uniqueComponents(
  components: SnapshotComponent[],
  label: string,
  problems: string[],
): Map<string, SnapshotComponent> {
  const result = new Map<string, SnapshotComponent>();
  for (const component of components) {
    if (result.has(component.name)) {
      problems.push(`${label}: duplicate component ${repr(component.name)}`);
    }
    result.set(component.name, component);
  }
  return result;
}

export async function main(repoRoot = REPO_ROOT): Promise<number> {
  const problems = await latestUpstreamProblems(repoRoot);
  for (const problem of problems) {
    console.error(`FAIL ${problem}`);
  }
  if (problems.length === 0) {
    console.log(
      "latest upstream: toolchain, docs surfaces, and website coverage match official latest",
    );
  }
  return problems.length > 0 ? 1 : 0;
}

function componentLabel(component: SnapshotComponent): string {
  const commit = component.commit === "" ? "" : ` ${component.commit}`;
  return `${component.version}${commit} (${component.build_date})`;
}

function repr(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function reprList(values: string[]): string {
  return `[${values.map(repr).join(", ")}]`;
}

if (isMain(import.meta.url)) {
  main()
    .then(exitWith)
    .catch((error: unknown) => {
      console.error(`FAIL ${(error as Error).message}`);
      exitWith(1);
    });
}

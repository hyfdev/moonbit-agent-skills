import { readFileSync } from "node:fs";
import { join } from "node:path";
import { exitWith, isMain } from "./lib/cli.ts";
import { REPO_ROOT } from "./lib/repo.ts";
import { parseComponent, type SnapshotComponent } from "./snapshot_toolchain.ts";

export const LATEST_TOOLCHAIN_URL = "https://cli.moonbitlang.com/version.json";
export const LATEST_DOCS_URL = "https://api.github.com/repos/moonbitlang/moonbit-docs/commits/main";

interface VersionOutput {
  items?: Array<{ name: string; version: string }>;
}

interface ToolchainSnapshot {
  components?: SnapshotComponent[];
}

interface LanguageSurfaceSource {
  source?: { commit?: string };
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

  const [toolchainResponse, docsResponse] = await Promise.all([
    fetcher(LATEST_TOOLCHAIN_URL),
    fetcher(LATEST_DOCS_URL),
  ]);
  const problems: string[] = [];

  if (!toolchainResponse.ok) {
    problems.push(
      `cannot fetch latest MoonBit toolchain manifest (HTTP ${toolchainResponse.status})`,
    );
  } else {
    const latest = (await toolchainResponse.json()) as VersionOutput;
    const latestComponents = new Map(
      (latest.items ?? []).map((item) => {
        const component = parseComponent(item);
        return [component.name, component] as const;
      }),
    );
    const committedComponents = new Map(
      (snapshot.components ?? []).map((component) => [component.name, component] as const),
    );
    for (const name of ["moon", "moonc", "moonrun"]) {
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
    const committedCommit = surface.source?.commit ?? "";
    if (!/^[0-9a-f]{40}$/.test(latestCommit)) {
      problems.push("latest MoonBit docs response has no full commit SHA");
    } else if (committedCommit !== latestCommit) {
      problems.push(
        `language surface commit ${repr(committedCommit)} != latest docs main ${repr(latestCommit)}`,
      );
    }
  }

  return problems;
}

export async function main(repoRoot = REPO_ROOT): Promise<number> {
  const problems = await latestUpstreamProblems(repoRoot);
  for (const problem of problems) {
    console.error(`FAIL ${problem}`);
  }
  if (problems.length === 0) {
    console.log("latest upstream: toolchain and docs pins match official latest");
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

if (isMain(import.meta.url)) {
  main()
    .then(exitWith)
    .catch((error: unknown) => {
      console.error(`FAIL ${(error as Error).message}`);
      exitWith(1);
    });
}

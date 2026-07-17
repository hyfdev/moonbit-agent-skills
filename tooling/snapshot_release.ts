import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { exitWith, isMain, parseCliArgs, usageError } from "./lib/cli.ts";
import { stableJson } from "./lib/json.ts";

const REPOSITORY = "https://github.com/moonbitlang/website";
const RAW_REPOSITORY = "https://raw.githubusercontent.com/moonbitlang/website";

const SECTION_NAMES: Record<string, string> = {
  "Language Updates": "language",
  "Toolchain Updates": "toolchain",
  "Standard Library Updates": "standard-library",
};

export interface SourceMetadata {
  release: string;
  releaseDate: string;
  commit: string;
  sourcePath: string;
  webUrl: string;
}

export interface ReleaseSourceItem {
  id: string;
  section: string;
  kind: "numbered-item" | "paragraph" | "bullet" | "code-block";
  parent?: string;
  language?: string;
  text: string;
}

export interface ReleaseInventory {
  schema_version: 2;
  release: string;
  release_date: string;
  generated_by: "tooling/snapshot_release.ts";
  source: {
    repository: typeof REPOSITORY;
    commit: string;
    path: string;
    web_url: string;
    sha256: string;
  };
  items: ReleaseSourceItem[];
}

export function extractReleaseItems(markdown: string): ReleaseSourceItem[] {
  const items: ReleaseSourceItem[] = [];
  const seenSections = new Set<string>();
  const nextSuffix = new Map<string, { paragraph: number; bullet: number; code: number }>();
  let section = "";
  let parent = "";
  let inFence = false;
  let fenceLanguage = "";
  let fenceLines: string[] = [];
  let bufferKind: "paragraph" | "bullet" | undefined;
  let bufferLines: string[] = [];

  const flush = (): void => {
    if (bufferKind === undefined || bufferLines.length === 0 || parent === "") {
      bufferKind = undefined;
      bufferLines = [];
      return;
    }
    const counters = nextSuffix.get(parent) ?? { paragraph: 0, bullet: 0, code: 0 };
    counters[bufferKind] += 1;
    nextSuffix.set(parent, counters);
    const letter = bufferKind === "paragraph" ? "p" : "b";
    items.push({
      id: `${parent}-${letter}${counters[bufferKind]}`,
      section,
      kind: bufferKind,
      parent,
      text: normalizeText(bufferLines.join(" ")),
    });
    bufferKind = undefined;
    bufferLines = [];
  };

  const flushCode = (): void => {
    if (parent !== "" && fenceLines.some((line) => line.trim() !== "")) {
      const counters = nextSuffix.get(parent) ?? { paragraph: 0, bullet: 0, code: 0 };
      counters.code += 1;
      nextSuffix.set(parent, counters);
      items.push({
        id: `${parent}-c${counters.code}`,
        section,
        kind: "code-block",
        parent,
        ...(fenceLanguage === "" ? {} : { language: fenceLanguage }),
        text: normalizeCode(fenceLines),
      });
    }
    fenceLanguage = "";
    fenceLines = [];
  };

  for (const line of markdown.split(/\r?\n/)) {
    const fence = line.trimStart().match(/^```([^`]*)$/);
    if (fence !== null) {
      flush();
      if (inFence) {
        flushCode();
        inFence = false;
      } else {
        if (section !== "" && parent === "") {
          throw new Error(`release source has a code block before the first item in ${section}`);
        }
        inFence = true;
        fenceLanguage = fence[1].trim();
        fenceLines = [];
      }
      continue;
    }
    if (inFence) {
      fenceLines.push(line);
      continue;
    }

    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading !== null) {
      flush();
      const nextSection = SECTION_NAMES[heading[1]];
      if (nextSection === undefined) {
        throw new Error(
          `release source has an unknown level-two section ${JSON.stringify(heading[1])}`,
        );
      }
      if (seenSections.has(nextSection)) {
        throw new Error(`release source repeats section ${nextSection}`);
      }
      seenSections.add(nextSection);
      section = nextSection;
      parent = "";
      continue;
    }
    if (section === "") {
      continue;
    }

    const numbered = line.match(/^(\d+)\.\s+(.+?)\s*$/);
    if (numbered !== null) {
      flush();
      parent = `${section}-${Number(numbered[1])}`;
      nextSuffix.set(parent, { paragraph: 0, bullet: 0, code: 0 });
      items.push({
        id: parent,
        section,
        kind: "numbered-item",
        text: normalizeText(numbered[2]),
      });
      continue;
    }
    if (parent === "" && line.trim() !== "") {
      throw new Error(`release source has content before the first item in ${section}`);
    }
    if (parent === "") {
      continue;
    }

    const bullet = line.match(/^\s*-\s+(.+?)\s*$/);
    if (bullet !== null) {
      flush();
      bufferKind = "bullet";
      bufferLines = [bullet[1]];
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    if (bufferKind === "bullet") {
      bufferLines.push(line.trim());
    } else {
      if (bufferKind === undefined) {
        bufferKind = "paragraph";
      }
      bufferLines.push(line.trim());
    }
  }
  if (inFence) {
    throw new Error("release source has an unclosed code fence");
  }
  flush();

  for (const sectionName of Object.values(SECTION_NAMES)) {
    const numbers = items
      .filter((item) => item.section === sectionName && item.kind === "numbered-item")
      .map((item) => Number(item.id.slice(item.id.lastIndexOf("-") + 1)))
      .sort((left, right) => left - right);
    if (numbers.length === 0) {
      throw new Error(`release source has no numbered items in ${sectionName}`);
    }
    const expected = Array.from({ length: numbers.at(-1) ?? 0 }, (_, index) => index + 1);
    if (numbers.join(",") !== expected.join(",")) {
      throw new Error(`release source has non-contiguous numbering in ${sectionName}`);
    }
  }
  return items;
}

export function createReleaseInventory(
  markdown: string,
  metadata: SourceMetadata,
): ReleaseInventory {
  return {
    schema_version: 2,
    release: metadata.release,
    release_date: metadata.releaseDate,
    generated_by: "tooling/snapshot_release.ts",
    source: {
      repository: REPOSITORY,
      commit: metadata.commit,
      path: metadata.sourcePath,
      web_url: metadata.webUrl,
      sha256: createHash("sha256").update(markdown).digest("hex"),
    },
    items: extractReleaseItems(markdown),
  };
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const usage =
    "usage: node tooling/snapshot_release.ts --release VERSION --date YYYY-MM-DD --commit SHA --source-path PATH --web-url URL --output PATH [--source-file PATH] [--check]";
  const parsed = parseCliArgs(
    {
      args,
      options: {
        release: { type: "string" },
        date: { type: "string" },
        commit: { type: "string" },
        "source-path": { type: "string" },
        "web-url": { type: "string" },
        "source-file": { type: "string" },
        output: { type: "string" },
        check: { type: "boolean", default: false },
      },
      strict: true,
    },
    usage,
  );
  if (!parsed.ok) {
    return parsed.exitCode;
  }
  const { values } = parsed.result;
  const required = ["release", "date", "commit", "source-path", "web-url", "output"] as const;
  const missing = required.filter((name) => values[name] === undefined);
  if (missing.length > 0) {
    return usageError(
      `missing required options: ${missing.map((name) => `--${name}`).join(", ")}`,
      usage,
    );
  }
  if (!/^[0-9a-f]{40}$/.test(values.commit ?? "")) {
    return usageError("--commit must be a full 40-character Git commit", usage);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date ?? "")) {
    return usageError("--date must use YYYY-MM-DD", usage);
  }

  const sourcePath = values["source-path"] as string;
  let markdown: string;
  if (values["source-file"] !== undefined) {
    markdown = readFileSync(values["source-file"], "utf8");
  } else {
    const rawUrl = `${RAW_REPOSITORY}/${values.commit}/${sourcePath}`;
    const response = await fetch(rawUrl);
    if (!response.ok) {
      console.error(`failed to fetch pinned release source: HTTP ${response.status} ${rawUrl}`);
      return 1;
    }
    markdown = await response.text();
  }

  const generated = stableJson(
    createReleaseInventory(markdown, {
      release: values.release as string,
      releaseDate: values.date as string,
      commit: values.commit as string,
      sourcePath,
      webUrl: values["web-url"] as string,
    }),
  );
  const output = values.output as string;
  if (values.check) {
    const current = readFileSync(output, "utf8");
    if (current !== generated) {
      console.error(`${output} does not match the pinned upstream release source`);
      return 1;
    }
    console.log(`${output}: source inventory matches pinned upstream Markdown`);
    return 0;
  }
  writeFileSync(output, generated, "utf8");
  console.log(`${output}: wrote ${JSON.parse(generated).items.length} source item(s)`);
  return 0;
}

function normalizeText(value: string): string {
  return value
    .replace(/^\*\*(.*)\*\*$/, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCode(lines: string[]): string {
  const nonEmpty = lines.filter((line) => line.trim() !== "");
  const indentation = Math.min(...nonEmpty.map((line) => line.length - line.trimStart().length));
  return lines
    .map((line) => line.slice(indentation).trimEnd())
    .join("\n")
    .trim();
}

if (isMain(import.meta.url)) {
  main()
    .then(exitWith)
    .catch((error: unknown) => {
      console.error(`FAIL ${(error as Error).message}`);
      exitWith(1);
    });
}

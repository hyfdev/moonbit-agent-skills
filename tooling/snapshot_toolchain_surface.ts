import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exitWith, isMain, parseCliArgs, usageError } from "./lib/cli.ts";
import { stableJson } from "./lib/json.ts";
import {
  DOCS_REPOSITORY,
  DOCS_TREE_API,
  RAW_DOCS_REPOSITORY,
} from "./snapshot_language_surface.ts";

export const TOOLCHAIN_ROOT_PATH = "next/toolchain";

export interface ToolchainSurfaceDocument {
  id: string;
  path: string;
  web_url: string;
  sha256: string;
}

export interface ToolchainSurfaceItem {
  id: string;
  document_id: string;
  kind: "document" | "heading";
  level: number;
  parent?: string;
  text: string;
  fingerprint: string;
}

export interface ToolchainSurfaceInventory {
  schema_version: 1;
  generated_by: "tooling/snapshot_toolchain_surface.ts";
  source: {
    repository: typeof DOCS_REPOSITORY;
    commit: string;
    root_path: typeof TOOLCHAIN_ROOT_PATH;
    root_web_url: "https://docs.moonbitlang.com/en/latest/toolchain/";
  };
  documents: ToolchainSurfaceDocument[];
  items: ToolchainSurfaceItem[];
}

export function extractToolchainItems(path: string, markdown: string): ToolchainSurfaceItem[] {
  const slug = path
    .replace(/^next\/toolchain\//, "")
    .replace(/\.md$/, "")
    .replaceAll("/", "-")
    .toLowerCase();
  const documentId = `document-${slug}`;
  const items: ToolchainSurfaceItem[] = [];
  const headingIds = new Map<string, number>();
  const parents = new Map<number, string>();
  const itemLineIndexes: number[] = [];
  const headingLines: Array<{ line: number; level: number }> = [];
  const lines = markdown.split(/\r?\n/);
  let inFence = false;
  let title = "";

  for (const [lineIndex, line] of lines.entries()) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    const match = /^(#{1,4})\s+(.+?)\s*$/.exec(line);
    if (match === null) {
      continue;
    }
    const level = match[1].length;
    const text = match[2].trim();
    headingLines.push({ line: lineIndex, level });
    if (level === 1) {
      if (title !== "") {
        throw new Error(`${path} has more than one level-one heading`);
      }
      title = text;
      continue;
    }
    const previousLevel = items.at(-1)?.level ?? 1;
    if (level > previousLevel + 1) {
      throw new Error(`${path} skips from heading level ${previousLevel} to ${level}`);
    }
    const base = `${documentId}-${headingSlug(text)}`;
    const occurrence = (headingIds.get(base) ?? 0) + 1;
    headingIds.set(base, occurrence);
    const id = occurrence === 1 ? base : `${base}-${occurrence}`;
    const parent =
      [...parents.entries()]
        .filter(([parentLevel]) => parentLevel < level)
        .sort(([left], [right]) => right - left)[0]?.[1] ?? documentId;
    items.push({
      id,
      document_id: documentId,
      kind: "heading",
      level,
      parent,
      text,
      fingerprint: "",
    });
    itemLineIndexes.push(lineIndex);
    parents.set(level, id);
    for (const parentLevel of parents.keys()) {
      if (parentLevel > level) {
        parents.delete(parentLevel);
      }
    }
  }
  if (inFence) {
    throw new Error(`${path} has an unclosed code fence`);
  }
  if (title === "") {
    throw new Error(`${path} has no level-one heading`);
  }
  for (const [index, item] of items.entries()) {
    const start = itemLineIndexes[index];
    const end =
      headingLines.find((heading) => heading.line > start && heading.level <= item.level)?.line ??
      lines.length;
    item.fingerprint = sha256(`${lines.slice(start, end).join("\n").trimEnd()}\n`);
  }
  return [
    {
      id: documentId,
      document_id: documentId,
      kind: "document",
      level: 1,
      text: title,
      fingerprint: sha256(markdown),
    },
    ...items,
  ];
}

export function createToolchainSurfaceInventory(
  markdownByPath: ReadonlyMap<string, string>,
  commit: string,
): ToolchainSurfaceInventory {
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error("toolchain surface commit must be a full 40-character Git commit");
  }
  const paths = [...markdownByPath.keys()].sort();
  if (paths.length === 0) {
    throw new Error("toolchain surface contains no Markdown documents");
  }
  const documents: ToolchainSurfaceDocument[] = [];
  const items: ToolchainSurfaceItem[] = [];
  for (const path of paths) {
    if (!path.startsWith(`${TOOLCHAIN_ROOT_PATH}/`) || !path.endsWith(".md")) {
      throw new Error(`toolchain surface has an invalid path ${JSON.stringify(path)}`);
    }
    const markdown = markdownByPath.get(path) as string;
    const id = `document-${path
      .replace(/^next\/toolchain\//, "")
      .replace(/\.md$/, "")
      .replaceAll("/", "-")
      .toLowerCase()}`;
    documents.push({ id, path, web_url: docsWebUrl(path), sha256: sha256(markdown) });
    items.push(...extractToolchainItems(path, markdown));
  }
  const ids = items.map((item) => item.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("toolchain surface generated duplicate item IDs");
  }
  return {
    schema_version: 1,
    generated_by: "tooling/snapshot_toolchain_surface.ts",
    source: {
      repository: DOCS_REPOSITORY,
      commit,
      root_path: TOOLCHAIN_ROOT_PATH,
      root_web_url: "https://docs.moonbitlang.com/en/latest/toolchain/",
    },
    documents,
    items,
  };
}

export async function fetchToolchainSurface(
  commit: string,
  fetcher: typeof fetch = fetch,
): Promise<Map<string, string>> {
  const treeUrl = `${DOCS_TREE_API}/${commit}?recursive=1`;
  const treeResponse = await fetcher(treeUrl);
  if (!treeResponse.ok) {
    throw new Error(`failed to fetch pinned MoonBit docs tree: HTTP ${treeResponse.status}`);
  }
  const body = (await treeResponse.json()) as {
    truncated?: boolean;
    tree?: Array<{ path?: string; type?: string }>;
  };
  if (body.truncated === true || !Array.isArray(body.tree)) {
    throw new Error("pinned MoonBit docs tree is missing or truncated");
  }
  const paths = body.tree
    .filter((entry) => entry.type === "blob")
    .map((entry) => entry.path ?? "")
    .filter((path) => path.startsWith(`${TOOLCHAIN_ROOT_PATH}/`) && path.endsWith(".md"))
    .sort();
  const entries = await Promise.all(
    paths.map(async (path) => {
      const url = `${RAW_DOCS_REPOSITORY}/${commit}/${path}`;
      const response = await fetcher(url);
      if (!response.ok) {
        throw new Error(`failed to fetch pinned MoonBit docs: HTTP ${response.status} ${url}`);
      }
      return [path, await response.text()] as const;
    }),
  );
  return new Map(entries);
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const usage =
    "usage: node tooling/snapshot_toolchain_surface.ts --commit SHA --output PATH [--source-root PATH] [--check]";
  const parsed = parseCliArgs(
    {
      args,
      options: {
        commit: { type: "string" },
        output: { type: "string" },
        "source-root": { type: "string" },
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
  if (values.commit === undefined || values.output === undefined) {
    return usageError("--commit and --output are required", usage);
  }
  if (!/^[0-9a-f]{40}$/.test(values.commit)) {
    return usageError("--commit must be a full 40-character Git commit", usage);
  }

  const markdownByPath =
    values["source-root"] === undefined
      ? await fetchToolchainSurface(values.commit)
      : localToolchainMarkdown(values["source-root"]);
  const generated = stableJson(createToolchainSurfaceInventory(markdownByPath, values.commit));
  if (values.check) {
    if (readFileSync(values.output, "utf8") !== generated) {
      console.error(`${values.output} does not match the pinned official toolchain surface`);
      return 1;
    }
    console.log(`${values.output}: toolchain surface matches pinned official docs`);
    return 0;
  }
  writeFileSync(values.output, generated, "utf8");
  const inventory = JSON.parse(generated) as ToolchainSurfaceInventory;
  console.log(
    `${values.output}: wrote ${inventory.documents.length} document(s), ${inventory.items.length} surface item(s)`,
  );
  return 0;
}

function localToolchainMarkdown(root: string): Map<string, string> {
  const base = join(root, "next", "toolchain");
  const entries = new Map<string, string>();
  const visit = (directory: string, relativeDirectory: string): void => {
    for (const entry of readdirSync(directory).sort()) {
      const path = join(directory, entry);
      const relativePath = relativeDirectory === "" ? entry : `${relativeDirectory}/${entry}`;
      if (statSync(path).isDirectory()) {
        visit(path, relativePath);
      } else if (entry.endsWith(".md")) {
        entries.set(`${TOOLCHAIN_ROOT_PATH}/${relativePath}`, readFileSync(path, "utf8"));
      }
    }
  };
  visit(base, "");
  return entries;
}

function headingSlug(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (slug === "") {
    throw new Error(`cannot create an ID for heading ${JSON.stringify(text)}`);
  }
  return slug;
}

function docsWebUrl(path: string): string {
  const page = path.replace(/^next\//, "").replace(/\.md$/, ".html");
  return `https://docs.moonbitlang.com/en/latest/${page}`;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

if (isMain(import.meta.url)) {
  main()
    .then(exitWith)
    .catch((error: unknown) => {
      console.error(`FAIL ${(error as Error).message}`);
      exitWith(1);
    });
}

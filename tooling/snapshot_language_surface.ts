import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exitWith, isMain, parseCliArgs, usageError } from "./lib/cli.ts";
import { stableJson } from "./lib/json.ts";

export const DOCS_REPOSITORY = "https://github.com/moonbitlang/moonbit-docs";
export const RAW_DOCS_REPOSITORY = "https://raw.githubusercontent.com/moonbitlang/moonbit-docs";
export const LANGUAGE_INDEX_PATH = "next/language/index.md";

export interface LanguageSurfaceDocument {
  id: string;
  path: string;
  web_url: string;
  sha256: string;
}

export interface LanguageSurfaceItem {
  id: string;
  document_id: string;
  kind: "document" | "heading";
  level: number;
  parent?: string;
  text: string;
}

export interface LanguageSurfaceInventory {
  schema_version: 1;
  generated_by: "tooling/snapshot_language_surface.ts";
  source: {
    repository: typeof DOCS_REPOSITORY;
    commit: string;
    index_path: typeof LANGUAGE_INDEX_PATH;
    index_web_url: "https://docs.moonbitlang.com/en/latest/language/";
    index_sha256: string;
  };
  documents: LanguageSurfaceDocument[];
  items: LanguageSurfaceItem[];
}

export function extractLanguageDocuments(indexMarkdown: string): string[] {
  const documents: string[] = [];
  let inToctree = false;
  let sawToctree = false;
  for (const line of indexMarkdown.split(/\r?\n/)) {
    if (line.trim() === "```{toctree}") {
      if (inToctree || sawToctree) {
        throw new Error("language index must contain exactly one toctree");
      }
      inToctree = true;
      sawToctree = true;
      continue;
    }
    if (inToctree && line.trim() === "```") {
      inToctree = false;
      continue;
    }
    if (!inToctree) {
      continue;
    }
    const entry = line.trim();
    if (entry === "" || entry.startsWith(":")) {
      continue;
    }
    if (!/^[a-z0-9][a-z0-9/_-]*$/.test(entry) || entry.includes("..")) {
      throw new Error(`unsupported language toctree entry ${JSON.stringify(entry)}`);
    }
    const path = `next/language/${entry}.md`;
    if (documents.includes(path)) {
      throw new Error(`duplicate language toctree entry ${JSON.stringify(entry)}`);
    }
    documents.push(path);
  }
  if (inToctree) {
    throw new Error("language index has an unclosed toctree");
  }
  if (!sawToctree || documents.length === 0) {
    throw new Error("language index has no toctree documents");
  }
  return documents;
}

export function extractLanguageIncludes(markdown: string): string[] {
  const includes: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("```{include}")) {
      continue;
    }
    const match = /^```\{include\}\s+\/language\/([a-z0-9][a-z0-9/_-]*\.md)\s*$/.exec(trimmed);
    if (match === null) {
      throw new Error(`unsupported language include ${JSON.stringify(trimmed)}`);
    }
    const path = `next/language/${match[1]}`;
    if (path.includes("..")) {
      throw new Error(`unsafe language include ${JSON.stringify(path)}`);
    }
    if (includes.includes(path)) {
      throw new Error(`duplicate language include ${JSON.stringify(path)}`);
    }
    includes.push(path);
  }
  return includes;
}

export function extractLanguageItems(path: string, markdown: string): LanguageSurfaceItem[] {
  const slug = path
    .replace(/^next\/language\//, "")
    .replace(/\.md$/, "")
    .replaceAll("/", "-");
  const documentId = `document-${slug}`;
  const items: LanguageSurfaceItem[] = [];
  const headingIds = new Map<string, number>();
  const parents = new Map<number, string>();
  let inFence = false;
  let title = "";

  for (const line of markdown.split(/\r?\n/)) {
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
    items.push({ id, document_id: documentId, kind: "heading", level, parent, text });
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
  return [
    { id: documentId, document_id: documentId, kind: "document", level: 1, text: title },
    ...items,
  ];
}

export function createLanguageSurfaceInventory(
  indexMarkdown: string,
  markdownByPath: ReadonlyMap<string, string>,
  commit: string,
): LanguageSurfaceInventory {
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error("language surface commit must be a full 40-character Git commit");
  }
  const paths = resolveDocumentOrder(indexMarkdown, markdownByPath);
  const documents: LanguageSurfaceDocument[] = [];
  const items: LanguageSurfaceItem[] = [];
  for (const path of paths) {
    const markdown = markdownByPath.get(path);
    if (markdown === undefined) {
      throw new Error(`missing language document ${path}`);
    }
    const id = `document-${path
      .replace(/^next\/language\//, "")
      .replace(/\.md$/, "")
      .replaceAll("/", "-")}`;
    documents.push({
      id,
      path,
      web_url: docsWebUrl(path),
      sha256: sha256(markdown),
    });
    items.push(...extractLanguageItems(path, markdown));
  }
  const ids = items.map((item) => item.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("language surface generated duplicate item IDs");
  }
  return {
    schema_version: 1,
    generated_by: "tooling/snapshot_language_surface.ts",
    source: {
      repository: DOCS_REPOSITORY,
      commit,
      index_path: LANGUAGE_INDEX_PATH,
      index_web_url: "https://docs.moonbitlang.com/en/latest/language/",
      index_sha256: sha256(indexMarkdown),
    },
    documents,
    items,
  };
}

export async function fetchLanguageSurface(
  commit: string,
  fetcher: typeof fetch = fetch,
): Promise<{ indexMarkdown: string; markdownByPath: Map<string, string> }> {
  const indexMarkdown = await fetchPinned(LANGUAGE_INDEX_PATH, commit, fetcher);
  const markdownByPath = new Map<string, string>();
  const pending = [...extractLanguageDocuments(indexMarkdown)];
  while (pending.length > 0) {
    const batch = pending.splice(0).filter((path) => !markdownByPath.has(path));
    const entries = await Promise.all(
      batch.map(async (path) => [path, await fetchPinned(path, commit, fetcher)] as const),
    );
    for (const [path, markdown] of entries) {
      markdownByPath.set(path, markdown);
      for (const included of extractLanguageIncludes(markdown)) {
        if (!markdownByPath.has(included) && !pending.includes(included)) {
          pending.push(included);
        }
      }
    }
  }
  return { indexMarkdown, markdownByPath };
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const usage =
    "usage: node tooling/snapshot_language_surface.ts --commit SHA --output PATH [--source-root PATH] [--check]";
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

  let indexMarkdown: string;
  let markdownByPath: Map<string, string>;
  if (values["source-root"] !== undefined) {
    const root = values["source-root"];
    indexMarkdown = readFileSync(join(root, LANGUAGE_INDEX_PATH), "utf8");
    markdownByPath = new Map();
    const pending = [...extractLanguageDocuments(indexMarkdown)];
    while (pending.length > 0) {
      const path = pending.shift() as string;
      if (markdownByPath.has(path)) {
        continue;
      }
      const markdown = readFileSync(join(root, path), "utf8");
      markdownByPath.set(path, markdown);
      pending.push(...extractLanguageIncludes(markdown));
    }
  } else {
    ({ indexMarkdown, markdownByPath } = await fetchLanguageSurface(values.commit));
  }

  const generated = stableJson(
    createLanguageSurfaceInventory(indexMarkdown, markdownByPath, values.commit),
  );
  if (values.check) {
    if (readFileSync(values.output, "utf8") !== generated) {
      console.error(`${values.output} does not match the pinned official language surface`);
      return 1;
    }
    console.log(`${values.output}: language surface matches pinned official docs`);
    return 0;
  }
  writeFileSync(values.output, generated, "utf8");
  const inventory = JSON.parse(generated) as LanguageSurfaceInventory;
  console.log(
    `${values.output}: wrote ${inventory.documents.length} document(s), ${inventory.items.length} surface item(s)`,
  );
  return 0;
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

function resolveDocumentOrder(
  indexMarkdown: string,
  markdownByPath: ReadonlyMap<string, string>,
): string[] {
  const ordered: string[] = [];
  const visiting = new Set<string>();
  const visit = (path: string): void => {
    if (ordered.includes(path)) {
      return;
    }
    if (visiting.has(path)) {
      throw new Error(`language include cycle reaches ${path}`);
    }
    const markdown = markdownByPath.get(path);
    if (markdown === undefined) {
      throw new Error(`missing language document ${path}`);
    }
    visiting.add(path);
    for (const included of extractLanguageIncludes(markdown)) {
      visit(included);
    }
    visiting.delete(path);
    ordered.push(path);
  };
  for (const path of extractLanguageDocuments(indexMarkdown)) {
    visit(path);
  }
  return ordered;
}

function docsWebUrl(path: string): string {
  const page = path.replace(/^next\//, "").replace(/\.md$/, ".html");
  return `https://docs.moonbitlang.com/en/latest/${page}`;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function fetchPinned(path: string, commit: string, fetcher: typeof fetch): Promise<string> {
  const url = `${RAW_DOCS_REPOSITORY}/${commit}/${path}`;
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`failed to fetch pinned MoonBit docs: HTTP ${response.status} ${url}`);
  }
  return response.text();
}

if (isMain(import.meta.url)) {
  main()
    .then(exitWith)
    .catch((error: unknown) => {
      console.error(`FAIL ${(error as Error).message}`);
      exitWith(1);
    });
}

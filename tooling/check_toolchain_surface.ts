import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { exitWith, isMain } from "./lib/cli.ts";
import { REPO_ROOT } from "./lib/repo.ts";
import { validateSkillRoute, type SkillRoute } from "./lib/skill_route.ts";
import type { ToolchainSurfaceInventory } from "./snapshot_toolchain_surface.ts";

interface ToolchainSurfaceCoverage {
  schema_version?: unknown;
  source_inventory?: unknown;
  routes?: unknown;
}

interface RouteDecision {
  source_ids?: unknown;
  reviewed?: unknown;
  official_topics?: unknown;
  summary?: unknown;
  disposition?: unknown;
  owner_skill?: unknown;
  route?: unknown;
  content?: unknown;
  reason?: unknown;
}

export function toolchainSurfaceProblems(repoRoot = REPO_ROOT): string[] {
  const directory = join(repoRoot, "verification", "toolchain-surface");
  const problems: string[] = [];
  const inventory = readJson<ToolchainSurfaceInventory>(
    join(directory, "source.json"),
    "source.json",
    problems,
  );
  const coverage = readJson<ToolchainSurfaceCoverage>(
    join(directory, "coverage.json"),
    "coverage.json",
    problems,
  );
  if (inventory === undefined || coverage === undefined) {
    return problems;
  }
  problems.push(...validateToolchainSurfaceInventory(inventory, "source.json"));
  problems.push(...validateToolchainSurfaceCoverage(coverage, inventory, repoRoot));
  return problems;
}

export function validateToolchainSurfaceInventory(
  inventory: ToolchainSurfaceInventory,
  label: string,
): string[] {
  const problems: string[] = [];
  const fail = (message: string): void => {
    problems.push(`${label}: ${message}`);
  };
  if (inventory.schema_version !== 1) {
    fail("schema_version must be 1");
  }
  if (inventory.generated_by !== "tooling/snapshot_toolchain_surface.ts") {
    fail("generated_by must be tooling/snapshot_toolchain_surface.ts");
  }
  if (!isRecord(inventory.source)) {
    fail("source must be an object");
  } else {
    if (inventory.source.repository !== "https://github.com/moonbitlang/moonbit-docs") {
      fail("source.repository must be the official MoonBit docs repository");
    }
    if (!/^[0-9a-f]{40}$/.test(stringValue(inventory.source.commit))) {
      fail("source.commit must be a full Git commit");
    }
    if (inventory.source.root_path !== "next/toolchain") {
      fail("source.root_path must be next/toolchain");
    }
  }

  if (!Array.isArray(inventory.documents) || inventory.documents.length === 0) {
    fail("documents must be a non-empty array");
    return problems;
  }
  const documentIds = new Set<string>();
  const documentPaths = new Set<string>();
  for (const document of inventory.documents) {
    if (!isRecord(document)) {
      fail("every document must be an object");
      continue;
    }
    const id = stringValue(document.id);
    const path = stringValue(document.path);
    if (!/^document-[a-z0-9][a-z0-9_-]*$/.test(id)) {
      fail(`invalid document id ${repr(id)}`);
    }
    if (documentIds.has(id)) {
      fail(`duplicate document id ${repr(id)}`);
    }
    documentIds.add(id);
    if (!/^next\/toolchain\/[A-Za-z0-9][A-Za-z0-9/_-]*\.md$/.test(path)) {
      fail(`${id || "document"}: invalid source path ${repr(path)}`);
    }
    if (documentPaths.has(path)) {
      fail(`duplicate document path ${repr(path)}`);
    }
    documentPaths.add(path);
    if (!stringValue(document.web_url).startsWith("https://docs.moonbitlang.com/en/latest/")) {
      fail(`${id || "document"}: web_url must point to official docs`);
    }
    if (!/^[0-9a-f]{64}$/.test(stringValue(document.sha256))) {
      fail(`${id || "document"}: sha256 must be a SHA-256 digest`);
    }
  }

  if (!Array.isArray(inventory.items) || inventory.items.length === 0) {
    fail("items must be a non-empty array");
    return problems;
  }
  const itemIds = new Set<string>();
  const documentRoots = new Map<string, number>();
  for (const item of inventory.items) {
    if (!isRecord(item)) {
      fail("every item must be an object");
      continue;
    }
    const id = stringValue(item.id);
    const documentId = stringValue(item.document_id);
    if (id === "" || !id.startsWith(documentId)) {
      fail(`item ${repr(id)} must start with its document_id ${repr(documentId)}`);
    }
    if (itemIds.has(id)) {
      fail(`duplicate item id ${repr(id)}`);
    }
    itemIds.add(id);
    if (!documentIds.has(documentId)) {
      fail(`${id || "item"}: unknown document_id ${repr(documentId)}`);
    }
    if (item.kind !== "document" && item.kind !== "heading") {
      fail(`${id || "item"}: kind must be document or heading`);
    }
    if (!Number.isInteger(item.level) || item.level < 1 || item.level > 4) {
      fail(`${id || "item"}: level must be an integer from 1 through 4`);
    }
    if (stringValue(item.text) === "") {
      fail(`${id || "item"}: text must be non-empty`);
    }
    if (!/^[0-9a-f]{64}$/.test(stringValue(item.fingerprint))) {
      fail(`${id || "item"}: fingerprint must be a SHA-256 digest`);
    }
    if (item.kind === "document") {
      documentRoots.set(documentId, (documentRoots.get(documentId) ?? 0) + 1);
      if (item.level !== 1 || item.id !== documentId || item.parent !== undefined) {
        fail(`${id || "item"}: document items must be root level with no parent`);
      }
    } else if (!itemIds.has(stringValue(item.parent))) {
      fail(`${id || "item"}: parent ${repr(stringValue(item.parent))} must be an earlier item`);
    }
  }
  for (const documentId of documentIds) {
    if (documentRoots.get(documentId) !== 1) {
      fail(`${documentId}: expected exactly one document root item`);
    }
  }
  return problems;
}

export function validateToolchainSurfaceCoverage(
  coverage: ToolchainSurfaceCoverage,
  inventory: ToolchainSurfaceInventory,
  repoRoot: string,
): string[] {
  const problems: string[] = [];
  const fail = (message: string): void => {
    problems.push(`coverage.json: ${message}`);
  };
  if (coverage.schema_version !== 1) {
    fail("schema_version must be 1");
  }
  if (coverage.source_inventory !== "source.json") {
    fail("source_inventory must be source.json");
  }
  if (!Array.isArray(coverage.routes)) {
    fail("routes must be an array");
    return problems;
  }
  const sourceItems = new Map(inventory.items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  for (const [index, rawDecision] of coverage.routes.entries()) {
    if (!isRecord(rawDecision)) {
      fail(`route ${index + 1} must be an object`);
      continue;
    }
    const decision = rawDecision as RouteDecision;
    const label = `route ${index + 1}`;
    const ids = stringArray(decision.source_ids);
    if (ids === undefined || ids.length === 0) {
      fail(`${label}: source_ids must be a non-empty string array`);
      continue;
    }
    for (const id of ids) {
      if (!sourceItems.has(id)) {
        fail(`${label}: unknown source_id ${repr(id)}`);
      }
      if (seen.has(id)) {
        fail(`${label}: duplicate source_id ${repr(id)}`);
      }
      seen.add(id);
    }
    if (!isRecord(decision.reviewed)) {
      fail(`${label}: reviewed must map every source_id to its current fingerprint`);
    } else {
      if (
        JSON.stringify(Object.keys(decision.reviewed).sort()) !== JSON.stringify([...ids].sort())
      ) {
        fail(`${label}: reviewed keys must exactly equal source_ids`);
      }
      for (const id of ids) {
        if (decision.reviewed[id] !== sourceItems.get(id)?.fingerprint) {
          fail(`${label}: ${id} fingerprint changed; review and update this decision`);
        }
      }
    }
    const officialTopics = stringArray(decision.official_topics);
    const expectedTopics = ids.map((id) => sourceItems.get(id)?.text ?? "");
    if (
      officialTopics === undefined ||
      JSON.stringify([...officialTopics].sort()) !== JSON.stringify([...expectedTopics].sort())
    ) {
      fail(`${label}: official_topics must exactly list the source item text`);
    }
    if (stringValue(decision.summary) === "") {
      fail(`${label}: summary must be a non-empty string`);
    }
    if (decision.disposition === "out-of-scope") {
      if (stringValue(decision.reason) === "") {
        fail(`${label}: out-of-scope routes require a reason`);
      }
      if (
        decision.owner_skill !== undefined ||
        decision.route !== undefined ||
        decision.content !== undefined
      ) {
        fail(`${label}: out-of-scope routes must not have owner_skill, route, or content`);
      }
      continue;
    }
    if (decision.disposition !== "routed") {
      fail(`${label}: disposition must be routed or out-of-scope`);
      continue;
    }
    if (decision.owner_skill !== "moonbit-toolchain") {
      fail(`${label}: routed items require owner_skill moonbit-toolchain`);
    }
    if (!isRecord(decision.route)) {
      fail(`${label}: routed items require a route object`);
      continue;
    }
    problems.push(
      ...validateSkillRoute(
        decision.route as SkillRoute,
        "moonbit-toolchain",
        repoRoot,
        `coverage.json: ${label}`,
      ),
    );
    if (!isRecord(decision.content) || stringValue(decision.content.marker) === "") {
      fail(`${label}: routed items require content.marker`);
      continue;
    }
    const reference = stringValue(decision.route.reference);
    const referencePath = safeRepoPath(repoRoot, `skills/moonbit-toolchain/${reference}`);
    if (referencePath === undefined || !isFile(referencePath)) {
      continue;
    }
    const marker = stringValue(decision.content.marker);
    const referenceContent = readFileSync(referencePath, "utf8");
    const occurrences = referenceContent.split(marker).length - 1;
    if (occurrences !== 1) {
      fail(
        `${label}: content.marker must occur exactly once in ${reference}; found ${occurrences}`,
      );
    }
    const contentTerms = stringArray(decision.content.terms);
    if (
      contentTerms === undefined ||
      JSON.stringify([...contentTerms].sort()) !== JSON.stringify([...expectedTopics].sort())
    ) {
      fail(`${label}: content.terms must exactly list the official topic text`);
      continue;
    }
    for (const term of contentTerms) {
      if (!referenceContent.includes(term)) {
        fail(`${label}: official topic term ${repr(term)} is absent from ${reference}`);
      }
    }
  }
  for (const id of sourceItems.keys()) {
    if (!seen.has(id)) {
      fail(`missing route for source item ${repr(id)}`);
    }
  }
  return problems;
}

function readJson<T>(path: string, label: string, problems: string[]): T | undefined {
  if (!isFile(path)) {
    problems.push(`${label}: file does not exist`);
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    problems.push(`${label}: invalid JSON: ${(error as Error).message}`);
    return undefined;
  }
}

function safeRepoPath(rootDirectory: string, relativePath: string): string | undefined {
  const root = resolve(rootDirectory);
  const full = resolve(root, relativePath);
  return full === root || full.startsWith(`${root}${sep}`) ? full : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function repr(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

export function main(repoRoot = REPO_ROOT): number {
  const problems = toolchainSurfaceProblems(repoRoot);
  for (const problem of problems) {
    console.error(`FAIL ${problem}`);
  }
  if (problems.length === 0) {
    console.log("toolchain surface: every official topic has a route or explicit boundary");
  }
  return problems.length > 0 ? 1 : 0;
}

if (isMain(import.meta.url)) {
  exitWith(main());
}

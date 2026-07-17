import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { exitWith, isMain } from "./lib/cli.ts";
import { parseFrontmatter, stringMap } from "./lib/frontmatter.ts";
import { REPO_ROOT } from "./lib/repo.ts";

const DISPOSITIONS = new Set(["verified", "documented", "out-of-scope", "not-actionable"]);
const EXECUTABLE_EVIDENCE = new Set(["checked-doc", "fixture", "command", "content-eval"]);
const ACTIONABLE_OWNER_SKILLS = new Set(["moonbit-language", "moonbit-toolchain"]);
const CHANGE_KINDS = new Set([
  "new-feature",
  "deprecation",
  "removal",
  "behavior-change",
  "bug-fix",
  "platform",
  "ecosystem",
  "performance",
]);

interface ReleaseInventory {
  schema_version?: unknown;
  release?: unknown;
  release_date?: unknown;
  generated_by?: unknown;
  source?: unknown;
  items?: unknown;
}

interface SourceItem {
  id?: unknown;
  section?: unknown;
  kind?: unknown;
  parent?: unknown;
  text?: unknown;
}

interface ReleaseCoverage {
  schema_version?: unknown;
  release?: unknown;
  status?: unknown;
  source_inventory?: unknown;
  decisions?: unknown;
}

interface Decision {
  source_ids?: unknown;
  summary?: unknown;
  change?: unknown;
  agent_behavior?: unknown;
  disposition?: unknown;
  owner_skill?: unknown;
  reason?: unknown;
  claims?: unknown;
  evidence?: unknown;
}

interface Claim {
  text?: unknown;
  evidence_roles?: unknown;
}

interface Evidence {
  kind?: unknown;
  role?: unknown;
  path?: unknown;
  marker?: unknown;
  entry_id?: unknown;
  source_url?: unknown;
}

interface CommandManifest {
  entries?: Array<{ id?: unknown }>;
}

export function releaseCoverageProblems(repoRoot = REPO_ROOT): string[] {
  const problems: string[] = [];
  const releasesDirectory = join(repoRoot, "verification", "releases");
  if (!isDirectory(releasesDirectory)) {
    return ["missing verification/releases directory"];
  }

  const currentSkillReleases = readCurrentSkillReleases(repoRoot, problems);
  const coverageFiles = readdirSync(releasesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(releasesDirectory, entry.name, "coverage.json"))
    .filter(isFile)
    .sort();
  if (coverageFiles.length === 0) {
    return [...problems, "verification/releases contains no coverage files"];
  }

  const manifestIds = readManifestIds(repoRoot, problems);
  const currentCoverages: string[] = [];
  for (const coverageFile of coverageFiles) {
    const releaseDirectory = resolve(coverageFile, "..");
    const label = `${basename(releaseDirectory)}/coverage.json`;
    const coverage = readJson<ReleaseCoverage>(coverageFile, label, problems);
    if (coverage === undefined) {
      continue;
    }
    const inventoryName = stringValue(coverage.source_inventory);
    const inventoryPath = safeRepoPath(releaseDirectory, inventoryName);
    if (
      inventoryPath === undefined ||
      basename(inventoryName) !== inventoryName ||
      inventoryName !== "source.json"
    ) {
      problems.push(`${label}: source_inventory must name the sibling source.json file`);
      continue;
    }
    const inventoryLabel = `${basename(releaseDirectory)}/source.json`;
    const inventory = readJson<ReleaseInventory>(inventoryPath, inventoryLabel, problems);
    if (inventory === undefined) {
      continue;
    }
    problems.push(...validateInventory(inventory, inventoryLabel));
    problems.push(
      ...validateCoverage(
        coverage,
        inventory,
        label,
        repoRoot,
        manifestIds,
        coverage.status === "current",
      ),
    );
    if (coverage.status === "current" && typeof coverage.release === "string") {
      currentCoverages.push(coverage.release);
    }
  }

  if (currentCoverages.length !== 1) {
    problems.push(
      `expected exactly one current release coverage file, found ${currentCoverages.length}`,
    );
  }
  if (currentSkillReleases.size === 1 && currentCoverages.length === 1) {
    const skillRelease = [...currentSkillReleases][0];
    if (currentCoverages[0] !== skillRelease) {
      problems.push(
        `current release coverage ${repr(currentCoverages[0])} does not match skill release ${repr(skillRelease)}`,
      );
    }
  }
  return problems;
}

export function validateInventory(inventory: ReleaseInventory, label: string): string[] {
  const problems: string[] = [];
  const fail = (message: string): void => {
    problems.push(`${label}: ${message}`);
  };
  if (inventory.schema_version !== 2) {
    fail("schema_version must be 2");
  }
  if (!nonEmptyString(inventory.release)) {
    fail("release must be a non-empty string");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stringValue(inventory.release_date))) {
    fail("release_date must use YYYY-MM-DD");
  }
  if (inventory.generated_by !== "tooling/snapshot_release.ts") {
    fail("generated_by must be tooling/snapshot_release.ts");
  }
  const source = recordValue(inventory.source);
  if (source === undefined) {
    fail("source must be an object");
  } else {
    if (source.repository !== "https://github.com/moonbitlang/website") {
      fail("source.repository must be the official MoonBit website repository");
    }
    if (!/^[0-9a-f]{40}$/.test(stringValue(source.commit))) {
      fail("source.commit must be a full Git commit");
    }
    if (!nonEmptyString(source.path) || !stringValue(source.path).endsWith("/index.md")) {
      fail("source.path must point to the release Markdown index.md");
    }
    if (!stringValue(source.web_url).startsWith("https://www.moonbitlang.com/updates/")) {
      fail("source.web_url must be a direct MoonBit release URL");
    }
    if (!/^[0-9a-f]{64}$/.test(stringValue(source.sha256))) {
      fail("source.sha256 must be a SHA-256 digest");
    }
  }

  if (!Array.isArray(inventory.items) || inventory.items.length === 0) {
    fail("items must be a non-empty array");
    return problems;
  }
  const ids = new Set<string>();
  const topLevelNumbers = new Map<string, number[]>();
  for (const rawItem of inventory.items) {
    if (!isRecord(rawItem)) {
      fail("every source item must be an object");
      continue;
    }
    const item = rawItem as SourceItem;
    const id = stringValue(item.id);
    const section = stringValue(item.section);
    const kind = stringValue(item.kind);
    if (!/^(language|toolchain|standard-library)-\d+(?:-[pbc]\d+)?$/.test(id)) {
      fail(`invalid source item id ${repr(id)}`);
    }
    if (ids.has(id)) {
      fail(`duplicate source item id ${repr(id)}`);
    }
    ids.add(id);
    if (!new Set(["language", "toolchain", "standard-library"]).has(section)) {
      fail(`${id || "item"}: invalid section ${repr(section)}`);
    }
    if (
      kind !== "numbered-item" &&
      kind !== "paragraph" &&
      kind !== "bullet" &&
      kind !== "code-block"
    ) {
      fail(`${id || "item"}: kind must be numbered-item, paragraph, bullet, or code-block`);
    }
    if (!nonEmptyString(item.text)) {
      fail(`${id || "item"}: text must be a non-empty string`);
    }
    if (kind === "numbered-item") {
      if (item.parent !== undefined) {
        fail(`${id}: numbered items must not have parent`);
      }
      const match = id.match(/-(\d+)$/);
      if (match !== null) {
        const numbers = topLevelNumbers.get(section) ?? [];
        numbers.push(Number(match[1]));
        topLevelNumbers.set(section, numbers);
      }
    } else {
      const parent = stringValue(item.parent);
      const suffix = kind === "paragraph" ? "p" : kind === "bullet" ? "b" : "c";
      if (!ids.has(parent) || !id.startsWith(`${parent}-${suffix}`)) {
        fail(`${id}: ${kind} parent ${repr(parent)} must be an earlier numbered item`);
      }
    }
  }
  for (const section of ["language", "toolchain", "standard-library"]) {
    const numbers = (topLevelNumbers.get(section) ?? []).sort((left, right) => left - right);
    if (numbers.length === 0) {
      fail(`section ${section} has no numbered items`);
      continue;
    }
    const expected = Array.from({ length: numbers.at(-1) ?? 0 }, (_, index) => index + 1);
    if (numbers.join(",") !== expected.join(",")) {
      fail(`section ${section} numbered items are not contiguous from 1`);
    }
  }
  return problems;
}

export function validateCoverage(
  coverage: ReleaseCoverage,
  inventory: ReleaseInventory,
  label: string,
  repoRoot: string,
  manifestIds: Set<string>,
  checkLiveEvidence: boolean,
): string[] {
  const problems: string[] = [];
  const fail = (message: string): void => {
    problems.push(`${label}: ${message}`);
  };
  if (coverage.schema_version !== 2) {
    fail("schema_version must be 2");
  }
  if (!nonEmptyString(coverage.release)) {
    fail("release must be a non-empty string");
  } else if (coverage.release !== inventory.release) {
    fail(
      `release ${repr(coverage.release)} does not match source inventory ${repr(stringValue(inventory.release))}`,
    );
  }
  if (coverage.status !== "current" && coverage.status !== "archived") {
    fail("status must be current or archived");
  }
  if (!Array.isArray(coverage.decisions)) {
    fail("decisions must be an array");
    return problems;
  }

  const sourceIds = new Set(
    (Array.isArray(inventory.items) ? inventory.items : [])
      .filter(isRecord)
      .map((item) => stringValue((item as SourceItem).id)),
  );
  const seen = new Set<string>();
  for (const rawDecision of coverage.decisions) {
    if (!isRecord(rawDecision)) {
      fail("every decision must be an object");
      continue;
    }
    const decision = rawDecision as Decision;
    if (!Array.isArray(decision.source_ids) || decision.source_ids.length === 0) {
      fail("every decision requires a non-empty source_ids array");
      continue;
    }
    const decisionSourceIds = decision.source_ids.map(stringValue);
    for (const sourceId of decisionSourceIds) {
      if (!sourceIds.has(sourceId)) {
        fail(`decision has unknown source_id ${repr(sourceId)}`);
      }
      if (seen.has(sourceId)) {
        fail(`duplicate decision for source_id ${repr(sourceId)}`);
      }
      seen.add(sourceId);
    }
    validateDecision(
      decision,
      decisionSourceIds.join(","),
      checkLiveEvidence,
      repoRoot,
      manifestIds,
      fail,
    );
  }
  for (const sourceId of sourceIds) {
    if (!seen.has(sourceId)) {
      fail(`missing decision for source item ${repr(sourceId)}`);
    }
  }
  return problems;
}

function validateDecision(
  decision: Decision,
  sourceId: string,
  checkLiveEvidence: boolean,
  repoRoot: string,
  manifestIds: Set<string>,
  fail: (message: string) => void,
): void {
  const prefix = sourceId || "decision";
  if (!nonEmptyString(decision.summary)) {
    fail(`${prefix}: summary must be a non-empty string`);
  }
  const change = stringValue(decision.change);
  if (!CHANGE_KINDS.has(change)) {
    fail(`${prefix}: invalid change kind ${repr(change)}`);
  }
  const disposition = stringValue(decision.disposition);
  if (!DISPOSITIONS.has(disposition)) {
    fail(`${prefix}: invalid disposition ${repr(disposition)}`);
    return;
  }
  const actionable = disposition === "verified" || disposition === "documented";
  if (!actionable) {
    if (!nonEmptyString(decision.reason)) {
      fail(`${prefix}: ${disposition} decisions require reason`);
    }
    if (Array.isArray(decision.evidence) && decision.evidence.length > 0) {
      fail(`${prefix}: ${disposition} decisions must not carry evidence`);
    }
    return;
  }

  const ownerSkill = stringValue(decision.owner_skill);
  if (!ACTIONABLE_OWNER_SKILLS.has(ownerSkill)) {
    fail(
      `${prefix}: ${disposition} decisions require owner_skill moonbit-language or moonbit-toolchain`,
    );
  }
  if (!nonEmptyString(decision.agent_behavior)) {
    fail(`${prefix}: ${disposition} decisions require agent_behavior`);
  }
  if (!Array.isArray(decision.evidence) || decision.evidence.length === 0) {
    fail(`${prefix}: ${disposition} decisions require evidence`);
    return;
  }
  if (!Array.isArray(decision.claims) || decision.claims.length === 0) {
    fail(`${prefix}: ${disposition} decisions require an explicit non-empty claims array`);
    return;
  }

  const evidenceByRole = new Map<string, string>();
  for (const rawEvidence of decision.evidence) {
    if (!isRecord(rawEvidence)) {
      fail(`${prefix}: every evidence entry must be an object`);
      continue;
    }
    const evidence = rawEvidence as Evidence;
    const role = stringValue(evidence.role);
    if (!nonEmptyString(evidence.role)) {
      fail(`${prefix}: every evidence entry requires a non-empty role`);
    } else if (evidenceByRole.has(role)) {
      fail(`${prefix}: duplicate evidence role ${repr(role)}`);
    } else {
      evidenceByRole.set(role, stringValue(evidence.kind));
    }
    validateEvidence(evidence, prefix, ownerSkill, checkLiveEvidence, repoRoot, manifestIds, fail);
  }

  const referencedRoles = new Set<string>();
  for (const [index, rawClaim] of decision.claims.entries()) {
    if (!isRecord(rawClaim)) {
      fail(`${prefix}: claim ${index + 1} must be an object`);
      continue;
    }
    const claim = rawClaim as Claim;
    if (!nonEmptyString(claim.text)) {
      fail(`${prefix}: claim ${index + 1} requires non-empty text`);
    }
    if (!Array.isArray(claim.evidence_roles) || claim.evidence_roles.length === 0) {
      fail(`${prefix}: claim ${index + 1} requires evidence_roles`);
      continue;
    }
    const roles = claim.evidence_roles.map(stringValue);
    if (roles.some((role) => role === "")) {
      fail(`${prefix}: claim ${index + 1} evidence_roles must be non-empty strings`);
    }
    if (new Set(roles).size !== roles.length) {
      fail(`${prefix}: claim ${index + 1} has duplicate evidence_roles`);
    }
    for (const role of roles) {
      referencedRoles.add(role);
      if (!evidenceByRole.has(role)) {
        fail(`${prefix}: claim ${index + 1} references unknown evidence role ${repr(role)}`);
      }
    }
    const requiredKind = disposition === "verified" ? EXECUTABLE_EVIDENCE : new Set(["documented"]);
    if (!roles.some((role) => requiredKind.has(evidenceByRole.get(role) ?? ""))) {
      fail(
        `${prefix}: claim ${index + 1} lacks ${disposition === "verified" ? "executable" : "documented"} evidence`,
      );
    }
  }
  for (const role of evidenceByRole.keys()) {
    if (!referencedRoles.has(role)) {
      fail(`${prefix}: evidence role ${repr(role)} is not linked to a claim`);
    }
  }

  const kinds = [...evidenceByRole.values()];
  if (disposition === "verified" && !kinds.some((kind) => EXECUTABLE_EVIDENCE.has(kind))) {
    fail(`${prefix}: verified decisions require executable evidence`);
  }
  if (disposition === "documented" && !kinds.includes("documented")) {
    fail(`${prefix}: documented decisions require documented evidence`);
  }
  if (actionable && change === "deprecation") {
    const roles = new Set(evidenceByRole.keys());
    for (const role of ["deprecated-form", "replacement"]) {
      if (!roles.has(role)) {
        fail(`${prefix}: deprecations require ${role} evidence`);
      }
    }
    if (disposition === "documented" && !nonEmptyString(decision.reason)) {
      fail(`${prefix}: documented deprecations require an explicit unexecuted reason`);
    }
  }
}

function validateEvidence(
  evidence: Evidence,
  prefix: string,
  ownerSkill: string,
  checkLiveEvidence: boolean,
  repoRoot: string,
  manifestIds: Set<string>,
  fail: (message: string) => void,
): void {
  const kind = stringValue(evidence.kind);
  if (![...EXECUTABLE_EVIDENCE, "documented"].includes(kind)) {
    fail(`${prefix}: unknown evidence kind ${repr(kind)}`);
    return;
  }
  if (kind === "command") {
    const entryId = stringValue(evidence.entry_id);
    if (!nonEmptyString(evidence.entry_id)) {
      fail(`${prefix}: command evidence requires entry_id`);
    } else if (checkLiveEvidence && !manifestIds.has(entryId)) {
      fail(`${prefix}: command manifest has no entry ${repr(entryId)}`);
    }
    return;
  }

  const relativePath = stringValue(evidence.path);
  const marker = stringValue(evidence.marker);
  if (!nonEmptyString(evidence.path) || !nonEmptyString(evidence.marker)) {
    fail(`${prefix}: ${kind} evidence requires path and marker`);
    return;
  }
  const fullPath = safeRepoPath(repoRoot, relativePath);
  if (fullPath === undefined) {
    fail(`${prefix}: evidence path escapes repository: ${repr(relativePath)}`);
    return;
  }
  if (kind === "checked-doc") {
    const expectedPrefix = `skills/${ownerSkill}/references/`;
    if (!relativePath.startsWith(expectedPrefix) || !relativePath.endsWith(".mbt.md")) {
      fail(`${prefix}: checked-doc evidence must be a .mbt.md reference owned by ${ownerSkill}`);
    }
  }
  if (kind === "fixture" && !/^verification\/fixtures\/[^/]+\/fixture\.json$/.test(relativePath)) {
    fail(`${prefix}: fixture evidence path must name a fixture.json`);
  }
  if (
    kind === "content-eval" &&
    !/^evals\/(language|toolchain|integration)\/tasks\/[^/]+\/task\.json$/.test(relativePath)
  ) {
    fail(`${prefix}: content-eval evidence path must name an eval task.json`);
  }
  if (kind === "documented") {
    if (!nonEmptyString(evidence.source_url) || !evidence.source_url.startsWith("https://")) {
      fail(`${prefix}: documented evidence requires an https source_url`);
    }
  }
  if (!checkLiveEvidence) {
    return;
  }
  if (!isFile(fullPath)) {
    fail(`${prefix}: evidence file does not exist: ${relativePath}`);
    return;
  }
  const text = readFileSync(fullPath, "utf8");
  if (!text.includes(marker)) {
    fail(`${prefix}: evidence marker not found in ${relativePath}: ${repr(marker)}`);
  }
  if (kind === "checked-doc" && !markerInsideCheckedFence(text, marker)) {
    fail(`${prefix}: checked-doc marker is not inside an mbt check fence in ${relativePath}`);
  }
  if (kind === "documented" && !markerInsideDocumentedLabel(text, marker)) {
    fail(
      `${prefix}: documented evidence marker is not in a paragraph explicitly labeled Documented, not executed`,
    );
  }
  if (kind === "fixture") {
    const fixture = JSON.parse(text) as { owner_skill?: unknown };
    if (fixture.owner_skill !== ownerSkill) {
      fail(
        `${prefix}: fixture owner_skill ${repr(stringValue(fixture.owner_skill))} does not match ${repr(ownerSkill)}`,
      );
    }
  }
}

function markerInsideCheckedFence(text: string, marker: string): boolean {
  const fencePattern = /```mbt check\s*\n([\s\S]*?)```/g;
  return [...text.matchAll(fencePattern)].some((match) => match[1].includes(marker));
}

function markerInsideDocumentedLabel(text: string, marker: string): boolean {
  return text
    .split(/\r?\n\s*\r?\n/)
    .some((paragraph) => paragraph.includes(marker) && /Documented, not executed/i.test(paragraph));
}

function readCurrentSkillReleases(repoRoot: string, problems: string[]): Set<string> {
  const releases = new Set<string>();
  const skillsDirectory = join(repoRoot, "skills");
  if (!isDirectory(skillsDirectory)) {
    problems.push("missing skills directory");
    return releases;
  }
  for (const entry of readdirSync(skillsDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillMd = join(skillsDirectory, entry.name, "SKILL.md");
    if (!isFile(skillMd)) {
      continue;
    }
    const parsed = parseFrontmatter(readFileSync(skillMd, "utf8"));
    const release = stringMap(parsed.frontmatter, "metadata")?.["moonbit-release"];
    if (release !== undefined) {
      releases.add(release);
    }
  }
  if (releases.size === 0) {
    problems.push("no skill declares metadata.moonbit-release");
  } else if (releases.size > 1) {
    problems.push(`skills disagree on moonbit-release: ${[...releases].sort().join(", ")}`);
  }
  return releases;
}

function readManifestIds(repoRoot: string, problems: string[]): Set<string> {
  const path = join(repoRoot, "verification", "commands", "manifest.json");
  if (!isFile(path)) {
    problems.push("missing verification/commands/manifest.json");
    return new Set();
  }
  const manifest = JSON.parse(readFileSync(path, "utf8")) as CommandManifest;
  return new Set(
    (manifest.entries ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === "string"),
  );
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
  if (full !== root && !full.startsWith(`${root}${sep}`)) {
    return undefined;
  }
  return full;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

function repr(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

export function main(repoRoot = REPO_ROOT): number {
  const problems = releaseCoverageProblems(repoRoot);
  for (const problem of problems) {
    console.error(`FAIL ${problem}`);
  }
  if (problems.length === 0) {
    console.log("release coverage: complete");
  }
  return problems.length > 0 ? 1 : 0;
}

if (isMain(import.meta.url)) {
  exitWith(main());
}

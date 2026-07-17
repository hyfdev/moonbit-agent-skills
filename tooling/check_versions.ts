import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { exitWith, isMain } from "./lib/cli.ts";
import { parseFrontmatter, stringMap } from "./lib/frontmatter.ts";
import { REPO_ROOT } from "./lib/repo.ts";

const SNAPSHOT = join(REPO_ROOT, "verification", "toolchains", "current.json");
const SKILLS_DIR = join(REPO_ROOT, "skills");
const FIXTURES_DIR = join(REPO_ROOT, "verification", "fixtures");

const COMPONENT_KEY: Record<string, string> = {
  "moonc-version": "moonc",
  "moon-version": "moon",
  "moonrun-version": "moonrun",
};

interface Component {
  name: string;
  version: string;
}

interface ToolchainSnapshot {
  verification_date: string;
  platform: { os: string; arch: string };
  components: Component[];
  verified_targets: string[];
}

interface FixtureStamp {
  date?: string;
  components?: Record<string, string>;
}

interface FixtureMetadata {
  verified?: FixtureStamp;
}

export function main(): number {
  const problems: string[] = [];
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as ToolchainSnapshot;
  const components = new Map(snapshot.components.map((component) => [component.name, component]));
  const snapshotDate = snapshot.verification_date;
  const snapshotTargets = new Set(snapshot.verified_targets);
  const snapshotPlatform = `${snapshot.platform.os}-${snapshot.platform.arch}`;

  for (const skillDirectory of directories(SKILLS_DIR)) {
    const skillMd = join(skillDirectory, "SKILL.md");
    if (!isFile(skillMd)) {
      continue;
    }
    const parsed = parseFrontmatter(readFileSync(skillMd, "utf8"));
    const metadata = stringMap(parsed.frontmatter, "metadata") ?? {};
    const label = basename(skillDirectory);

    if (!("moonbit-release" in metadata)) {
      continue;
    }

    for (const [metadataKey, componentName] of Object.entries(COMPONENT_KEY)) {
      if (!(metadataKey in metadata)) {
        continue;
      }
      const expected = components.get(componentName)?.version;
      if (expected === undefined) {
        throw new Error(`snapshot missing component ${componentName}`);
      }
      if (metadata[metadataKey] !== expected) {
        problems.push(
          `${label}: metadata.${metadataKey}=${repr(metadata[metadataKey])} but snapshot has ${repr(expected)}`,
        );
      }
      const head = parsed.body.split("\n").slice(0, 40).join("\n");
      if (!head.includes(expected)) {
        problems.push(
          `${label}: SKILL.md body head does not state verified ${componentName} version ${repr(expected)}`,
        );
      }
    }

    if (metadata["verified-date"] !== snapshotDate) {
      problems.push(
        `${label}: metadata.verified-date=${reprOptional(metadata["verified-date"])} != snapshot ${repr(snapshotDate)}`,
      );
    }
    if (metadata["verified-platform"] !== snapshotPlatform) {
      problems.push(
        `${label}: metadata.verified-platform=${reprOptional(metadata["verified-platform"])} != snapshot ${repr(snapshotPlatform)}`,
      );
    }
    const declaredTargets = new Set(
      (metadata["verified-targets"] ?? "")
        .split(",")
        .map((target) => target.trim())
        .filter(Boolean),
    );
    if (
      declaredTargets.size === 0 ||
      [...declaredTargets].some((target) => !snapshotTargets.has(target))
    ) {
      problems.push(
        `${label}: metadata.verified-targets ${reprList([...declaredTargets].sort())} must be a non-empty subset of snapshot ${reprList([...snapshotTargets].sort())}`,
      );
    }
  }

  for (const fixtureDirectory of directories(FIXTURES_DIR)) {
    const metadataFile = join(fixtureDirectory, "fixture.json");
    if (!isFile(metadataFile)) {
      continue;
    }
    const metadata = JSON.parse(readFileSync(metadataFile, "utf8")) as FixtureMetadata;
    const stamp = metadata.verified;
    const fixture = basename(fixtureDirectory);
    if (stamp === undefined) {
      problems.push(`fixture ${fixture}: never stamped as verified`);
      continue;
    }
    for (const component of snapshot.components) {
      const stamped = stamp.components?.[component.name] ?? "";
      if (!stamped.includes(component.version)) {
        problems.push(
          `fixture ${fixture}: stamped ${component.name} ${repr(stamped)} does not match snapshot ${repr(component.version)}`,
        );
      }
    }
    if (stamp.date !== snapshotDate) {
      problems.push(
        `fixture ${fixture}: stamp date ${reprOptional(stamp.date)} != snapshot ${repr(snapshotDate)}`,
      );
    }
  }

  for (const problem of problems) {
    console.error(`FAIL ${problem}`);
  }
  if (problems.length === 0) {
    console.log("version consistency: OK");
  }
  return problems.length > 0 ? 1 : 0;
}

function directories(parent: string): string[] {
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(parent, entry.name))
    .sort();
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function repr(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function reprOptional(value: string | undefined): string {
  return value === undefined ? "None" : repr(value);
}

function reprList(values: string[]): string {
  return `[${values.map(repr).join(", ")}]`;
}

if (isMain(import.meta.url)) {
  exitWith(main());
}

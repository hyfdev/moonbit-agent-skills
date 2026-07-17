import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  releaseCoverageProblems,
  validateCoverage,
  validateInventory,
} from "../check_release_coverage.ts";
import {
  createReleaseInventory,
  extractReleaseItems,
  type ReleaseInventory,
} from "../snapshot_release.ts";
import { verifyReleaseSources } from "../verify_release_sources.ts";
import { REPO_ROOT } from "../lib/repo.ts";

const RELEASE_MARKDOWN = `# MoonBit 0.10.4

## Language Updates

1. **Language feature**

The feature has a paragraph.

- First detail.

\`\`\`mbt
ignored code
\`\`\`

## Toolchain Updates

1. Toolchain feature

Toolchain paragraph.

## Standard Library Updates

1. Library feature
`;

const SOURCE_METADATA = {
  release: "0.10.4",
  releaseDate: "2026-07-13",
  commit: "a".repeat(40),
  sourcePath: "updates/2026-07-13-moonbit-0-10-4-release/index.md",
  webUrl: "https://www.moonbitlang.com/updates/2026/07/13/moonbit-0-10-4-release",
};

describe("release source inventory", () => {
  it("extracts numbered items, paragraphs, and bullets while ignoring code fences", () => {
    expect(extractReleaseItems(RELEASE_MARKDOWN)).toEqual([
      {
        id: "language-1",
        section: "language",
        kind: "numbered-item",
        text: "Language feature",
      },
      {
        id: "language-1-p1",
        section: "language",
        kind: "paragraph",
        parent: "language-1",
        text: "The feature has a paragraph.",
      },
      {
        id: "language-1-b1",
        section: "language",
        kind: "bullet",
        parent: "language-1",
        text: "First detail.",
      },
      {
        id: "language-1-c1",
        section: "language",
        kind: "code-block",
        parent: "language-1",
        language: "mbt",
        text: "ignored code",
      },
      {
        id: "toolchain-1",
        section: "toolchain",
        kind: "numbered-item",
        text: "Toolchain feature",
      },
      {
        id: "toolchain-1-p1",
        section: "toolchain",
        kind: "paragraph",
        parent: "toolchain-1",
        text: "Toolchain paragraph.",
      },
      {
        id: "standard-library-1",
        section: "standard-library",
        kind: "numbered-item",
        text: "Library feature",
      },
    ]);
  });

  it("rejects a skipped top-level release number", () => {
    const broken = RELEASE_MARKDOWN.replace("1. Toolchain feature", "2. Toolchain feature");
    expect(() => extractReleaseItems(broken)).toThrow(/non-contiguous numbering in toolchain/);
  });

  it("fails closed when a release adds an unknown level-two section", () => {
    const broken = RELEASE_MARKDOWN.replace(
      "## Toolchain Updates",
      "## Package Manager Updates\n\n1. New package behavior\n\n## Toolchain Updates",
    );
    expect(() => extractReleaseItems(broken)).toThrow(
      /unknown level-two section "Package Manager Updates"/,
    );
  });

  it("fails closed on prose or code before the first numbered item in a section", () => {
    const prose = RELEASE_MARKDOWN.replace(
      "## Language Updates\n\n1.",
      "## Language Updates\n\nImportant unnumbered change.\n\n1.",
    );
    expect(() => extractReleaseItems(prose)).toThrow(/content before the first item in language/);

    const code = RELEASE_MARKDOWN.replace(
      "## Toolchain Updates\n\n1.",
      "## Toolchain Updates\n\n```sh\nmoon new demo\n```\n\n1.",
    );
    expect(() => extractReleaseItems(code)).toThrow(
      /code block before the first item in toolchain/,
    );
  });

  it("accepts the committed generated inventory", () => {
    const inventory = JSON.parse(
      readFileSync(join(REPO_ROOT, "verification/releases/0.10.4/source.json"), "utf8"),
    ) as ReleaseInventory;
    expect(validateInventory(inventory, "source.json")).toEqual([]);
    expect(inventory.items.length).toBeGreaterThan(86);
  });
});

describe("release coverage closure", () => {
  it("accepts all live evidence in the repository", () => {
    expect(releaseCoverageProblems(REPO_ROOT)).toEqual([]);
  });

  it("reports an omitted source item", () => {
    const inventory = createReleaseInventory(RELEASE_MARKDOWN, SOURCE_METADATA);
    const coverage = coverageFor(inventory);
    coverage.decisions[0].source_ids.pop();
    expect(
      validateCoverage(coverage, inventory, "coverage.json", REPO_ROOT, new Set(), false),
    ).toContain("coverage.json: missing decision for source item 'standard-library-1'");
  });

  it("reports duplicate source decisions", () => {
    const inventory = createReleaseInventory(RELEASE_MARKDOWN, SOURCE_METADATA);
    const coverage = coverageFor(inventory);
    coverage.decisions.push({
      source_ids: ["language-1"],
      summary: "Duplicate",
      change: "new-feature",
      disposition: "not-actionable",
      reason: "Duplicate test decision.",
    });
    expect(
      validateCoverage(coverage, inventory, "coverage.json", REPO_ROOT, new Set(), false),
    ).toContain("coverage.json: duplicate decision for source_id 'language-1'");
  });

  it("requires executable evidence for verified decisions", () => {
    const inventory = createReleaseInventory(RELEASE_MARKDOWN, SOURCE_METADATA);
    const coverage = coverageFor(inventory);
    coverage.decisions = [
      {
        source_ids: inventory.items.map((item) => item.id),
        summary: "Claimed as verified",
        change: "new-feature",
        agent_behavior: "Recommend the feature.",
        disposition: "verified",
        owner_skill: "moonbit-language",
        claims: [
          {
            text: "The source-only claim is incorrectly called verified.",
            evidence_roles: ["source-only"],
          },
        ],
        evidence: [
          {
            kind: "documented",
            path: "skills/moonbit-language/references/attributes.mbt.md",
            marker: "Documented, not executed",
            source_url: SOURCE_METADATA.webUrl,
            role: "source-only",
          },
        ],
      },
    ];
    expect(
      validateCoverage(coverage, inventory, "coverage.json", REPO_ROOT, new Set(), false),
    ).toContain(
      "coverage.json: language-1,language-1-p1,language-1-b1,language-1-c1,toolchain-1,toolchain-1-p1,standard-library-1: verified decisions require executable evidence",
    );
  });

  it("restricts actionable coverage ownership to product skills", () => {
    const inventory = createReleaseInventory(RELEASE_MARKDOWN, SOURCE_METADATA);
    const coverage = coverageFor(inventory);
    coverage.decisions = [
      {
        source_ids: inventory.items.map((item) => item.id),
        summary: "Claimed by a repository-maintenance skill",
        change: "new-feature",
        agent_behavior: "Recommend the feature.",
        disposition: "verified",
        owner_skill: "moonbit-agent-skills-maintainer",
        claims: [
          {
            text: "The fixture proves the claim.",
            evidence_roles: ["proof"],
          },
        ],
        evidence: [
          {
            kind: "fixture",
            path: "verification/fixtures/example/fixture.json",
            marker: "example",
            role: "proof",
          },
        ],
      },
    ];
    expect(
      validateCoverage(coverage, inventory, "coverage.json", REPO_ROOT, new Set(), false),
    ).toContain(
      "coverage.json: language-1,language-1-p1,language-1-b1,language-1-c1,toolchain-1,toolchain-1-p1,standard-library-1: verified decisions require owner_skill moonbit-language or moonbit-toolchain",
    );
  });

  it("requires old-form and replacement evidence for a verified deprecation", () => {
    const inventory = createReleaseInventory(RELEASE_MARKDOWN, SOURCE_METADATA);
    const coverage = coverageFor(inventory);
    coverage.decisions = [
      {
        source_ids: inventory.items.map((item) => item.id),
        summary: "Deprecated form",
        change: "deprecation",
        agent_behavior: "Use the replacement.",
        disposition: "verified",
        owner_skill: "moonbit-language",
        claims: [
          {
            text: "The deprecated form is detected.",
            evidence_roles: ["deprecated-form"],
          },
        ],
        evidence: [
          {
            kind: "fixture",
            path: "verification/fixtures/example/fixture.json",
            marker: "example",
            role: "deprecated-form",
          },
        ],
      },
    ];
    expect(
      validateCoverage(coverage, inventory, "coverage.json", REPO_ROOT, new Set(), false),
    ).toContain(
      "coverage.json: language-1,language-1-p1,language-1-b1,language-1-c1,toolchain-1,toolchain-1-p1,standard-library-1: deprecations require replacement evidence",
    );
  });

  it("requires executable evidence for every claim in a verified decision", () => {
    const inventory = createReleaseInventory(RELEASE_MARKDOWN, SOURCE_METADATA);
    const coverage = coverageFor(inventory);
    coverage.decisions = [
      {
        source_ids: inventory.items.map((item) => item.id),
        summary: "One tested claim and one source-only claim",
        change: "new-feature",
        agent_behavior: "Recommend both claims.",
        disposition: "verified",
        owner_skill: "moonbit-language",
        claims: [
          { text: "Tested behavior", evidence_roles: ["tested"] },
          { text: "Unrelated source-only behavior", evidence_roles: ["source-only"] },
        ],
        evidence: [
          {
            kind: "fixture",
            path: "verification/fixtures/example/fixture.json",
            marker: "example",
            role: "tested",
          },
          {
            kind: "documented",
            path: "skills/moonbit-language/references/attributes.mbt.md",
            marker: "Documented, not executed",
            source_url: SOURCE_METADATA.webUrl,
            role: "source-only",
          },
        ],
      },
    ];
    expect(
      validateCoverage(coverage, inventory, "coverage.json", REPO_ROOT, new Set(), false),
    ).toContain(
      "coverage.json: language-1,language-1-p1,language-1-b1,language-1-c1,toolchain-1,toolchain-1-p1,standard-library-1: claim 2 lacks executable evidence",
    );
  });

  it("applies the two-sided migration gate to documented deprecations", () => {
    const inventory = createReleaseInventory(RELEASE_MARKDOWN, SOURCE_METADATA);
    const coverage = coverageFor(inventory);
    coverage.decisions = [
      {
        source_ids: inventory.items.map((item) => item.id),
        summary: "A source-only deprecation",
        change: "deprecation",
        agent_behavior: "Use the replacement.",
        disposition: "documented",
        owner_skill: "moonbit-language",
        claims: [{ text: "The old form is deprecated.", evidence_roles: ["deprecated-form"] }],
        evidence: [
          {
            kind: "documented",
            path: "skills/moonbit-language/references/attributes.mbt.md",
            marker: "Documented, not executed",
            source_url: SOURCE_METADATA.webUrl,
            role: "deprecated-form",
          },
        ],
      },
    ];
    const problems = validateCoverage(
      coverage,
      inventory,
      "coverage.json",
      REPO_ROOT,
      new Set(),
      false,
    );
    expect(problems).toContain(
      "coverage.json: language-1,language-1-p1,language-1-b1,language-1-c1,toolchain-1,toolchain-1-p1,standard-library-1: deprecations require replacement evidence",
    );
    expect(problems).toContain(
      "coverage.json: language-1,language-1-p1,language-1-b1,language-1-c1,toolchain-1,toolchain-1-p1,standard-library-1: documented deprecations require an explicit unexecuted reason",
    );
  });
});

describe("pinned upstream regeneration", () => {
  it("detects a hand-edited source inventory", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "release-source-test-"));
    try {
      const releaseDirectory = join(temporary, "verification/releases/0.10.4");
      mkdirSync(releaseDirectory, { recursive: true });
      const inventory = createReleaseInventory(RELEASE_MARKDOWN, SOURCE_METADATA);
      inventory.items[0].text = "Hand-edited summary";
      writeFileSync(join(releaseDirectory, "source.json"), JSON.stringify(inventory));

      const requested: string[] = [];
      const problems = await verifyReleaseSources(temporary, async (url) => {
        requested.push(url);
        return {
          ok: true,
          status: 200,
          text: async () => RELEASE_MARKDOWN,
        };
      });

      expect(requested).toEqual([
        `https://raw.githubusercontent.com/moonbitlang/website/${SOURCE_METADATA.commit}/${SOURCE_METADATA.sourcePath}`,
      ]);
      expect(problems).toEqual([
        `0.10.4: source.json does not match ${SOURCE_METADATA.commit}:${SOURCE_METADATA.sourcePath}`,
      ]);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});

interface TestDecision {
  source_ids: string[];
  summary: string;
  change: string;
  disposition: string;
  reason?: string;
  agent_behavior?: string;
  owner_skill?: string;
  claims?: Array<{ text: string; evidence_roles: string[] }>;
  evidence?: Array<Record<string, string>>;
}

interface TestCoverage {
  schema_version: number;
  release: string;
  status: string;
  source_inventory: string;
  decisions: TestDecision[];
}

function coverageFor(inventory: ReleaseInventory): TestCoverage {
  return {
    schema_version: 2,
    release: inventory.release,
    status: "current",
    source_inventory: "source.json",
    decisions: [
      {
        source_ids: inventory.items.map((item) => item.id),
        summary: "Not actionable in this synthetic test.",
        change: "new-feature",
        disposition: "not-actionable",
        reason: "Synthetic coverage decision.",
      },
    ],
  };
}

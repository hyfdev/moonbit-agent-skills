import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  languageSurfaceProblems,
  validateLanguageSurfaceCoverage,
  validateLanguageSurfaceInventory,
} from "../check_language_surface.ts";
import {
  createLanguageSurfaceInventory,
  extractLanguageDocuments,
  extractLanguageIncludes,
  extractLanguageItems,
  LANGUAGE_INDEX_PATH,
  RAW_DOCS_REPOSITORY,
  type LanguageSurfaceInventory,
} from "../snapshot_language_surface.ts";
import { verifyLanguageSurfaceSource } from "../verify_language_surface_source.ts";
import { REPO_ROOT } from "../lib/repo.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const INDEX = `# Language

\`\`\`{toctree}
:hidden:
introduction
attributes
\`\`\`
`;

const INTRODUCTION = `# Introduction

## Functions

### Labelled arguments

\`\`\`moonbit
# not a heading
\`\`\`
`;

const ATTRIBUTES = `# Attributes

\`\`\`{include} /language/attributes/cfg.md
:heading-offset: 1
\`\`\`
`;

const CFG = `# Configuration attribute

## Predicates
`;

describe("official language surface snapshot", () => {
  it("extracts the direct toctree without a hand-authored page list", () => {
    expect(extractLanguageDocuments(INDEX)).toEqual([
      "next/language/introduction.md",
      "next/language/attributes.md",
    ]);
    expect(() =>
      extractLanguageDocuments(INDEX.replace("introduction", "Title <introduction>")),
    ).toThrow(/unsupported language toctree entry/);
  });

  it("follows included language pages and ignores headings in code fences", () => {
    expect(extractLanguageIncludes(ATTRIBUTES)).toEqual(["next/language/attributes/cfg.md"]);
    expect(extractLanguageItems("next/language/introduction.md", INTRODUCTION)).toEqual([
      {
        id: "document-introduction",
        document_id: "document-introduction",
        kind: "document",
        level: 1,
        text: "Introduction",
      },
      {
        id: "document-introduction-functions",
        document_id: "document-introduction",
        kind: "heading",
        level: 2,
        parent: "document-introduction",
        text: "Functions",
      },
      {
        id: "document-introduction-labelled-arguments",
        document_id: "document-introduction",
        kind: "heading",
        level: 3,
        parent: "document-introduction-functions",
        text: "Labelled arguments",
      },
    ]);
  });

  it("pins every direct and included file with a content-derived item ID", () => {
    const inventory = sampleInventory();
    expect(inventory.documents.map((document) => document.path)).toEqual([
      "next/language/introduction.md",
      "next/language/attributes/cfg.md",
      "next/language/attributes.md",
    ]);
    expect(inventory.items.map((item) => item.id)).toContain(
      "document-introduction-labelled-arguments",
    );
    expect(inventory.items.map((item) => item.id)).toContain("document-attributes-cfg-predicates");
    expect(validateLanguageSurfaceInventory(inventory, "source.json")).toEqual([]);
  });

  it("accepts the committed 33-document, 227-item inventory", () => {
    const inventory = JSON.parse(
      readFileSync(join(REPO_ROOT, "verification/language-surface/source.json"), "utf8"),
    ) as LanguageSurfaceInventory;
    expect(inventory.documents).toHaveLength(33);
    expect(inventory.items).toHaveLength(227);
    expect(validateLanguageSurfaceInventory(inventory, "source.json")).toEqual([]);
  });
});

describe("language surface closure and routes", () => {
  it("accepts every committed route and explicit product boundary", () => {
    expect(languageSurfaceProblems(REPO_ROOT)).toEqual([]);
  });

  it("reports a newly discovered heading until coverage is updated", () => {
    const root = minimalRoutedRepository();
    const inventory = minimalInventory("\n### Optional arguments\n");
    const coverage = JSON.parse(
      readFileSync(join(root, "verification/language-surface/coverage.json"), "utf8"),
    );
    expect(validateLanguageSurfaceCoverage(coverage, inventory, root)).toContain(
      "coverage.json: missing route for source item 'document-introduction-optional-arguments'",
    );
  });

  it("requires all search terms and the reference path on one route line", () => {
    const root = minimalRoutedRepository();
    writeFileSync(
      join(root, "skills/moonbit-language/SKILL.md"),
      "# Skill\n\n## Feature index\n\n- Functions\n- references/functions.mbt.md\n",
    );
    const coverage = JSON.parse(
      readFileSync(join(root, "verification/language-surface/coverage.json"), "utf8"),
    );
    const problems = validateLanguageSurfaceCoverage(coverage, minimalInventory(), root);
    expect(problems.join("\n")).toMatch(/one line.*functions\.mbt\.md.*Functions/);
  });

  it("regenerates a pinned source through an injected fetcher", async () => {
    const root = temporaryRoot();
    const directory = join(root, "verification", "language-surface");
    mkdirSync(directory, { recursive: true });
    const inventory = minimalInventory();
    writeFileSync(join(directory, "source.json"), `${JSON.stringify(inventory)}\n`);
    const responses = new Map([
      [`${RAW_DOCS_REPOSITORY}/${inventory.source.commit}/${LANGUAGE_INDEX_PATH}`, minimalIndex()],
      [
        `${RAW_DOCS_REPOSITORY}/${inventory.source.commit}/next/language/introduction.md`,
        minimalIntroduction(),
      ],
    ]);
    const fetcher = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const text = responses.get(url);
      return {
        ok: text !== undefined,
        status: text === undefined ? 404 : 200,
        text: async () => text ?? "",
      };
    }) as typeof fetch;
    expect(await verifyLanguageSurfaceSource(root, fetcher)).toEqual([]);
    responses.set(
      `${RAW_DOCS_REPOSITORY}/${inventory.source.commit}/next/language/introduction.md`,
      `${minimalIntroduction()}\n### New syntax\n`,
    );
    expect((await verifyLanguageSurfaceSource(root, fetcher)).join("\n")).toMatch(
      /does not match the pinned official docs/,
    );
  });
});

function sampleInventory(): LanguageSurfaceInventory {
  return createLanguageSurfaceInventory(
    INDEX,
    new Map([
      ["next/language/introduction.md", INTRODUCTION],
      ["next/language/attributes.md", ATTRIBUTES],
      ["next/language/attributes/cfg.md", CFG],
    ]),
    "a".repeat(40),
  );
}

function minimalIndex(): string {
  return "# Language\n\n```{toctree}\nintroduction\n```\n";
}

function minimalIntroduction(extra = ""): string {
  return `# Introduction\n\n## Functions\n${extra}`;
}

function minimalInventory(extra = ""): LanguageSurfaceInventory {
  return createLanguageSurfaceInventory(
    minimalIndex(),
    new Map([["next/language/introduction.md", minimalIntroduction(extra)]]),
    "b".repeat(40),
  );
}

function minimalRoutedRepository(): string {
  const root = temporaryRoot();
  const skill = join(root, "skills", "moonbit-language");
  const verification = join(root, "verification", "language-surface");
  mkdirSync(join(skill, "references"), { recursive: true });
  mkdirSync(verification, { recursive: true });
  writeFileSync(
    join(skill, "SKILL.md"),
    "# Skill\n\n## Feature index\n\n- Functions → references/functions.mbt.md\n",
  );
  writeFileSync(join(skill, "references/functions.mbt.md"), "# Functions\n");
  writeFileSync(
    join(verification, "coverage.json"),
    JSON.stringify({
      schema_version: 1,
      source_inventory: "source.json",
      routes: [
        {
          source_ids: ["document-introduction", "document-introduction-functions"],
          summary: "Functions",
          disposition: "routed",
          owner_skill: "moonbit-language",
          route: {
            section: "Feature index",
            reference: "references/functions.mbt.md",
            terms: ["Functions"],
          },
          content: { marker: "# Functions" },
        },
      ],
    }),
  );
  return root;
}

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "language-surface-test-"));
  temporaryDirectories.push(root);
  return root;
}

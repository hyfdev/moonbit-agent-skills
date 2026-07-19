import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { changedSkillRevisionProblems, singaporeDate } from "../check_skill_versions.ts";
import { runCommand } from "../lib/process.ts";

describe("changed skill version Git checks", () => {
  it("uses the base tip and sees committed, dirty, and untracked skill changes", () => {
    const repository = mkdtempSync(join(tmpdir(), "skill-version-git-test-"));
    try {
      git(repository, "init", "-b", "main");
      git(repository, "config", "user.name", "Skill Test");
      git(repository, "config", "user.email", "skill-test@example.com");
      writeSkill(repository, "moonbit-language", "0.3.0", "2026-07-18", "base");
      writeSkill(repository, "dirty-only", "0.1.0", "2026-07-18", "base");
      commit(repository, "base", "2026-07-18T10:00:00+08:00");

      git(repository, "switch", "-c", "feature");
      writeSkill(repository, "moonbit-language", "0.3.1", "2026-07-19", "feature");
      commit(repository, "feature", "2026-07-19T10:00:00+08:00");

      git(repository, "switch", "main");
      writeSkill(repository, "moonbit-language", "0.3.1", "2026-07-19", "other change");
      commit(repository, "other change", "2026-07-19T11:00:00+08:00");
      git(repository, "switch", "feature");

      expect(changedSkillRevisionProblems(repository, "main", runCommand, "2026-07-19")).toContain(
        "moonbit-language: changed content must increase metadata.skill-version above '0.3.1' (found '0.3.1')",
      );

      writeSkill(repository, "moonbit-language", "0.3.2", "2026-07-20", "second feature");
      commit(repository, "second feature", "2026-07-19T16:30:00Z");
      expect(changedSkillRevisionProblems(repository, "main", runCommand, "2026-07-20")).toEqual(
        [],
      );

      writeSkill(repository, "moonbit-language", "0.3.0", "2026-07-18", "base");
      expect(changedSkillRevisionProblems(repository, "main", runCommand, "2026-07-21")).toContain(
        "moonbit-language: changed content must increase metadata.skill-version above '0.3.1' (found '0.3.0')",
      );

      writeSkill(repository, "moonbit-language", "0.3.3", "2026-07-21", "dirty feature");
      writeSkill(repository, "new-skill", "0.1.0", "2026-07-20", "untracked skill");
      expect(changedSkillRevisionProblems(repository, "main", runCommand, "2026-07-21")).toContain(
        "new-skill: metadata.updated-date must match latest skill change date '2026-07-21' (found '2026-07-20')",
      );

      writeSkill(repository, "new-skill", "0.1.0", "2026-07-21", "untracked skill");
      expect(changedSkillRevisionProblems(repository, "main", runCommand, "2026-07-21")).toEqual(
        [],
      );
      commit(repository, "finish feature", "2026-07-21T10:00:00+08:00");
      expect(changedSkillRevisionProblems(repository, "HEAD", runCommand, "2026-07-21")).toEqual(
        [],
      );

      writeSkill(repository, "dirty-only", "0.1.0", "2026-07-18", "dirty working tree");
      expect(changedSkillRevisionProblems(repository, "HEAD", runCommand, "2026-07-22")).toContain(
        "dirty-only: changed content must increase metadata.skill-version above '0.1.0' (found '0.1.0')",
      );
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it("normalizes timestamps to the Singapore calendar date", () => {
    expect(singaporeDate("2026-07-18T16:30:00Z")).toBe("2026-07-19");
    expect(singaporeDate("2026-07-19T00:30:00+08:00")).toBe("2026-07-19");
  });
});

function writeSkill(
  repository: string,
  name: string,
  version: string,
  updatedDate: string,
  body: string,
): void {
  const directory = join(repository, "skills", name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: Test skill.\nmetadata:\n  skill-version: "${version}"\n  updated-date: "${updatedDate}"\n---\n${body}\n`,
  );
}

function commit(repository: string, message: string, authorDate: string): void {
  git(repository, "add", ".");
  git(repository, "commit", "-m", message, "--date", authorDate);
}

function git(repository: string, ...args: string[]): void {
  const result = runCommand("git", args, { cwd: repository });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`);
  }
}

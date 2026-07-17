# Reporting a skill error upstream

When the real toolchain contradicts something this skill states, the skill is wrong or stale — that is a reportable defect. Upstream tracker: https://github.com/hyfdev/moonbit-agent-skills/issues

## Step 0 — confirm it is the skill, not the task

- Reproduce the contradiction with a **freshly written, minimal** snippet or command in a scratch directory (never by pointing at the user's project).
- Run `moon version --all`. If the local version differs from the pin in this skill's frontmatter, the finding is "stale at version X" — still reportable, labeled as drift.
- Identify the exact skill file and the sentence/example making the contradicted claim.

## Step 1 — draft the issue locally (do not file yet)

Title: `[skill-error] <skill-name>: <claim topic> contradicted at <toolchain version>`

Body contains ONLY:

- skill name and `skill-version` (from frontmatter), plus the reference file and quoted claim;
- expected behavior (per the skill) vs observed behavior (verbatim toolchain output);
- the minimal repro — generic, self-contained, freshly written;
- `moon version --all` output and OS/arch.

**Privacy rules (hard):**

- Never include the user's project code, file paths, directory or repository names, package names, usernames, hostnames, company or product names, URLs from the user's setup, environment variables, or tokens.
- Rewrite the repro from scratch with generic names (`lib.mbt`, `demo/x`, `foo`); it must reproduce the contradiction on its own.
- If a faithful repro cannot be built without user-specific material, do not file; describe the contradiction abstractly to the user instead.

## Step 2 — mandatory user confirmation (hard gate)

- Show the user the **complete** issue text (title + body) and ask explicitly: "May I file this issue to github.com/hyfdev/moonbit-agent-skills?"
- File only on an explicit yes to that exact content. If the user edits it, show the final text once more.
- If the session is non-interactive, the user does not answer, or the user declines: **do not file.** Save the draft to a local file (e.g. `./skill-error-report.md`), tell the user where it is and that they can file it manually at the tracker URL above.

## Step 3 — filing (only after the yes)

- With an authenticated GitHub CLI: `gh issue create -R hyfdev/moonbit-agent-skills --title "..." --body-file skill-error-report.md`
- Without one: give the user the drafted body and the link https://github.com/hyfdev/moonbit-agent-skills/issues/new to paste it themselves.

Never: file without confirmation, batch unconfirmed reports, retry after a decline, or include anything the privacy rules exclude.

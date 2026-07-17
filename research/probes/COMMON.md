# Common instructions for MoonBit probe agents

Environment: macOS arm64. Toolchain (verify yourself with `moon version --all`):
moon 0.1.20260713, moonc v0.10.4+ade96c819, moonrun 0.1.20260713. Build dir is `_build`.

Your job: establish VERIFIED facts about current MoonBit by running the real toolchain. Never trust your pretraining — MoonBit syntax has changed a lot; your memory is likely stale. The loop is: write minimal example -> run `moon check` / `moon test` -> record exact result.

Setup: work ONLY inside your assigned directory. Create a scratch module with `moon new <name> --user probeuser` (note: --user is required in non-interactive mode). Config files are the NEW non-JSON formats `moon.mod` / `moon.pkg`. A library package lives at the module root; blackbox tests go in `*_test.mbt` (import root package as `@<modname>`); `cmd/main/` holds an executable package.

Syntax reference (READ FIRST, but always re-verify by running): the official MoonBit agent guide at
<session-workspace>/official-skills/skills/moonbit-agent-guide/SKILL.md
Read the sections relevant to your battery before probing (it reflects current syntax far better than your memory).
Also useful: `moon explain --attribute <name>`, `moon explain --diagnostic <id-or-name>`, `moon ide doc '<query>'` (stdlib API search).

Recording format — append each finding to your assigned findings file as:

### <short-topic-id>
- conclusion: <one-sentence fact>
- example:
```
<exact code that ran, self-contained>
```
- command: <exact command + target>
- result: <pass/fail + the key output lines, verbatim>
- notes: <surprises, differences from Rust/TS/Go, version caveats>

Rules:
- Every example must be SELF-CONTAINED: compiles standalone in a fresh package using only the core stdlib (no external deps). Test-shaped examples should be a `test "..." { }` block plus any needed top-level declarations.
- Run every example at least on wasm-gc (default). If behavior might differ per target, also try js and native and note it.
- If something you expect to exist does NOT work, that IS a finding — record the exact rejection.
- Prefer many small examples over one big file: one bad declaration can poison a whole package check. Iterate file-by-file.
- Keep the findings file plain markdown, no invented jargon.

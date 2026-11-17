# claude-memory-check

Claude Code loads only the first 200 lines or 25KB of your auto memory index, `MEMORY.md`, at the start of a session, and drops the rest ([docs](https://code.claude.com/docs/en/memory#how-it-works)). Recent versions tell Claude when a write pushes the index over the limit, but that note goes to Claude, not to you, and an index that grew past it earlier stays cut. This shows you where the cut falls.

```
npx claude-memory-check          # this folder's CLAUDE.md files and auto memory
npx claude-memory-check --all    # every project's MEMORY.md under ~/.claude/projects
```

Needs Node 18 or later.

## What it checks

- `MEMORY.md`: lines and size against the 200-line / 25KB cut (YAML frontmatter and block-level HTML comments don't count, as in Claude Code), and which entries fall past it
- links in `MEMORY.md` to topic files that don't exist
- topic files no index line points to, which Claude won't find on its own
- topic files listed only past the cut
- `CLAUDE.md` files (`~/.claude/CLAUDE.md`, and `CLAUDE.md`, `.claude/CLAUDE.md` and `CLAUDE.local.md` here and in every folder above): size, `@imports` that don't resolve, the total loaded every session, and files over the docs' ~200-line guidance

Run from a subdirectory or a git worktree, it finds the repository's memory folder, as Claude Code does.

## What it reads

Everything stays on your machine. It reads `MEMORY.md` and the file names in the memory folder, the `CLAUDE.md` files above, and the files they `@import` (for their size), then prints a report to your terminal. It writes nothing, changes nothing and sends nothing anywhere: no network calls, no telemetry, no dependencies. The report quotes the first 100 characters of up to five index lines that fall past the cut, so you can see which ones. The source is one file, `check.mjs`.

## Not handled

A memory folder moved with `autoMemoryDirectory` (it says so instead), `CLAUDE_CONFIG_DIR` and `CLAUDE_CODE_PROJECT_DIR_NAME`, `AGENTS.md`, `.claude/rules/`, managed (organization) `CLAUDE.md` files, and Windows paths. The 25KB is measured in bytes, so an index with many non-ASCII characters may show the cut slightly early.

MIT licensed. More on how Claude Code memory works, from the people behind Counterparts: [counterparts.ai/guides/claude-code-memory](https://counterparts.ai/guides/claude-code-memory/)

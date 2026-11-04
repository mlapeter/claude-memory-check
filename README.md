# claude-memory-check

Claude Code loads only the first 200 lines or 25KB of `MEMORY.md` at the start of a session and drops the rest without saying so ([docs](https://code.claude.com/docs/en/memory)). This shows you the cut.

```
npx claude-memory-check          # this folder's CLAUDE.md files and auto memory
npx claude-memory-check --all    # every project's MEMORY.md under ~/.claude/projects
```

## What it checks

- `MEMORY.md`: lines and size against the 200-line / 25KB cut, and which entries fall past it
- links in `MEMORY.md` to topic files that don't exist
- topic files no index line points to, which Claude won't find on its own
- topic files listed only past the cut
- `CLAUDE.md` files (global, project, `.claude/`, local): size, `@imports` that don't resolve, the total loaded every session, and files over the docs' ~200-line guidance

## Privacy

It only reads `~/.claude` memory files, `CLAUDE.md` files, and the files those `CLAUDE.md` files `@import` (size only, never printed), and prints a report to your terminal. It writes nothing, changes nothing and sends nothing anywhere: no network calls, no telemetry, no dependencies. The source is one file, `check.mjs`.

## Not handled

A moved `autoMemoryDirectory` (it says so instead), `CLAUDE_CONFIG_DIR` / `CLAUDE_CODE_PROJECT_DIR_NAME`, parent-directory `CLAUDE.md` files, and Windows paths. `@import` targets outside `~/.claude` are read for size only, never printed.

MIT licensed. Made by the people behind [Counterparts](https://counterparts.ai/?utm_source=memory-check), a memory for Claude Code with no index to trim.

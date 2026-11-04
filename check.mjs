#!/usr/bin/env node
// claude-memory-check: what Claude Code actually loads from your memory files at the start of a session, and what it
// silently leaves out. Read-only: it never writes, moves or sends anything.
//
//   npx claude-memory-check            this folder's CLAUDE.md files and its auto memory (MEMORY.md)
//   npx claude-memory-check --all      every project's MEMORY.md under ~/.claude/projects
//
// Rules it checks, from Claude Code's docs (code.claude.com/docs/en/memory, read 2026-11-03):
// - only the first 200 lines or 25KB of MEMORY.md, whichever comes first, load at session start; the rest is dropped
// - topic files in the memory folder are not loaded at startup; Claude opens them when the index points it there
// - CLAUDE.md files load whole (up to 4 MiB), with @imports added at load time; the guidance is under ~200 lines each
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LINES = 200, BYTES = 25 * 1024, CLAUDE_MD_LINES = 200;
const home = os.homedir();
const all = process.argv.includes("--all");
const warn = [], out = [];
const kb = (n) => `${(n / 1024).toFixed(1)}KB`;
const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };

// The project folder Claude Code uses for a working directory: every character that isn't a letter or digit becomes "-".
const projectDir = (cwd) => path.join(home, ".claude", "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"));

function checkMemory(dir, label) {
  const index = path.join(dir, "memory", "MEMORY.md");
  const text = read(index);
  if (text === null) return false;
  const lines = text.split("\n");
  const bytes = Buffer.byteLength(text);
  // Where loading stops: the 200th line, or the line that crosses 25KB, whichever comes first.
  let cut = lines.length, used = 0;
  for (let i = 0; i < lines.length; i++) {
    used += Buffer.byteLength(lines[i]) + 1;
    if (i >= LINES || used > BYTES) { cut = i; break; }
  }
  const dropped = lines.slice(cut).filter((l) => l.trim());
  out.push(`\n${label}: MEMORY.md is ${lines.length} lines, ${kb(bytes)}` +
    (dropped.length ? `; ${dropped.length} entries past line ${cut} never load at session start` : "; all of it loads"));
  if (dropped.length) {
    warn.push(`${label}: ${dropped.length} MEMORY.md entries are past the 200-line/25KB cut, so Claude never sees them at the start of a session`);
    out.push(...dropped.slice(0, 5).map((l) => `    not loaded: ${l.slice(0, 100)}`), dropped.length > 5 ? `    ...and ${dropped.length - 5} more` : "");
  } else if (lines.length > LINES * 0.8 || bytes > BYTES * 0.8) {
    warn.push(`${label}: MEMORY.md is over 80% of what loads (${lines.length}/${LINES} lines, ${kb(bytes)}/25KB)`);
  }
  // Links in the index to topic files that don't exist, and topic files the index never mentions (Claude won't find them).
  const memDir = path.join(dir, "memory");
  const linked = new Set([...text.matchAll(/\]\(([^)#\s]+\.md)\)/g)].map((m) => m[1]));
  const missing = [...linked].filter((f) => !fs.existsSync(path.join(memDir, f)));
  if (missing.length) warn.push(`${label}: MEMORY.md links ${missing.length} files that don't exist: ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? "..." : ""}`);
  const files = fs.readdirSync(memDir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md");
  const loaded = new Set(lines.slice(0, cut).join("\n").match(/[\w.-]+\.md/g) || []);
  const orphans = files.filter((f) => !text.includes(f));
  const hidden = files.filter((f) => text.includes(f) && !loaded.has(f));
  if (orphans.length) warn.push(`${label}: ${orphans.length} topic files aren't in MEMORY.md, so nothing points Claude to them: ${orphans.slice(0, 4).join(", ")}${orphans.length > 4 ? "..." : ""}`);
  if (hidden.length) warn.push(`${label}: ${hidden.length} topic files are only listed past the cut: ${hidden.slice(0, 4).join(", ")}${hidden.length > 4 ? "..." : ""}`);
  out.push(`    ${files.length} topic files (opened on demand, not at startup)`);
  return true;
}

function checkClaudeMd(file) {
  const text = read(file);
  if (text === null) return 0;
  const lines = text.split("\n").length, bytes = Buffer.byteLength(text);
  let total = bytes;
  const imports = [...text.matchAll(/(?:^|\s)@((?:~\/|\.{0,2}\/)?[\w./-]+)/gm)].map((m) => m[1]).filter((p) => /[./]/.test(p));
  for (const imp of imports) {
    const p = imp.startsWith("~/") ? path.join(home, imp.slice(2)) : path.resolve(path.dirname(file), imp);
    const t = read(p);
    if (t === null) warn.push(`${file}: imports @${imp}, which doesn't exist`);
    else total += Buffer.byteLength(t);
  }
  out.push(`${file.replace(home, "~")}: ${lines} lines, ${kb(bytes)}` + (imports.length ? `, ${imports.length} @imports (${kb(total)} with them)` : ""));
  if (lines > CLAUDE_MD_LINES) warn.push(`${file.replace(home, "~")}: ${lines} lines; the docs suggest under ~200 per file, since all of it loads every session`);
  return total;
}

const cwd = process.cwd();
out.push("What loads at the start of a Claude Code session here:");
let total = 0;
for (const f of [path.join(home, ".claude", "CLAUDE.md"), path.join(cwd, "CLAUDE.md"), path.join(cwd, ".claude", "CLAUDE.md"), path.join(cwd, "CLAUDE.local.md")])
  total += checkClaudeMd(f);
if (all) {
  const root = path.join(home, ".claude", "projects");
  const dirs = fs.existsSync(root) ? fs.readdirSync(root).map((d) => path.join(root, d)) : [];
  const found = dirs.filter((d) => checkMemory(d, path.basename(d)));
  if (!found.length) out.push("\nNo MEMORY.md under ~/.claude/projects (auto memory off, or moved with autoMemoryDirectory).");
} else if (!checkMemory(projectDir(cwd), "This folder's auto memory")) {
  out.push("\nNo auto memory for this folder yet (or it's moved with autoMemoryDirectory). Run with --all to check every project.");
}
out.push(`\nCLAUDE.md files and imports: ${kb(total)} of context every session.`);
console.log(out.filter((l) => l !== "").join("\n"));
console.log(warn.length ? `\n${warn.length} to look at:\n` + warn.map((w) => `- ${w}`).join("\n") : "\nNothing to fix.");
console.log("\nMade by the people behind Counterparts, a memory for Claude Code with no index to trim: npm install -g counterparts@latest (https://counterparts.ai/?utm_source=memory-check)");

#!/usr/bin/env node
// claude-memory-check: what Claude Code loads from your memory files at the start of a session, and what it leaves out.
// Read-only: it never writes, moves or sends anything.
//
//   npx claude-memory-check            this folder's CLAUDE.md files and its auto memory (MEMORY.md)
//   npx claude-memory-check --all      every project's MEMORY.md under ~/.claude/projects
//
// Rules it checks, from Claude Code's docs (code.claude.com/docs/en/memory and /errors, read 2026-11-17, rechecked 2026-11-25
// against Claude Code 2.1.332, whose limits are 200 lines and 25,000 bytes):
// - only the first 200 lines or 25KB of MEMORY.md, whichever comes first, load at session start; the rest is dropped.
//   YAML frontmatter and block-level HTML comments are stripped first and don't count.
// - topic files in the memory folder are not loaded at startup; Claude opens them when the index points it there
// - the memory folder is keyed on the git repository, so subdirectories and worktrees share one
// - CLAUDE.md and CLAUDE.local.md load whole (up to 4 MiB) from the working directory and every directory above it,
//   with @imports expanded (up to four hops); the guidance is under ~200 lines each
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LINES = 200, BYTES = 25000, CLAUDE_MD_LINES = 200, MAX_HOPS = 4, PROJECT_NAME_MAX = 200;
const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`claude-memory-check: what Claude Code loads from MEMORY.md and CLAUDE.md, and what it leaves out.

  npx claude-memory-check          this folder's CLAUDE.md files and auto memory
  npx claude-memory-check --all    every project's MEMORY.md under ~/.claude/projects

Read-only. Reads local files only; writes nothing, sends nothing.`);
  process.exit(0);
}
const all = args.includes("--all");
const home = os.homedir();
const warn = [], out = [];
const kb = (n) => `${(n / 1000).toFixed(1)}KB`;
const n_ = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };
const tilde = (p) => (p === home || p.startsWith(home + path.sep) ? "~" + p.slice(home.length) : p);
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// The repository root Claude Code keys auto memory on. In a worktree, .git is a file pointing into the main repo's
// .git/worktrees/<name>, so follow it back to the main repo. Outside a git repo, the folder itself.
function repoRoot(cwd) {
  for (let d = cwd; ; d = path.dirname(d)) {
    const g = path.join(d, ".git");
    if (isDir(g)) return d;
    const t = read(g);
    if (t !== null) {
      const m = t.match(/^gitdir:\s*(.+)$/m);
      if (m) {
        const gitdir = path.resolve(d, m[1].trim());
        const i = gitdir.lastIndexOf(`${path.sep}.git${path.sep}worktrees${path.sep}`);
        if (i !== -1) return gitdir.slice(0, i);
      }
      return d;
    }
    if (path.dirname(d) === d) return cwd;
  }
}

// The project folder name: every character that isn't a letter or digit becomes "-". Names over 200 characters
// are cut and given a hash suffix, which this matches by prefix.
function projectDir(root) {
  const projects = path.join(home, ".claude", "projects");
  const name = root.replace(/[^A-Za-z0-9]/g, "-");
  if (name.length <= PROJECT_NAME_MAX) return path.join(projects, name);
  const prefix = name.slice(0, PROJECT_NAME_MAX) + "-";
  const hit = (isDir(projects) ? fs.readdirSync(projects) : []).find((d) => d.startsWith(prefix));
  return path.join(projects, hit || prefix);
}

// Block-level HTML comments, which Claude Code strips before loading (outside fenced code blocks).
function stripComments(text) {
  return text.split(/(^(?:```|~~~)[\s\S]*?^(?:```|~~~).*$)/m).map((part, i) =>
    i % 2 ? part : part.replace(/^[ \t]*<!--(?:(?!-->)[\s\S])*?-->[ \t]*\r?\n?/gm, "")).join("");
}

// What counts toward the limits: the index without YAML frontmatter or block-level HTML comments, trimmed.
function loadedText(text) {
  let t = text.replace(/^﻿/, "");
  t = t.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, "");
  t = stripComments(t);
  return t.replace(/\r\n?/g, "\n").trim();
}

function checkMemory(dir, label) {
  const memDir = path.join(dir, "memory");
  const text = read(path.join(memDir, "MEMORY.md"));
  if (text === null) return false;
  const loaded = loadedText(text);
  const lines = loaded === "" ? [] : loaded.split("\n");
  const bytes = Buffer.byteLength(loaded);
  // Where loading stops: after line 200, or at the line that crosses 25KB, whichever comes first.
  let cut = lines.length, used = 0;
  for (let i = 0; i < lines.length; i++) {
    used += Buffer.byteLength(lines[i]) + (i ? 1 : 0);
    if (i >= LINES || used > BYTES) { cut = i; break; }
  }
  const dropped = lines.slice(cut).filter((l) => l.trim());
  out.push(`\n${label}: MEMORY.md is ${n_(lines.length, "line", "lines")}, ${kb(bytes)}` +
    (dropped.length ? `; ${dropped.length} entries after the first ${cut} loaded lines don't load at session start` : "; all of it loads"));
  if (dropped.length) {
    warn.push(`${label}: ${n_(dropped.length, "MEMORY.md entry is", "MEMORY.md entries are")} past the 200-line/25KB cut, so Claude doesn't see them at the start of a session`);
    out.push(...dropped.slice(0, 5).map((l) => `    not loaded: ${l.slice(0, 100)}`));
    if (dropped.length > 5) out.push(`    ...and ${dropped.length - 5} more`);
  } else if (lines.length > LINES * 0.8 || bytes > BYTES * 0.8) {
    warn.push(`${label}: MEMORY.md is over 80% of what loads (${lines.length}/${LINES} lines, ${kb(bytes)}/25KB)`);
  }
  // Links in the index to topic files that don't exist, and topic files the index never mentions (Claude won't find them).
  const linked = new Set([...text.matchAll(/\]\(([^)#\s]+\.md)\)/g)].map((m) => m[1]).filter((f) => !/^[a-z][\w+.-]*:/i.test(f)));
  const missing = [...linked].filter((f) => !fs.existsSync(path.join(memDir, f)));
  if (missing.length) warn.push(`${label}: MEMORY.md links ${n_(missing.length, "file that doesn't", "files that don't")} exist: ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? "..." : ""}`);
  const files = fs.readdirSync(memDir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md");
  const before = lines.slice(0, cut).join("\n");
  const names = (t) => new Set(t.match(/[\w.-]+\.md/g) || []);
  const inText = names(text), inBefore = names(before);
  const orphans = files.filter((f) => !inText.has(f));
  const hidden = files.filter((f) => inText.has(f) && !inBefore.has(f));
  if (orphans.length) warn.push(`${label}: ${n_(orphans.length, "topic file isn't", "topic files aren't")} in MEMORY.md, so nothing points Claude to ${orphans.length === 1 ? "it" : "them"}: ${orphans.slice(0, 4).join(", ")}${orphans.length > 4 ? "..." : ""}`);
  if (hidden.length) warn.push(`${label}: ${n_(hidden.length, "topic file is", "topic files are")} only listed past the cut: ${hidden.slice(0, 4).join(", ")}${hidden.length > 4 ? "..." : ""}`);
  out.push(`    ${files.length} topic files (opened on demand, not at startup)`);
  return true;
}

// @imports: @path tokens outside fenced code blocks and code spans. A token with a slash (or starting ~/ ./ ../ /)
// is an import; a bare name like @AGENTS.md or @README counts only if that file exists next to the importer,
// so @mentions and @scope/pkg names in prose don't raise false "missing" warnings.
function importsOf(text, file) {
  const prose = text.replace(/^(```|~~~)[\s\S]*?^\1.*$/gm, "").replace(/`[^`\n]*`/g, "");
  const found = [];
  for (const m of prose.matchAll(/(?:^|\s)@((?:\\ |[^\s`"'()<>\[\]])+)/gm)) {
    const raw = m[1].replace(/[.,;:!?]+$/, "").replace(/\\ /g, " ");
    if (!raw || raw.startsWith("@")) continue;
    const explicit = /^(~\/|\.{1,2}\/|\/)/.test(raw);
    const slashed = raw.includes("/");
    const p = raw.startsWith("~/") ? path.join(home, raw.slice(2)) : path.resolve(path.dirname(file), raw);
    const isFile = (() => { try { return fs.statSync(p).isFile(); } catch { return false; } })();
    if (isDir(p)) continue;
    if (explicit) found.push({ raw, p });
    else if (slashed) { if (/\.\w+$/.test(raw) || isFile) found.push({ raw, p }); }
    else if (isFile) found.push({ raw, p });
  }
  return found;
}

const seen = new Set();
// Bytes an import adds, following nested imports up to four hops; each file counted once.
function importBytes(file, text, hop) {
  let total = 0, count = 0;
  for (const { raw, p } of importsOf(text, file)) {
    count++;
    const t = read(p);
    if (t === null) { warn.push(`${tilde(file)}: imports @${raw}, which doesn't exist`); continue; }
    if (seen.has(p)) continue;
    seen.add(p);
    total += Buffer.byteLength(stripComments(t));
    if (hop < MAX_HOPS) total += importBytes(p, t, hop + 1).total;
  }
  return { total, count };
}

function checkClaudeMd(file) {
  if (seen.has(file)) return 0;
  const text = read(file);
  if (text === null) return 0;
  seen.add(file);
  const lineArr = text.split("\n");
  if (lineArr.length > 1 && lineArr[lineArr.length - 1] === "") lineArr.pop();
  const lines = lineArr.length, bytes = Buffer.byteLength(stripComments(text));
  const imp = importBytes(file, text, 1);
  const total = bytes + imp.total;
  out.push(`${tilde(file)}: ${n_(lines, "line", "lines")}, ${kb(bytes)}` + (imp.count ? `, ${imp.count} @imports (${kb(total)} with them)` : ""));
  if (lines > CLAUDE_MD_LINES) warn.push(`${tilde(file)}: ${lines} lines; the docs suggest under ~200 per file, since all of it loads every session`);
  if (bytes > 4 * 1024 * 1024) warn.push(`${tilde(file)}: over 4 MiB, so Claude Code skips it entirely`);
  return total;
}

const cwd = process.cwd();
out.push("What loads at the start of a Claude Code session here:");
let total = 0;
// User CLAUDE.md, then every directory from the filesystem root down to here.
const dirs = [];
for (let d = cwd; ; d = path.dirname(d)) { dirs.unshift(d); if (path.dirname(d) === d) break; }
const claudeMds = [path.join(home, ".claude", "CLAUDE.md")];
for (const d of dirs) claudeMds.push(path.join(d, "CLAUDE.md"), path.join(d, ".claude", "CLAUDE.md"), path.join(d, "CLAUDE.local.md"));
for (const f of claudeMds) total += checkClaudeMd(f);
if (all) {
  const root = path.join(home, ".claude", "projects");
  const projects = isDir(root) ? fs.readdirSync(root).map((d) => path.join(root, d)) : [];
  const found = projects.filter((d) => checkMemory(d, path.basename(d)));
  if (!found.length) out.push("\nNo MEMORY.md under ~/.claude/projects (auto memory off, or moved with autoMemoryDirectory).");
} else if (!checkMemory(projectDir(repoRoot(cwd)), "This folder's auto memory")) {
  out.push("\nNo auto memory for this folder yet (or it's moved with autoMemoryDirectory). Run with --all to check every project.");
}
out.push(`\nCLAUDE.md files and imports: ${kb(total)} of context every session.`);
console.log(out.join("\n"));
console.log(warn.length ? `\n${warn.length} to look at:\n` + warn.map((w) => `- ${w}`).join("\n") : "\nNothing to fix.");
console.log("\nMore on how Claude Code memory loads, from the people behind Counterparts: https://counterparts.ai/guides/claude-code-memory/?utm_source=memory-check");

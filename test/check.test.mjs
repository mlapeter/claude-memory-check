// Runs check.mjs against throwaway home folders. No dependencies: `npm test` (node --test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "check.mjs");

// A fake home with a git repo at ~/proj and its memory folder. Returns paths and a runner.
function setup() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmc-")));
  const proj = path.join(home, "proj");
  fs.mkdirSync(path.join(proj, ".git"), { recursive: true });
  const mem = path.join(home, ".claude", "projects", proj.replace(/[^A-Za-z0-9]/g, "-"), "memory");
  fs.mkdirSync(mem, { recursive: true });
  const run = (cwd = proj, ...args) =>
    execFileSync(process.execPath, [script, ...args], { cwd, env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: "utf8" });
  return { home, proj, mem, run };
}
const index = (n, f = (i) => `- [Note ${i}](note-${i}.md) — line ${i}`) => Array.from({ length: n }, (_, i) => f(i + 1)).join("\n") + "\n";

test("261-line index: 61 entries past line 200", () => {
  const { mem, run } = setup();
  fs.writeFileSync(path.join(mem, "MEMORY.md"), index(261, (i) => `- note ${i}`));
  const o = run();
  assert.match(o, /MEMORY\.md is 261 lines/);
  assert.match(o, /61 entries after the first 200 loaded lines don't load/);
  assert.match(o, /not loaded: - note 201/);
});

test("exactly 200 lines with a trailing newline: all of it loads", () => {
  const { mem, run } = setup();
  fs.writeFileSync(path.join(mem, "MEMORY.md"), index(200, (i) => `- note ${i}`));
  const o = run();
  assert.match(o, /200 lines.*all of it loads/);
});

test("byte cut comes before the line cut", () => {
  const { mem, run } = setup();
  fs.writeFileSync(path.join(mem, "MEMORY.md"), index(100, (i) => `- ${String(i).padStart(3, "0")} ` + "x".repeat(495)));
  const o = run();
  // 501 bytes a line plus newline: line 50 ends at 25,099 bytes, so it and the 50 after it are past the cut.
  assert.match(o, /51 entries after the first 49 loaded lines don't load/);
});

test("frontmatter and block HTML comments don't count", () => {
  const { mem, run } = setup();
  const pad = Array.from({ length: 30 }, (_, i) => `meta${i}: x`).join("\n");
  fs.writeFileSync(path.join(mem, "MEMORY.md"), `---\n${pad}\n---\n<!--\n${pad}\n-->\n` + index(190, (i) => `- note ${i}`));
  assert.match(run(), /190 lines.*all of it loads/);
});

test("missing link, orphan topic file, file listed only past the cut", () => {
  const { mem, run } = setup();
  const lines = index(205, (i) => (i === 3 ? "- [Gone](gone.md)" : i === 204 ? "- [Late](late.md)" : `- note ${i}`));
  fs.writeFileSync(path.join(mem, "MEMORY.md"), lines);
  fs.writeFileSync(path.join(mem, "late.md"), "x");
  fs.writeFileSync(path.join(mem, "orphan.md"), "x");
  const o = run();
  assert.match(o, /links 1 file that doesn't exist: gone\.md/);
  assert.match(o, /1 topic file isn't in MEMORY\.md.*orphan\.md/);
  assert.match(o, /1 topic file is only listed past the cut: late\.md/);
});

test("run from a subdirectory finds the repo's memory", () => {
  const { proj, mem, run } = setup();
  fs.writeFileSync(path.join(mem, "MEMORY.md"), "- one\n");
  const sub = path.join(proj, "a", "b");
  fs.mkdirSync(sub, { recursive: true });
  assert.match(run(sub), /This folder's auto memory: MEMORY\.md is 1 line,/);
});

test("run from a git worktree finds the main repo's memory", () => {
  const { home, proj, mem, run } = setup();
  fs.writeFileSync(path.join(mem, "MEMORY.md"), "- one\n");
  const wt = path.join(home, "wt");
  fs.mkdirSync(wt);
  fs.mkdirSync(path.join(proj, ".git", "worktrees", "wt"), { recursive: true });
  fs.writeFileSync(path.join(wt, ".git"), `gitdir: ${path.join(proj, ".git", "worktrees", "wt")}\n`);
  assert.match(run(wt), /This folder's auto memory: MEMORY\.md is 1 line,/);
});

test("imports: bare names, nested, fenced ignored, missing flagged, @mentions ignored", () => {
  const { proj, run } = setup();
  fs.writeFileSync(path.join(proj, "AGENTS.md"), "agents\n@docs/deep.md\n");
  fs.mkdirSync(path.join(proj, "docs"));
  fs.writeFileSync(path.join(proj, "docs", "deep.md"), "deep\n");
  fs.writeFileSync(path.join(proj, "README"), "readme\n");
  fs.writeFileSync(path.join(proj, "CLAUDE.md"), [
    "See @AGENTS.md and @README.",
    "Ask @someone or @types/node about it.",
    "```", "@fenced/missing.md", "```",
    "Inline `@also/missing.md` is literal.",
    "@./nope.md",
  ].join("\n") + "\n");
  const o = run();
  assert.match(o, /CLAUDE\.md: 7 lines, .*, 3 @imports/);
  assert.match(o, /imports @\.\/nope\.md, which doesn't exist/);
  assert.doesNotMatch(o, /fenced|also\/missing|someone|types\/node/);
});

test("parent-directory CLAUDE.md files are counted, and long ones flagged", () => {
  const { home, proj, run } = setup();
  fs.writeFileSync(path.join(home, "CLAUDE.md"), "x\n".repeat(250));
  const o = run(proj);
  assert.match(o, /~\/CLAUDE\.md: 250 lines/);
  assert.match(o, /250 lines; the docs suggest under ~200/);
});

test("--all lists every project; no memory says so", () => {
  const { mem, run } = setup();
  assert.match(run(), /No auto memory for this folder yet/);
  fs.writeFileSync(path.join(mem, "MEMORY.md"), "- one\n");
  assert.match(run(undefined, "--all"), /-proj: MEMORY\.md is 1 line,/);
});

test("a comment line with trailing text doesn't swallow the lines after it", () => {
  const { mem, run } = setup();
  const body = ["<!-- c1 --> trailing text", ...Array.from({ length: 10 }, (_, i) => `- note ${i}`), "<!--", "block", "-->", "- last"].join("\n") + "\n";
  fs.writeFileSync(path.join(mem, "MEMORY.md"), body);
  assert.match(run(), /MEMORY\.md is 12 lines/);
});

test("blank lines count toward the 200", () => {
  const { mem, run } = setup();
  fs.writeFileSync(path.join(mem, "MEMORY.md"), index(150, (i) => `- note ${i}\n\n`));
  assert.match(run(), /entries after the first 200 loaded lines/);
});

test("whole-name matching, URL links, directory imports", () => {
  const { proj, mem, run } = setup();
  fs.writeFileSync(path.join(mem, "MEMORY.md"), "- [d](data.md)\n- [web](https://example.com/README.md)\n");
  fs.writeFileSync(path.join(mem, "data.md"), "x");
  fs.writeFileSync(path.join(mem, "a.md"), "x");
  fs.mkdirSync(path.join(proj, "docs"));
  fs.writeFileSync(path.join(proj, "CLAUDE.md"), "See @docs/ for more.\n");
  const o = run();
  assert.match(o, /1 topic file isn't in MEMORY\.md.*a\.md/);
  assert.doesNotMatch(o, /example\.com|docs\/, which/);
});

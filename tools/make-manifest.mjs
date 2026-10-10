#!/usr/bin/env node
// dsh-find-file — tools/make-manifest.mjs
//
// Regenerates MANIFEST.txt: a reviewer-facing inventory of every tracked
// file with its size and sha256, plus the exact commands a reviewer can run
// to reproduce the test results. Zero dependencies; hashes via node:crypto.
//
//   node tools/make-manifest.mjs [--tests "<name> <pass>/<fail> ..."]
//
// MANIFEST.txt itself is EXCLUDED from the table on purpose: a file cannot
// contain its own hash, and listing a stale self-entry (as some tools do) is
// exactly the kind of quiet dishonesty this repo exists to avoid.

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "MANIFEST.txt");
const EXCLUDED = new Set(["MANIFEST.txt", "package-lock.json"]);
const EXCLUDED_DIRS = new Set([".git", "node_modules", "tmp", "coverage"]);

async function collectFiles(dir, base = "") {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (EXCLUDED.has(entry.name)) continue;
    const rel = base === "" ? entry.name : `${base}/${entry.name}`;
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      files.push(...(await collectFiles(path.join(dir, entry.name), rel)));
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
  return files;
}

const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
const files = await collectFiles(ROOT);

let commit = "uncommitted";
try {
  commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
} catch {
  // no git repo (e.g. fresh clone not yet committed) — say so, don't fake it
}

let totalBytes = 0;
const rows = [];
for (const rel of files) {
  const buf = await readFile(path.join(ROOT, rel));
  totalBytes += buf.length;
  rows.push({ rel, size: buf.length, sha256: createHash("sha256").update(buf).digest("hex") });
}

const testArg = process.argv.indexOf("--tests");
const testLines = testArg !== -1 ? process.argv.slice(testArg + 1).join(" ").split(";").map((s) => s.trim()).filter(Boolean) : [];

const lines = [];
lines.push(`${pkg.name} — release manifest`);
lines.push(`version: ${pkg.version}`);
lines.push(`commit:  ${commit}`);
lines.push(`files:   ${rows.length}`);
lines.push(`bytes:   ${totalBytes}`);
lines.push(`generated: ${new Date().toISOString()}`);
lines.push("");
lines.push("Reviewer commands:");
lines.push("  node --test test/match.test.mjs test/walk.test.mjs test/tool.test.mjs test/cli.test.mjs");
lines.push("  npm run check");
if (testLines.length > 0) {
  lines.push("");
  lines.push(`test suites (node ${process.version}):`);
  for (const line of testLines) lines.push(`  ${line}`);
}
lines.push("");
lines.push("sha256                                                            size  path");
for (const row of rows) {
  lines.push(`${row.sha256}  ${String(row.size).padStart(6)}  ${row.rel}`);
}

const body = `${lines.join("\n")}\n`;
await writeFile(OUTPUT, body, "utf8");
console.log(`MANIFEST.txt written: ${rows.length} files, ${totalBytes} bytes, commit ${commit}`);

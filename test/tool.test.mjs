// dsh-find-file — test/tool.test.mjs
// Tool-descriptor tests: schema conformance of REAL executions, argument
// discipline, and the render verdicts. defineTool is a passthrough stub so
// these run with zero SDK presence.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildToolDefinition, renderResult, OUTPUT_SCHEMA } from "../lib/tool.js";
import { resolveSettings } from "../lib/config.js";
import { validateSchema } from "./helpers/validate-schema.mjs";

const passthrough = (definition) => definition;

function makeTmpTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-find-file-test-"));
  fs.mkdirSync(path.join(root, "sub"));
  fs.writeFileSync(path.join(root, "top.txt"), "x");
  fs.writeFileSync(path.join(root, "sub", "nested.log"), "x");
  return root;
}

// Await fn() BEFORE the finally cleanup runs — deleting the tree while the
// walk is in flight would race it into a spurious skip (a lesson the first
// run taught us: the failure mode was "0 matches, incomplete", not a throw).
async function withTree(root, fn) {
  try {
    return await fn();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("descriptor shape: name, args, description guidance", () => {
  const def = buildToolDefinition({ defineTool: passthrough, settings: resolveSettings({}) });
  assert.equal(def.name, "find_file");
  assert.deepEqual(Object.keys(def.parameters).sort(), [
    "includeDirs",
    "maxDepth",
    "maxResults",
    "pattern",
    "root",
    "timeBudgetMs",
  ]);
  assert.match(def.description, /complete/);
  assert.match(def.description, /never conclude|Never conclude/i);
});

test("execute on a real tree returns a schema-valid complete result", async () => {
  const root = makeTmpTree();
  await withTree(root, async () => {
    const def = buildToolDefinition({ defineTool: passthrough, settings: resolveSettings({}) });
    const value = await def.execute({ root, pattern: "*.txt" });
    const errors = validateSchema(value, OUTPUT_SCHEMA);
    assert.deepEqual(errors, []);
    assert.equal(value.matchedCount, 1);
    assert.ok(value.matches[0].endsWith("top.txt"));
    assert.equal(value.complete, true);
    assert.equal(value.limits.maxResults, 50);
  });
});

test("entry settings clamp and flow through execute", async () => {
  const root = makeTmpTree();
  await withTree(root, async () => {
    const def = buildToolDefinition({
      defineTool: passthrough,
      settings: resolveSettings({ maxResults: 1, includeDirs: false }),
    });
    fs.writeFileSync(path.join(root, "a.txt"), "x");
    fs.writeFileSync(path.join(root, "b.txt"), "x");
    const value = await def.execute({ root, pattern: "*.txt" });
    assert.equal(value.matchedCount, 1);
    assert.equal(value.incompleteReason, "result-limit");
    // per-call override wins over entry config; tree has top.txt + a.txt + b.txt
    const wide = await def.execute({ root, pattern: "*.txt", maxResults: 10 });
    assert.equal(wide.matchedCount, 3);
    assert.equal(wide.complete, true);
  });
});

test("missing required arguments reject with teaching messages", async () => {
  const def = buildToolDefinition({ defineTool: passthrough, settings: resolveSettings({}) });
  await assert.rejects(() => def.execute({ pattern: "x" }), /"root" is required/);
  await assert.rejects(() => def.execute({ root: "C:\\" }), /"pattern" is required/);
  await assert.rejects(() => def.execute({ root: "C:\\", pattern: "x", bogusArg: 1 }), /unknown argument/);
});

test("root that does not exist rejects with a clear error", async () => {
  const def = buildToolDefinition({ defineTool: passthrough, settings: resolveSettings({}) });
  await assert.rejects(() => def.execute({ root: path.join(os.tmpdir(), "dsh-find-file-nope-xyz"), pattern: "x" }), /root/);
});

test("render: verdicts are explicit in all three regimes", () => {
  const completeEmpty = {
    root: "R", pattern: "x", matches: [], matchedCount: 0, dirsWalked: 3, symlinkSkipped: 0,
    skippedCount: 0, skipped: [], complete: true, elapsedMs: 5,
    limits: { maxResults: 50, timeBudgetMs: 90000, maxDepth: 64, includeDirs: false, caseInsensitive: true },
  };
  assert.match(renderResult(completeEmpty), /does not exist under this root/);

  const incomplete = {
    ...completeEmpty,
    matches: ["R/a.txt"], matchedCount: 1, complete: false, incompleteReason: "permission-denied",
    skippedCount: 1, skipped: [{ path: "R/locked", code: "EPERM" }],
  };
  const rendered = renderResult(incomplete);
  assert.match(rendered, /INCOMPLETE \(permission-denied\)/);
  assert.match(rendered, /NOT proof of absence/);
  assert.match(rendered, /R\/locked \(EPERM\)/);

  const completeHit = { ...completeEmpty, matches: ["R/a.txt"], matchedCount: 1 };
  assert.match(renderResult(completeHit), /every listed match exists/);
});

test("render caps long match lists but keeps the count", () => {
  const many = {
    root: "R", pattern: "x", matches: Array.from({ length: 30 }, (_, i) => `R/f${i}.txt`), matchedCount: 30,
    dirsWalked: 1, symlinkSkipped: 0, skippedCount: 0, skipped: [], complete: true, elapsedMs: 5,
    limits: { maxResults: 50, timeBudgetMs: 90000, maxDepth: 64, includeDirs: false, caseInsensitive: true },
  };
  const rendered = renderResult(many);
  assert.match(rendered, /… 10 more/);
  assert.equal(rendered.split("\n").filter((line) => line.trim().startsWith("R/")).length, 20);
});

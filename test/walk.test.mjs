// dsh-find-file — test/walk.test.mjs
// Engine tests against the injectable fake filesystem. These pin the exact
// contract the whole plugin exists for: partial failure is reported, never
// disguised, and only a complete empty walk licenses "does not exist".
import test from "node:test";
import assert from "node:assert/strict";
import { findFiles } from "../lib/walk.js";
import { makeFakeFs, FAKE_ROOT } from "./helpers/fake-fs.mjs";

const SIMPLE_TREE = {
  bin: { "run.exe": "x" },
  docs: { "readme.md": "x", deep: { "spec.pdf": "x" } },
  "root.txt": "x",
};

test("clean tree: files found, complete=true", async () => {
  const { deps } = makeFakeFs(SIMPLE_TREE);
  const r = await findFiles({ root: FAKE_ROOT, pattern: "*.txt" }, deps);
  assert.equal(r.matchedCount, 1);
  assert.ok(r.matches[0].endsWith("root.txt"));
  assert.equal(r.complete, true);
  assert.equal(r.incompleteReason, undefined);
  assert.equal(r.skippedCount, 0);
});

test("THE guarantee: clean walk with zero matches means the file does not exist", async () => {
  const { deps } = makeFakeFs(SIMPLE_TREE);
  const r = await findFiles({ root: FAKE_ROOT, pattern: "nope-*.xyz" }, deps);
  assert.deepEqual(r.matches, []);
  assert.equal(r.complete, true);
  // root + bin + docs + docs/deep
  assert.equal(r.dirsWalked, 4);
});

test("permission wall: skipped, reported, complete=false, siblings still searched", async () => {
  const tree = { ...SIMPLE_TREE, locked: { "hidden.exe": "x" } };
  const { deps } = makeFakeFs(tree, { fail: { "/locked": "EPERM" } });
  const r = await findFiles({ root: FAKE_ROOT, pattern: "*.exe" }, deps);
  assert.equal(r.matchedCount, 1); // bin/run.exe still found
  assert.equal(r.skippedCount, 1);
  assert.equal(r.skipped[0].code, "EPERM");
  assert.ok(r.skipped[0].path.endsWith("locked"));
  assert.equal(r.complete, false);
  assert.equal(r.incompleteReason, "permission-denied");
});

test("skip sample is capped but the count keeps rising", async () => {
  const tree = { "a.txt": "x" };
  const fail = {};
  for (let i = 0; i < 40; i++) fail[`/wall${i}`] = "EACCES";
  const spec = { ...tree, ...Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`wall${i}`, {}])) };
  const { deps } = makeFakeFs(spec, { fail });
  const r = await findFiles({ root: FAKE_ROOT, pattern: "a.txt" }, deps);
  assert.equal(r.skippedCount, 40);
  assert.equal(r.skipped.length, 30);
});

test("time budget: fake clock overrun → time-budget, complete=false", async () => {
  const { deps, clock } = makeFakeFs(SIMPLE_TREE);
  const slowDeps = {
    ...deps,
    readdir: async (dir) => {
      clock.advance(100);
      return deps.readdir(dir);
    },
  };
  const r = await findFiles({ root: FAKE_ROOT, pattern: "*.txt", timeBudgetMs: 250 }, slowDeps);
  assert.equal(r.complete, false);
  assert.equal(r.incompleteReason, "time-budget");
});

test("result cap: matchedCount stops at cap, reason result-limit", async () => {
  const { deps } = makeFakeFs({ a: { "1.txt": "x", "2.txt": "x", "3.txt": "x" } });
  const r = await findFiles({ root: FAKE_ROOT, pattern: "*.txt", maxResults: 2 }, deps);
  assert.equal(r.matchedCount, 2);
  assert.equal(r.incompleteReason, "result-limit");
  assert.equal(r.complete, false);
});

test("exact cap: exactly maxResults matches in the tree stays complete", async () => {
  const { deps } = makeFakeFs({ a: { "1.txt": "x", "2.txt": "x", "3.txt": "x" } });
  const r = await findFiles({ root: FAKE_ROOT, pattern: "*.txt", maxResults: 3 }, deps);
  assert.equal(r.matchedCount, 3);
  assert.equal(r.complete, true);
});

test("depth limit: deeper levels not walked, reason depth-limit", async () => {
  const { deps } = makeFakeFs({ a: { b: { "deep.txt": "x" }, "shallow.txt": "x" } });
  const r = await findFiles({ root: FAKE_ROOT, pattern: "*.txt", maxDepth: 1 }, deps);
  assert.deepEqual(r.matches.filter((m) => m.includes("shallow")).length, 1);
  assert.deepEqual(r.matches.filter((m) => m.includes("deep.txt")).length, 0);
  assert.equal(r.incompleteReason, "depth-limit");
});

test("includeDirs matches directory names too, and still descends", async () => {
  const { deps } = makeFakeFs({ photos: { "2024.jpg": "x" } });
  const r = await findFiles({ root: FAKE_ROOT, pattern: "photos", includeDirs: true }, deps);
  assert.equal(r.matchedCount, 1);
  assert.ok(r.matches[0].endsWith("photos"));
  const r2 = await findFiles({ root: FAKE_ROOT, pattern: "2024.jpg" }, deps);
  assert.equal(r2.matchedCount, 1);
});

test("symlinks are never followed, counted, and do not spoil completeness", async () => {
  const { deps } = makeFakeFs({
    real: { "target.txt": "x" },
    link: { $symlink: true },
    "top.txt": "x",
  });
  const r = await findFiles({ root: FAKE_ROOT, pattern: "*.txt" }, deps);
  assert.equal(r.symlinkSkipped, 1);
  assert.equal(r.complete, true);
  assert.ok(r.matches.every((m) => !m.includes("link")));
});

test("root as a single file: it is its own candidate", async () => {
  const { deps } = makeFakeFs({ "lonely.txt": "x" });
  const r = await findFiles({ root: `${FAKE_ROOT}/lonely.txt`, pattern: "lonely.txt" }, deps);
  assert.equal(r.matchedCount, 1);
  assert.equal(r.complete, true);
  const r2 = await findFiles({ root: `${FAKE_ROOT}/lonely.txt`, pattern: "other.txt" }, deps);
  assert.deepEqual(r2.matches, []);
  assert.equal(r2.complete, true);
});

test("root missing: throws with the errno code attached", async () => {
  const { deps } = makeFakeFs({});
  await assert.rejects(
    () => findFiles({ root: `${FAKE_ROOT}/ghost`, pattern: "x" }, deps),
    (error) => error.code === "ENOENT" && /root is not accessible/.test(error.message),
  );
});

test("case sensitivity follows the option, not the tree", async () => {
  const { deps } = makeFakeFs({ "Readme.MD": "x" });
  const sensitive = await findFiles({ root: FAKE_ROOT, pattern: "readme.md", caseInsensitive: false }, deps);
  assert.equal(sensitive.matchedCount, 0);
  const loose = await findFiles({ root: FAKE_ROOT, pattern: "readme.md", caseInsensitive: true }, deps);
  assert.equal(loose.matchedCount, 1);
});

test("limits echo back in the result", async () => {
  const { deps } = makeFakeFs(SIMPLE_TREE);
  const r = await findFiles(
    { root: FAKE_ROOT, pattern: "x", maxResults: 7, timeBudgetMs: 2000, maxDepth: 3, includeDirs: true, caseInsensitive: true },
    deps,
  );
  assert.deepEqual(r.limits, { maxResults: 7, timeBudgetMs: 2000, maxDepth: 3, includeDirs: true, caseInsensitive: true });
});

test("invalid options are TypeErrors", async () => {
  const { deps } = makeFakeFs({});
  await assert.rejects(() => findFiles({ pattern: "x" }, deps), TypeError); // no root
  await assert.rejects(() => findFiles({ root: FAKE_ROOT }, deps), TypeError); // no pattern
  await assert.rejects(() => findFiles({ root: FAKE_ROOT, pattern: "a/b" }, deps), TypeError); // separator
  await assert.rejects(() => findFiles({ root: FAKE_ROOT, pattern: "x", maxResults: "many" }, deps), TypeError);
});

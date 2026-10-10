// dsh-find-file — lib/walk.js
//
// The engine. Contract in one sentence: walk the tree below `root`, collect
// basename matches, and never lie — any directory we could not read, any
// limit that cut the walk short, is recorded and flips `complete` to false.
//
// Why this exists: the built-in glob tool discards its ENTIRE result when
// ripgrep exits non-zero (e.g. EPERM on `C:\Program Files\WindowsApps`), so a
// wide Windows search reports failure/absence even though matches were found.
// Here, partial failure is a first-class outcome, not an error.
//
// The engine takes its filesystem and clock through the `deps` parameter so
// tests can inject an in-memory tree, forced EPERM errors and a fake clock
// without touching the real disk (see test/walk.test.mjs).

import { promises as fsp } from "node:fs";
import path from "node:path";
import { compilePattern } from "./match.js";
import { defaultCaseInsensitive } from "./config.js";

/** Cap on how many skipped directories are echoed back verbatim; the rest
 * are still counted in `skippedCount`. Keeps a pathological tree from
 * producing an unbounded result. */
export const SKIPPED_SAMPLE_MAX = 30;

/** Interval (entries) between time-budget checks inside one directory.
 * One readdir can yield tens of thousands of entries; checking every entry
 * is needless, checking never would let one huge directory exceed the
 * budget. */
const TIME_CHECK_INTERVAL = 512;

/** Real filesystem + clock. Tests replace this object. */
export const defaultDeps = {
  readdir: (dir) => fsp.readdir(dir, { withFileTypes: true }),
  stat: (p) => fsp.stat(p),
  now: () => Date.now(),
};

function errorCode(error) {
  if (error && typeof error.code === "string") return error.code;
  return "UNKNOWN";
}

/**
 * Walk the tree below `root` and collect matches.
 *
 * @param {object} options
 * @param {string} options.root directory (or single file) to search from;
 *   relative paths are resolved against the current working directory
 * @param {string} options.pattern basename pattern, `*` and `?` wildcards
 * @param {number} [options.maxResults=50] stop after this many matches
 * @param {number} [options.timeBudgetMs=90_000] wall-clock budget
 * @param {number} [options.maxDepth=64] directory levels below root to walk
 * @param {boolean} [options.includeDirs=false] also match directory names
 * @param {boolean} [options.caseInsensitive] defaults to true on win32/darwin
 * @param {{readdir?:Function, stat?:Function, now?:Function}} [deps]
 *   injectable seams for tests
 * @returns {Promise<object>} result object; see README "Result contract".
 *   `complete: true` means every directory below root was read (symlinked
 *   directories are a documented exception: never followed, counted in
 *   `symlinkSkipped`). Only `complete: true` with zero matches licenses the
 *   conclusion "the file does not exist".
 * @throws {TypeError} on invalid arguments
 * @throws {Error & {code?:string}} when the root cannot be accessed
 */
export async function findFiles(options, deps = defaultDeps) {
  const { root, pattern, maxResults, timeBudgetMs, maxDepth, includeDirs, caseInsensitive } = requireOptions(options);
  const matcher = compilePattern(pattern, { caseInsensitive });
  const rootPath = path.resolve(root);
  const startedAt = deps.now();

  // Root validation: a missing or unusable root is an input error, not a
  // "partial search" — fail loudly with the reason attached as `code`.
  const rootStat = await deps.stat(rootPath).catch((error) => {
    const wrapped = new Error(`dsh-find-file: root is not accessible: ${rootPath} (${errorCode(error)})`);
    wrapped.code = errorCode(error);
    throw wrapped;
  });

  const matches = [];
  const skipped = [];
  let skippedCount = 0;
  let dirsWalked = 0;
  let symlinkSkipped = 0;
  let timeBudgetHit = false;
  let resultCapHit = false;
  let depthLimitHit = false;

  if (rootStat.isFile()) {
    // A file root is its own single candidate — convenient for CLI checks.
    if (matcher.test(path.basename(rootPath))) matches.push(rootPath);
    return assemble();
  }
  if (!rootStat.isDirectory()) {
    const wrapped = new Error(`dsh-find-file: root is neither a directory nor a file: ${rootPath}`);
    wrapped.code = "ENOTDIR";
    throw wrapped;
  }

  // Iterative stack (no recursion): tree depth is bounded by maxDepth, the
  // call stack is bounded by nothing but the loop.
  const stack = [{ dir: rootPath, depth: 0 }];
  let seenEntries = 0;

  walk: while (stack.length > 0) {
    if (deps.now() - startedAt >= timeBudgetMs) {
      timeBudgetHit = true;
      break;
    }
    const { dir, depth } = stack.pop();

    let entries;
    try {
      entries = await deps.readdir(dir);
    } catch (error) {
      const code = errorCode(error);
      skippedCount += 1;
      if (skipped.length < SKIPPED_SAMPLE_MAX) {
        skipped.push({ path: dir, code });
      }
      continue;
    }
    dirsWalked += 1;

    for (const entry of entries) {
      if (++seenEntries % TIME_CHECK_INTERVAL === 0 && deps.now() - startedAt >= timeBudgetMs) {
        timeBudgetHit = true;
        break walk;
      }
      if (matches.length >= maxResults) {
        resultCapHit = true;
        break walk;
      }

      const full = path.join(dir, String(entry.name));
      if (entry.isSymbolicLink()) {
        // Policy: never follow reparse points (symlinks, junctions). This is
        // what keeps the walk cycle-proof on Windows; it is a deliberate
        // coverage exception, tracked but not treated as a failure.
        symlinkSkipped += 1;
        continue;
      }

      if (entry.isDirectory()) {
        if (includeDirs && matcher.test(String(entry.name))) matches.push(full);
        if (depth + 1 > maxDepth) {
          depthLimitHit = true;
        } else {
          stack.push({ dir: full, depth: depth + 1 });
        }
        continue;
      }
      if (entry.isFile() && matcher.test(String(entry.name))) {
        matches.push(full);
      }
    }
  }

  return assemble();

  function assemble() {
    const elapsedMs = deps.now() - startedAt;
    let incompleteReason;
    if (timeBudgetHit) incompleteReason = "time-budget";
    else if (resultCapHit) incompleteReason = "result-limit";
    else if (depthLimitHit) incompleteReason = "depth-limit";
    else if (skippedCount > 0) incompleteReason = "permission-denied";
    const result = {
      root: rootPath,
      pattern,
      matches,
      matchedCount: matches.length,
      dirsWalked,
      symlinkSkipped,
      skippedCount,
      skipped,
      complete: incompleteReason === undefined,
      elapsedMs,
      limits: Object.freeze({ maxResults, timeBudgetMs, maxDepth, includeDirs, caseInsensitive }),
    };
    if (incompleteReason !== undefined) result.incompleteReason = incompleteReason;
    return result;
  }

  function requireOptions(o) {
    if (o === null || typeof o !== "object") {
      throw new TypeError("dsh-find-file: options must be an object");
    }
    if (typeof o.root !== "string" || o.root.length === 0) {
      throw new TypeError('dsh-find-file: options.root must be a non-empty string');
    }
    if (typeof o.pattern !== "string") {
      throw new TypeError("dsh-find-file: options.pattern must be a string");
    }
    for (const name of ["maxResults", "timeBudgetMs", "maxDepth"]) {
      if (o[name] !== undefined && (typeof o[name] !== "number" || !Number.isFinite(o[name]))) {
        throw new TypeError(`dsh-find-file: options.${name} must be a finite number`);
      }
    }
    for (const name of ["includeDirs", "caseInsensitive"]) {
      if (o[name] !== undefined && typeof o[name] !== "boolean") {
        throw new TypeError(`dsh-find-file: options.${name} must be a boolean`);
      }
    }
    return {
      root: o.root,
      pattern: o.pattern,
      maxResults: o.maxResults ?? 50,
      timeBudgetMs: o.timeBudgetMs ?? 90_000,
      maxDepth: o.maxDepth ?? 64,
      includeDirs: o.includeDirs ?? false,
      caseInsensitive: o.caseInsensitive ?? defaultCaseInsensitive(),
    };
  }
}

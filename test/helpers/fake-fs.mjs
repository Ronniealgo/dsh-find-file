// dsh-find-file — test/helpers/fake-fs.mjs
//
// In-memory filesystem for walk tests. Keys are normalized to POSIX style
// ("/dir/dir"), so the same spec runs identically on win32 and linux CI.
//
// spec node forms:
//   "name": "content"   → file
//   "name": {}          → directory
//   "name": { $symlink: true } → symbolic link (never resolved)
//
// fail: { "/locked": "EPERM" } → readdir/stat on that path rejects {code}.

import path from "node:path";

/** Normalize any platform path to the fake-fs canonical form. */
export function keyOf(p) {
  let s = String(p).replace(/\\/g, "/");
  s = s.replace(/^[A-Za-z]:/, ""); // strip drive letters
  while (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s.length === 0 ? "/" : s;
}

/**
 * @param {Record<string, unknown>} spec tree rooted at "/"
 * @param {{ fail?: Record<string, string>, clock?: { advance:(ms:number)=>void } }} [opts]
 */
export function makeFakeFs(spec, opts = {}) {
  const dirs = new Map(); // key → [{name, isDirectory, isFile, isSymbolicLink}]
  const files = new Set();
  const symlinks = new Set();
  const fail = opts.fail ?? {};

  function build(prefix, node) {
    dirs.set(prefix, []);
    for (const [name, value] of Object.entries(node)) {
      const full = prefix === "/" ? `/${name}` : `${prefix}/${name}`;
      const entry = { name, isDirectory: () => false, isFile: () => false, isSymbolicLink: () => false };
      if (value !== null && typeof value === "object" && value.$symlink === true) {
        symlinks.add(full);
        entry.isSymbolicLink = () => true;
        dirs.get(prefix).push(entry);
      } else if (value !== null && typeof value === "object") {
        entry.isDirectory = () => true;
        dirs.get(prefix).push(entry);
        build(full, value);
      } else {
        files.add(full);
        entry.isFile = () => true;
        dirs.get(prefix).push(entry);
      }
    }
  }
  build("/", spec);

  let fakeNow = 0;
  const clock = opts.clock ?? {
    get now() {
      return fakeNow;
    },
    advance(ms) {
      fakeNow += ms;
    },
  };

  function rejectIfFailed(key) {
    if (fail[key] !== undefined) {
      const error = new Error(`fake fs: ${key} fails with ${fail[key]}`);
      error.code = fail[key];
      throw error;
    }
  }

  const deps = {
    async readdir(dir) {
      const key = keyOf(dir);
      rejectIfFailed(key);
      const entries = dirs.get(key);
      if (entries === undefined) {
        const error = new Error(`fake fs: ${key} not found`);
        error.code = "ENOENT";
        throw error;
      }
      return entries.map((entry) => ({ ...entry }));
    },
    async stat(p) {
      const key = keyOf(p);
      rejectIfFailed(key);
      if (dirs.has(key)) return { isDirectory: () => true, isFile: () => false };
      if (files.has(key) || symlinks.has(key)) return { isDirectory: () => false, isFile: () => true };
      const error = new Error(`fake fs: ${key} not found`);
      error.code = "ENOENT";
      throw error;
    },
    now() {
      return clock.now;
    },
  };

  return { deps, clock };
}

/** Platform-agnostic absolute-ish root for fake walks. walk() resolves it
 * with the real path module; keyOf() strips whatever that yields. */
export const FAKE_ROOT = path.resolve("/");

/** Build a fake-fs spec key relative to FAKE_ROOT for the fail map. */
export function fakePath(...segments) {
  return keyOf(path.resolve(FAKE_ROOT, ...segments));
}

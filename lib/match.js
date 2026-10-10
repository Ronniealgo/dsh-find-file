// dsh-find-file — lib/match.js
//
// Basename pattern → RegExp. Supported syntax is deliberately tiny:
//   `*`  any run of characters (including none)
//   `?`  exactly one character
// everything else matches literally (regex metacharacters are escaped).
// This is a FILENAME matcher: patterns containing path separators are almost
// certainly a caller mistake (glob-style `a/**/b`), so they are rejected
// instead of silently never matching.

const MAX_PATTERN_LENGTH = 512;

/** Characters with special meaning in a RegExp, except `*` and `?` which we
 * translate to wildcard syntax ourselves. `/` is included so separator
 * detection and escaping share one table. */
const REGEX_SPECIALS = /[.+^${}()|[\]\\\/]/g;

/**
 * Compile a basename pattern.
 *
 * @param {string} pattern wildcard pattern (`*`, `?` supported)
 * @param {{ caseInsensitive?: boolean }} [options]
 * @returns {RegExp} anchored matcher for a single path segment (basename)
 * @throws {TypeError} on non-string, empty, over-long patterns, path
 *   separators, or embedded NUL bytes
 */
export function compilePattern(pattern, { caseInsensitive = false } = {}) {
  if (typeof pattern !== "string") {
    throw new TypeError(`dsh-find-file: pattern must be a string, got ${typeof pattern}`);
  }
  if (pattern.length === 0) {
    throw new TypeError("dsh-find-file: pattern must not be empty");
  }
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new TypeError(`dsh-find-file: pattern exceeds ${MAX_PATTERN_LENGTH} characters`);
  }
  if (pattern.includes("\0")) {
    throw new TypeError("dsh-find-file: pattern must not contain NUL bytes");
  }
  if (/[\\/]/.test(pattern)) {
    throw new TypeError(
      `dsh-find-file: pattern must be a file NAME (no path separators), got ${JSON.stringify(pattern)}; ` +
        "search from the parent directory instead",
    );
  }
  const source =
    "^" +
    pattern
      .replace(REGEX_SPECIALS, "\\$&")
      .replace(/\*/g, ".*") // filenames cannot contain newlines; `.` is safe
      .replace(/\?/g, ".") +
    "$";
  return new RegExp(source, caseInsensitive ? "i" : "");
}

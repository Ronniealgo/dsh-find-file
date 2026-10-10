// dsh-find-file — lib/tool.js
//
// Turns the walk engine into a DSH agent-tool descriptor. The SDK function
// `defineTool` is INJECTED (not imported) so this module — and every test
// of it — runs with zero SDK presence; only lib/index.js touches the real
// SDK, and only inside a running DSH process (see README "Why injection").

import { findFiles } from "./walk.js";
import { resolveCallLimits } from "./config.js";

/** The tool's contract in prose for the model. This text is the product:
 * it must teach the model when to pick this tool over glob and how to read
 * `complete`. Keep it tight; details live in README. */
const TOOL_DESCRIPTION =
  "Search for files by basename pattern (`*` and `?` wildcards) below a root directory, " +
  "immune to permission-denied directories. Unlike glob, a partial failure never discards " +
  "results: unreadable directories are skipped AND reported, and `complete:false` means the " +
  "tree was NOT fully covered. Never conclude that a file does not exist from an incomplete " +
  "search — narrow the root or recheck instead. Prefer this over glob for wide searches on " +
  "Windows (Program Files, user profile, drive roots) and whenever glob reports " +
  "'search failed (exit 2)' or a suspicious absence.";

const ARG_DESCRIPTIONS = {
  root: "Directory (or single file) to search from. Use a narrow root when you can; wide roots on Windows will typically skip ACL-walled directories (reported in `skipped`).",
  pattern: "File name pattern with `*` (any run of characters) and `?` (exactly one). Bare name only — no path separators, e.g. `pdftotext.exe`, `*.pdf`.",
  maxResults: `Stop after this many matches (1-1000, default 50). Hitting the cap marks the search incomplete (reason "result-limit").`,
  timeBudgetMs: `Wall-clock budget in milliseconds (1000-600000, default 90000). Exceeding it marks the search incomplete (reason "time-budget").`,
  maxDepth: `Directory levels below root to walk (1-256, default 64). Hitting the cap marks the search incomplete (reason "depth-limit").`,
  includeDirs: "Also match directory names, not only files (default false). Matched directories are still descended into.",
};

/** Full output contract. Keep in lockstep with the object walk.js assembles;
 * test/tool.test.mjs asserts real results against THIS schema. */
export const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "root",
    "pattern",
    "matches",
    "matchedCount",
    "dirsWalked",
    "symlinkSkipped",
    "skippedCount",
    "skipped",
    "complete",
    "elapsedMs",
    "limits",
  ],
  properties: {
    root: { type: "string", description: "Absolute root the search started from." },
    pattern: { type: "string", description: "Pattern as requested." },
    matches: { type: "array", items: { type: "string" }, description: "Absolute paths, walk order, capped at maxResults." },
    matchedCount: { type: "number", description: "Number of reported matches (= matches.length; equals maxResults when capped)." },
    dirsWalked: { type: "number", description: "Directories successfully read." },
    symlinkSkipped: { type: "number", description: "Symlinks/junctions seen but never followed (policy, not failure)." },
    skippedCount: { type: "number", description: "Directories that could not be read at all." },
    skipped: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "code"],
        properties: {
          path: { type: "string" },
          code: { type: "string", description: "errno-style code, e.g. EPERM, EACCES." },
        },
      },
      description: "Up to 30 skipped directories (the rest are still counted).",
    },
    complete: { type: "boolean", description: "true only if the whole tree was read within limits. false means inconclusive." },
    incompleteReason: {
      type: "string",
      description: 'Why the search is incomplete: "time-budget" | "result-limit" | "depth-limit" | "permission-denied". Present only when complete is false.',
    },
    elapsedMs: { type: "number", description: "Wall-clock duration." },
    limits: {
      type: "object",
      additionalProperties: false,
      required: ["maxResults", "timeBudgetMs", "maxDepth", "includeDirs", "caseInsensitive"],
      properties: {
        maxResults: { type: "number" },
        timeBudgetMs: { type: "number" },
        maxDepth: { type: "number" },
        includeDirs: { type: "boolean" },
        caseInsensitive: { type: "boolean" },
      },
    },
  },
};

/** Render at most this many match paths into the text block; the JSON value
 * always carries all of them. */
const RENDER_MATCH_MAX = 20;

/** Render at most this many skipped entries into the text block. */
const RENDER_SKIPPED_MAX = 5;

/**
 * Build the descriptor for `sctx.tools.register`.
 *
 * @param {{ defineTool: Function, settings: object }} deps
 *   defineTool — the real `@deepseek-ai/dsh-tools` function in production,
 *   a passthrough stub in tests; settings — frozen entry config from
 *   resolveSettings().
 */
export function buildToolDefinition({ defineTool, settings }) {
  if (typeof defineTool !== "function") {
    throw new TypeError("dsh-find-file: buildToolDefinition needs a defineTool function");
  }
  return defineTool({
    name: "find_file",
    description: TOOL_DESCRIPTION,
    parameters: {
      root: { type: "string", description: ARG_DESCRIPTIONS.root },
      pattern: { type: "string", description: ARG_DESCRIPTIONS.pattern },
      maxResults: { type: "number", description: ARG_DESCRIPTIONS.maxResults },
      timeBudgetMs: { type: "number", description: ARG_DESCRIPTIONS.timeBudgetMs },
      maxDepth: { type: "number", description: ARG_DESCRIPTIONS.maxDepth },
      includeDirs: { type: "boolean", description: ARG_DESCRIPTIONS.includeDirs },
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render(_args, value) {
        return [{ type: "text", text: renderResult(value) }];
      },
    },
    async execute(args) {
      if (args === null || typeof args !== "object") {
        throw new TypeError("find_file: arguments must be an object");
      }
      if (typeof args.root !== "string" || args.root.length === 0) {
        throw new TypeError('find_file: "root" is required (non-empty string)');
      }
      if (typeof args.pattern !== "string" || args.pattern.length === 0) {
        throw new TypeError('find_file: "pattern" is required (non-empty string)');
      }
      const limits = resolveCallLimits(settings, args);
      return findFiles({ root: args.root, pattern: args.pattern, ...limits });
    },
  });
}

/**
 * Human/model-readable rendering of one result. Always ends with a verdict
 * line — the single most important sentence for downstream reasoning.
 *
 * @param {object} value a walk.js result object
 * @returns {string}
 */
export function renderResult(value) {
  const lines = [];
  const completeText = value.complete ? "COMPLETE (covers the whole tree)" : `INCOMPLETE (${value.incompleteReason})`;
  lines.push(
    `find_file: ${value.matchedCount} match(es) · ${value.dirsWalked} dirs walked · ${value.elapsedMs} ms · search ${completeText}`,
  );
  for (const match of value.matches.slice(0, RENDER_MATCH_MAX)) {
    lines.push(`  ${match}`);
  }
  if (value.matches.length > RENDER_MATCH_MAX) {
    lines.push(`  … ${value.matches.length - RENDER_MATCH_MAX} more (see JSON value)`);
  }
  if (value.skippedCount > 0) {
    const sample = value.skipped
      .slice(0, RENDER_SKIPPED_MAX)
      .map((s) => `${s.path} (${s.code})`)
      .join("; ");
    const more = value.skippedCount > value.skipped.length ? ` … and ${value.skippedCount - value.skipped.length} more` : "";
    lines.push(`skipped ${value.skippedCount} dir(s): ${sample}${more}`);
  }
  if (value.symlinkSkipped > 0) {
    lines.push(`symlinks/junctions not followed: ${value.symlinkSkipped}`);
  }
  lines.push(
    value.complete && value.matchedCount === 0
      ? "VERDICT: nothing found — the whole tree was walked, so the file does not exist under this root."
      : value.complete
        ? "VERDICT: search completed; every listed match exists."
        : "VERDICT: search incomplete — absence here is NOT proof of absence overall. Narrow the root or recheck before concluding.",
  );
  return lines.join("\n");
}

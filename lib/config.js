// dsh-find-file — lib/config.js
//
// Single source of truth for every limit the tool accepts. Both the plugin
// entry config (cordis.patch.yml `config:` block) and the per-call tool
// arguments funnel through the same clamps, so the two layers can never
// disagree about what a valid value is.
//
// Design rule: unknown keys are REJECTED, not ignored. A typo like
// `maxRsults:` in a patch file must fail loudly at load time instead of
// silently falling back to defaults.

/** Hard bounds. A request outside these is clamped, never rejected, so a
 * hostile/erroneous caller cannot make the walk unbounded. */
export const LIMITS = Object.freeze({
  maxResults: { min: 1, max: 1000, default: 50 },
  timeBudgetMs: { min: 1000, max: 600_000, default: 90_000 },
  maxDepth: { min: 1, max: 256, default: 64 },
});

/** Boolean options and their defaults. */
export const FLAGS = Object.freeze({
  includeDirs: false,
});

/** Case matching default: Windows and macOS filesystems are case-insensitive
 * in practice, Linux is not. Callers may always override per call. */
export function defaultCaseInsensitive(platform = process.platform) {
  return platform === "win32" || platform === "darwin";
}

function clampNumber(name, value) {
  const spec = LIMITS[name];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`dsh-find-file: ${name} must be a finite number, got ${JSON.stringify(value)}`);
  }
  return Math.min(spec.max, Math.max(spec.min, Math.round(value)));
}

function requireBoolean(name, value) {
  if (typeof value !== "boolean") {
    throw new TypeError(`dsh-find-file: ${name} must be a boolean, got ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Validate and clamp the plugin entry config (cordis.patch.yml `config:`).
 * Unknown keys throw; values are clamped into LIMITS bounds.
 *
 * @param {Record<string, unknown>} raw config block handed to apply()
 * @returns {Readonly<{maxResults:number,timeBudgetMs:number,maxDepth:number,includeDirs:boolean}>}
 */
export function resolveSettings(raw = {}) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError("dsh-find-file: config must be an object");
  }
  const known = new Set([...Object.keys(LIMITS), ...Object.keys(FLAGS)]);
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) {
      throw new TypeError(`dsh-find-file: unknown config key "${key}" (valid: ${[...known].join(", ")})`);
    }
  }
  return Object.freeze({
    maxResults: raw.maxResults === undefined ? LIMITS.maxResults.default : clampNumber("maxResults", raw.maxResults),
    timeBudgetMs: raw.timeBudgetMs === undefined ? LIMITS.timeBudgetMs.default : clampNumber("timeBudgetMs", raw.timeBudgetMs),
    maxDepth: raw.maxDepth === undefined ? LIMITS.maxDepth.default : clampNumber("maxDepth", raw.maxDepth),
    includeDirs: raw.includeDirs === undefined ? FLAGS.includeDirs : requireBoolean("includeDirs", raw.includeDirs),
  });
}

/**
 * Validate and clamp per-call tool arguments on top of entry settings.
 * Undefined values keep the configured default. Unknown keys throw so a
 * misspelled tool argument surfaces immediately instead of being ignored.
 * `root` and `pattern` belong to the tool's argument surface (execute
 * consumes them directly) and are accepted here so the typo guard sees the
 * FULL descriptor — but only the limit keys are returned.
 *
 * @param {Readonly<ReturnType<typeof resolveSettings>>} settings
 * @param {Record<string, unknown>} args tool call arguments
 */
export function resolveCallLimits(settings, args = {}) {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    throw new TypeError("dsh-find-file: tool arguments must be an object");
  }
  const limitKeys = ["maxResults", "timeBudgetMs", "maxDepth", "includeDirs", "caseInsensitive"];
  const allowed = new Set([...limitKeys, "root", "pattern"]);
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) {
      throw new TypeError(`dsh-find-file: unknown argument "${key}" (valid: ${[...allowed].join(", ")})`);
    }
  }
  return {
    maxResults: args.maxResults === undefined ? settings.maxResults : clampNumber("maxResults", args.maxResults),
    timeBudgetMs: args.timeBudgetMs === undefined ? settings.timeBudgetMs : clampNumber("timeBudgetMs", args.timeBudgetMs),
    maxDepth: args.maxDepth === undefined ? settings.maxDepth : clampNumber("maxDepth", args.maxDepth),
    includeDirs: args.includeDirs === undefined ? settings.includeDirs : requireBoolean("includeDirs", args.includeDirs),
    caseInsensitive:
      args.caseInsensitive === undefined ? defaultCaseInsensitive() : requireBoolean("caseInsensitive", args.caseInsensitive),
  };
}

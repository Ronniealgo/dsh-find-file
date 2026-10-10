#!/usr/bin/env node
// dsh-find-file — bin/find-file.mjs
//
// Command-line front door to the same engine the agent tool uses. Useful for
// humans, for CI, and as the ground truth when a tool result looks odd.
//
//   node bin/find-file.mjs <root> <pattern> [options]
//
// Options:
//   --max-results N        stop after N matches       (default 50)
//   --time-budget-ms N     wall-clock budget          (default 90000)
//   --max-depth N          directory levels to walk   (default 64)
//   --include-dirs         also match directory names
//   --case-sensitive       match case-sensitively (default: OS-aware)
//   --quiet                print match paths only, nothing else
//
// Exit codes: 0 = search ran (even with zero matches); 1 = fatal (root
// inaccessible); 2 = usage error.

import path from "node:path";
import { findFiles } from "../lib/walk.js";
import { resolveCallLimits, resolveSettings } from "../lib/config.js";

const USAGE = `usage: node find-file.mjs <root> <pattern> [--max-results N] [--time-budget-ms N]
                   [--max-depth N] [--include-dirs] [--case-sensitive] [--quiet]`;

/** Declared BEFORE main() runs: main's synchronous prologue (argument
 * parsing) can throw this while the rest of the module is still evaluating. */
class UsageError extends Error {}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`find-file: ${error?.message ?? error}`);
    // Exit-code contract: usage errors (bad flags, bad pattern syntax) are 2;
    // everything else — including an unreachable root — is 1.
    process.exit(error instanceof UsageError || error instanceof TypeError ? 2 : 1);
  },
);

async function main() {
  const argv = process.argv.slice(2);
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--include-dirs") flags.includeDirs = true;
    else if (arg === "--case-sensitive") flags.caseSensitive = true;
    else if (arg === "--quiet") flags.quiet = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      return 0;
    } else if (arg.startsWith("--")) {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value)) throw new UsageError(`option ${arg} needs a number (got ${argv[i] ?? "nothing"})`);
      if (arg === "--max-results") flags.maxResults = value;
      else if (arg === "--time-budget-ms") flags.timeBudgetMs = value;
      else if (arg === "--max-depth") flags.maxDepth = value;
      else throw new UsageError(`unknown option ${arg}`);
    } else positional.push(arg);
  }
  const [root, pattern] = positional;
  if (!root || !pattern) throw new UsageError("both <root> and <pattern> are required");

  // CLI inherits the same clamps as the tool; entry settings come from
  // defaults (the CLI has no patch file).
  const settings = resolveSettings({});
  let call;
  try {
    call = resolveCallLimits(settings, {
      maxResults: flags.maxResults,
      timeBudgetMs: flags.timeBudgetMs,
      maxDepth: flags.maxDepth,
      includeDirs: flags.includeDirs,
      caseInsensitive: flags.caseSensitive ? false : undefined,
    });
  } catch (error) {
    throw new UsageError(error.message);
  }

  try {
    const result = await findFiles({ root: path.resolve(root), pattern, ...call });
    if (flags.quiet) {
      for (const match of result.matches) console.log(match);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
    return 0;
  } catch (error) {
    console.error(`find-file: ${error.message}`);
    // A TypeError here means argument misuse (e.g. path separator in the
    // pattern); an unreachable root or an internal fault stays fatal (1).
    return error instanceof TypeError ? 2 : 1;
  }
}


// dsh-find-file — lib/index.js
//
// Host-half plugin entry. This is the ONLY module that imports the DSH SDK:
// everything below it (walk, match, config, tool) is SDK-free and testable
// offline. Keep it that way.

import { defineTool } from "@deepseek-ai/dsh-tools";
import { resolveSettings } from "./config.js";
import { buildToolDefinition } from "./tool.js";

const PACKAGE_NAME = "dsh-find-file";

/**
 * Register the `find_file` agent tool.
 *
 * @param {object} ctx cordis plugin context handed over by the DSH loader
 * @param {object} [config] entry config from cordis.patch.yml / plugin row:
 *   maxResults, timeBudgetMs, maxDepth, includeDirs (unknown keys throw)
 */
export function apply(ctx, config = {}) {
  let settings;
  try {
    settings = resolveSettings(config);
  } catch (error) {
    // Surface config mistakes with the plugin's name attached; the loader
    // logs apply() throws, but an unnamed TypeError is hard to attribute.
    throw new TypeError(`${PACKAGE_NAME}: ${error.message}`);
  }

  ctx.inject(["tools"], (sctx) => {
    sctx.effect(() => {
      const dispose = sctx.tools.register(buildToolDefinition({ defineTool, settings }));
      ctx.logger?.info?.(
        `${PACKAGE_NAME}: tool find_file registered (maxResults=${settings.maxResults}, ` +
          `timeBudgetMs=${settings.timeBudgetMs}, maxDepth=${settings.maxDepth}, includeDirs=${settings.includeDirs})`,
      );
      return () => dispose();
    });
  });
}

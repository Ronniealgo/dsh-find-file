# Notes for agents working in this repository

Short, factual notes so an automated contributor does not have to rediscover them.

## Shape of the project

- **`lib/walk.js` is the engine**: tree walk + match + result assembly. The
  filesystem and the clock come in through the `deps` parameter, so tests
  drive an in-memory tree with forced errors and a fake clock — no real disk.
- **`lib/match.js`** compiles a basename pattern to an anchored RegExp: only
  `*` and `?` are wildcards, everything else matches literally; path
  separators in a pattern throw a TypeError (a caller mistake, not a match).
- **`lib/config.js` is the single source of truth for every limit**. The entry
  config (`resolveSettings`, from cordis.patch.yml) and the per-call arguments
  (`resolveCallLimits`) funnel through the same clamps, so the two layers can
  never disagree. Unknown keys throw — that is deliberate, keep it.
- **`lib/tool.js`** wraps the engine in the DSH tool descriptor (name
  `find_file`, OUTPUT_SCHEMA, VERDICT render). `defineTool` is injected, so
  this module and its tests never need the SDK present.
- **`lib/index.js`** is the only SDK-touching module: `apply()` resolves the
  entry config and registers the tool. **`bin/find-file.mjs`** is the CLI
  facade over the same engine.
- The patch row id is `find-file`, the package name is `dsh-find-file`; the
  entry config accepts exactly `maxResults`, `timeBudgetMs`, `maxDepth`,
  `includeDirs`.

## Commands that decide whether a change is acceptable

```bash
npm test        # node --test test/match.test.mjs test/walk.test.mjs test/tool.test.mjs test/cli.test.mjs
npm run check   # node --check every source file
```

The four test files are named explicitly: a directory argument to `node
--test` stopped being a scan root in Node 22 (`Cannot find module .../test`);
only Node 20 still accepts it.

Under a Windows workspace-write sandbox, `npm test` can fail with
`spawn EPERM` because the runner spawns one child process per test file over
piped stdio. In that case run the suites file by file
(`node test/walk.test.mjs`, …); the CLI suite spawns `bin/find-file.mjs` via
`spawnSync` and therefore belongs outside the sandbox entirely.

## Rules that are not obvious

1. **Zero runtime dependencies** is a product requirement, not a coincidence:
   the engine must run on any machine with bare Node ≥ 20. A new dependency
   needs an issue first, with an argument for why the built-in APIs cannot do
   the job.
2. **Never lie about coverage.** A directory that could not be read goes into
   `skipped` with its errno code and flips `complete` to `false`. Only
   `complete: true` with zero matches licenses "the file does not exist under
   root". Never render "could not read" as "not present".
3. **Symlinks and junctions are never followed.** This is the cycle-safety
   guarantee on Windows (junction loops exist in the wild), not a bug; they
   are counted in `symlinkSkipped` and do not affect `complete`.
4. **Unknown config keys and unknown arguments must throw** (lib/config.js).
   Silently ignoring a typo turns a load-time error into a runtime incident.
5. UTF-8 without BOM everywhere; line endings are governed by
   `.gitattributes` (`.mjs`/`.yml` LF, `.ps1` CRLF).
6. `package.json` `name` is the name the loader resolves; the junction
   directory under the profile's `node_modules` must equal it.

## Collaboration rules (hard requirement)

- The Lead owns the delivery end to end. Delegation moves workload, never
  responsibility.
- **The core engine — `lib/walk.js`, `lib/match.js`, `lib/config.js` — must
  not be delegated.** Architecture decisions, algorithms and contract changes
  are Lead work. Periphery (docs, CI config, install.ps1, examples, extra
  test cases) may be delegated, but every delegation must carry a
  self-sufficient brief (paths, interfaces, constraints, acceptance command).
- The Lead personally reviews every diff and personally runs the acceptance
  commands before declaring anything done.
- End every reply with the three-line self-report, in exactly this format:

```
委派：N 个（agent 名 / 任务 / 实际指定模型与推理强度）
自做：<哪部分，为什么没派>
验收：<跑了什么命令 / 结果>
```

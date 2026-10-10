# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- CI 与 `npm test` 的测试命令：`node --test test/` 自 Node 22 起不再把目录参数当扫描根（报 `Cannot find module .../test`，Node 20 仍可用），改为显式点名四个测试文件，Node 20/22/24 行为一致。

## [0.1.0] - 2026-10-10

### Added

- 初始版本。
- **`find_file` agent 工具**：按 basename 通配符（`*` / `?`）在 root 下搜索文件。读不了的目录跳过而不中断搜索，连同 errno 代码记入 `skipped`；任何覆盖缺口都把 `complete` 置为 `false` 并给出 `incompleteReason`（`time-budget` / `result-limit` / `depth-limit` / `permission-denied` 四个值之一）。symlink 与 junction 一律不跟随，计入 `symlinkSkipped`（策略，不算失败）。
- **完整语义**：只有 `complete: true` 且 0 匹配，才允许「该文件在此 root 下不存在」的结论；工具的文本渲染永远以 VERDICT 行收尾，把这一规则直接讲给模型。
- **CLI** `bin/find-file.mjs`：同一引擎的命令行门面，选项 `--max-results` / `--time-budget-ms` / `--max-depth` / `--include-dirs` / `--case-sensitive` / `--quiet`，退出码 0（搜索完成）/ 1（致命错误）/ 2（用法错误）。
- **零运行时依赖**：纯 node:fs/promises + node:path，无 ripgrep、无 npm 依赖；测试用 Node 自带 runner（`node --test test/`），无需 `npm install`。
- `install.ps1` 一键安装/卸载（junction + cordis.patch.yml 插件行，带时间戳备份），CI（ubuntu 矩阵 + Windows 真跑），以及 AGENTS/CONTRIBUTING/SECURITY 文档。

[Unreleased]: https://github.com/Ronniealgo/dsh-find-file/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Ronniealgo/dsh-find-file/releases/tag/v0.1.0

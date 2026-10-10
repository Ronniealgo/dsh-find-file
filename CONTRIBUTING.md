# 参与贡献

先跑通，再改。这个仓库没有任何要安装的东西：零运行时依赖，测试用 Node 自带的 runner（要求 Node ≥ 20）。

```bash
git clone https://github.com/Ronniealgo/dsh-find-file.git
cd dsh-find-file
npm test        # node --test test/：4 个套件（match / walk / tool / cli）
npm run check   # node --check 全部源文件
```

## 开发流程

1. 开 issue 说明要改什么（尤其是行为变化和新配置面）。
2. 从 `main` 拉 branch，改动加上对应用例。
3. `npm test && npm run check` 全绿。
4. 开 PR，写清你验证了什么、没验证什么。

## 提交规范

常规提交式的一句话即可：`fix: ...`、`feat: ...`、`docs: ...`、`test: ...`。不强制 scope，一行讲清楚做了什么。

## PR 要求

- **行为变化必须附测试**。放哪：引擎行为进 `test/walk.test.mjs`，匹配语义进 `test/match.test.mjs`，工具契约（参数、输出 schema、渲染文本）进 `test/tool.test.mjs`，CLI 进 `test/cli.test.mjs`。找最接近的现有用例挨着写。
- 修 bug 的 PR 先加一个能复现 bug 的用例（红），再修（绿）。
- README / CHANGELOG 同步更新；CHANGELOG 条目写在 `## [Unreleased]` 语义下的最新一节。
- PR 描述里明确说哪些是跑过验证的、哪些只是推断（例如在真实 Windows ACL 目录上试过没有）。

## 房规（不可协商）

1. **零运行时依赖**。纯 `node:fs/promises` + `node:path`，测试零安装。想加依赖：先在 issue 里论证为什么原生 API 做不到，说服维护者之后再动 package.json。没有例外。
2. **不许撒谎**。读不了的目录必须进 `skipped` 并把 `complete` 翻 `false`；永远不许把「没读到」渲染成「不存在」。这是本插件存在的全部理由。
3. **未知配置键、未知参数必须抛错**（lib/config.js）。静默忽略拼写错误 = 加载期错误变成运行期事故。
4. **symlink / junction 永不跟随**。这是防循环保证，不是待修的缺陷；要动它，先在 issue 里给出动机和防环方案。
5. 文件一律 UTF-8 无 BOM；换行符由 `.gitattributes` 管（`.mjs` / `.yml` LF，`.ps1` CRLF）。

## 报告 bug

贴：DSH 版本、插件版本、复现用的 `root` / `pattern`、完整 JSON 结果（路径可脱敏）。不要贴密钥、token 或其它凭据。

# 安全策略

## 本插件接触什么

`dsh-find-file` 是一个只读的文件搜索工具。具体边界：

- **只读文件系统元数据**：用 `readdir` / `stat` 遍历调用者指定的 root 目录树。不写文件、不发网络请求、无遥测。
- **不读文件内容**：结果里只有路径名和 errno 代码。
- **输入有硬边界**：`pattern` 只认文件名（拒绝路径分隔符和 NUL 字节，长度封顶 512）；遍历不跟随 symlink / junction（reparse 环天然不可达）；`skipped` 清单封顶 30 条，`matches` 封顶 `maxResults`，遍历受 `maxDepth` 与 `timeBudgetMs` 约束。
- **宿主内运行**：插件在 DSH 主进程里注册一个 agent 工具（`find_file`），不注册任何服务、路由或界面。唯一的 SDK 依赖是可选 peer `@deepseek-ai/dsh-tools`。

## 报告漏洞

请开**私密**安全公告（仓库页面 Security → Report a vulnerability），不要开公开 issue。请附：受影响版本、攻击者能得到什么、最小复现步骤。

如果问题出在 DSH 本体（加载器、工具框架）而不是本插件，请同时上报上游 <https://github.com/deepseek-ai/deepseek-harness> —— 也欢迎在这里说一声，我们会帮忙路由。

## 支持的版本

只支持最新发布的版本（当前 0.1.x）。旧版本不收安全修复。

## 不接收的报告类别

- **超大目录树造成的资源消耗（DoS）**：`maxResults` / `timeBudgetMs` / `maxDepth` 三个上限就是为这类场景设计的——调用者只能影响自己这一次调用，无法放大到宿主。
- **symlink / junction 环**：遍历策略是从不跟随 reparse point，环不可达，这是文档化行为。
- **对结果语义的误读**：`complete: false` 时的空结果在结果契约里已明确标注为「不可下结论」；按 README 的 complete 语义使用不属于漏洞范畴。

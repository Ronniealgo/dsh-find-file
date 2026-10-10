# 动机：为什么需要一个「会报告残缺」的搜索

本文讲清三件事：内置 glob 的失败方式为什么在 Windows 上成为日常；为什么
「部分结果 + 明确的残缺标注」才是正确的语义；以及 CLI 和 agent 工具的关系。
全文只描述可观察的行为（错误文本、返回字段），不涉及 DSH 内部实现。

## 1. 事故现场

在 Windows 上让 agent 在宽根目录里找文件——`C:\Program Files`、用户主目录、
盘根——内置 glob 经常整次失败，报错类似：

```
Error: glob search failed (exit 2): rg: ... 拒绝访问。 (os error 5)
```

`os error 5` 是 `ERROR_ACCESS_DENIED`。这不是 ripgrep 的 bug：像
`C:\Program Files\WindowsApps` 这类目录对普通进程就是拒绝访问，系统 ACL 在
那里是刻意设计的，rg 读不了只能报错退出。

问题出在 glob 工具对这一错误的处理方式：只要 ripgrep 以非零码（≥2）退出，
**整条搜索作废**——已扫到的结果一并丢弃，调用方拿到的是一条 Error，而不是
「找到了什么、哪里读不了」。而宽根目录恰恰是搜索最常见的场景：想找一个
exe 或一份配置，最自然的出发点就是「从用户目录往下找」。

## 2. 为什么这比「搜不到」更糟

一次失败的搜索和一次成功的空搜索，在下游推理里看起来几乎一样：模型拿到的
都没有匹配项。于是这样的推理链路就会出现——

1. 模型问「机器上装没装 pdftotext.exe」；
2. glob 扫 `C:\Program Files`，撞上 WindowsApps，整次作废；
3. 模型看到的等价于「无结果」，回答「没安装」；
4. 而文件其实就在那里。

错误不是模型「推理错了」，是它的证据在生成之前就被扔掉了。修复方向因此很
清楚：**证据不许扔**。

## 3. 部分结果为什么是对的语义

一次文件系统遍历的结果，本来就不止「全部拿到 / 全部失败」两种。诚实的输出
至少要回答三个问题：

1. **找到了什么？**——`matches` / `matchedCount`；
2. **哪里没看、为什么？**——`skipped[{path, code}]` / `skippedCount`；
3. **这次搜索的覆盖是否完整？**——`complete` / `incompleteReason`。

`dsh-find-file` 把这三个答案放进同一个 JSON。残缺的原因枚举成四个值：
`time-budget`（时间预算用尽）、`result-limit`（命中上限）、`depth-limit`
（树比 maxDepth 深）、`permission-denied`（有目录读不了）。于是规则可以
写成一条可执行的判据：

- `complete: true` 且 `matchedCount: 0` ⇒ 该文件在此 root 下确实不存在，
  可以下结论；
- `complete: false` ⇒ 覆盖不完整，「没找到」**不成立**，先缩小 root 或放宽
  上限重查，再谈存在与否。

这不是降级，而是把文件系统的真实边界如实交出去。「部分结果 + 明确的残缺
标注」比「全有或全无」对下游更有用：模型可以基于已有匹配继续工作，同时
知道哪一块证据缺失、缺的是什么性质的缺失。

两个刻意的设计选择，避免被误读为缺陷：

- **symlink / junction 永不跟随**。Windows 上 junction 环真实存在，跟随
  reparse point 的遍历可能永不终止。跳过它们是策略，计入
  `symlinkSkipped`，不算覆盖缺口，也不影响 `complete`。
- **上限是语义的一部分**。`maxResults` / `timeBudgetMs` / `maxDepth` 不是
  实现细节，而是结果契约：任何一个被触发，`complete` 就翻 false，理由写进
  `incompleteReason`。调用者拿到的永远知道自己吃了多少折扣。

## 4. CLI 的角色

`bin/find-file.mjs` 是同一个引擎的命令行门面。在有这个插件之前，遇到
glob 失败人们只能手动开个终端搜文件——CLI 把这条手动逃生通道产品化了：

1. **给人用**：CI、日常排查、任何没有 DSH 在场的机器（只要 Node ≥ 20）。
2. **当 ground truth**：agent 工具返回的结果如果可疑，用同一 `root` /
   `pattern` 在 CLI 上复核——两者跑的是同一个引擎、同一套上限与语义，结论
   必然一致。
3. **验证引擎行为**：引擎的文件系统与时钟是注入的，单测不碰真实磁盘；CLI
   测试（test/cli.test.mjs）则真实拉起 bin/find-file.mjs，把退出码契约
   （0 = 搜索完成，1 = 致命错误，2 = 用法错误）钉死。

它不是绕开插件的临时方案，而是同一份契约的第二个入口。

## 5. 设计原则小结

- 永不丢弃已经拿到的结果；
- 永不把「没读到」说成「不存在」；
- 覆盖不完整必须可见、可定位（`skipped` + `incompleteReason`）；
- 限制本身是语义的一部分，写进结果，不藏在实现里。

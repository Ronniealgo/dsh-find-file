# dsh-find-file

[![dshfind 收录](https://dshfind.com/api/badge/Ronniealgo/dsh-find-file?lang=zh)](https://dshfind.com/en/plugins/Ronniealgo/dsh-find-file?ref=badge)

给 DeepSeek Harness（DSH）注册一个 `find_file` agent 工具：按文件名通配符（`*`、`?`）在指定根目录下找文件，撞上权限墙不会整次作废——读不了的目录跳过并如实上报，结果里永远标明这次搜索是否完整。纯 Node 实现，零运行时依赖，Node ≥ 20。

> **上架状态（2026-10-11 核对）**：已被社区目录 [dshfind.com](https://dshfind.com/en/plugins/Ronniealgo/dsh-find-file) 自动收录，也进入了滚动榜单 [dshmk.com](https://dshmk.com/plugins/1413258695)。[DSH 插件市场](https://dsh.market/) 的提交单 [issue 226](https://github.com/2BingLing/dsh-market/issues/226) 仍在处理中，**尚未收录，故暂不挂该市场徽章**。收录与验证均为自动检测结果，不等于安全审计，也不代表 DSH 官方背书。

同一棵树的两种命运：

```
树里有 1 个匹配，还有 2 个普通进程读不了的目录（Windows ACL）：

内置 glob  →  Error: glob search failed (exit 2): rg: ... 拒绝访问。 (os error 5)
              已扫到的结果全部丢弃。"到底有没有？"——无从谈起。

find_file  →  matches: [ "C:\\...\\pdftotext.exe" ]        ← 照常返回
              skipped: [ { path: "...", code: "EPERM" }, … ]
              complete: false, incompleteReason: "permission-denied"
```

## 为什么需要它

DSH 内置 glob 工具把搜索委托给 ripgrep。在 Windows 上扫宽目录——`C:\Program Files`、用户主目录、盘根——几乎必然撞上系统级 ACL：`C:\Program Files\WindowsApps` 这类目录对普通进程就是拒绝访问，rg 以非零码退出，报错类似 `Error: glob search failed (exit 2): rg: ... 拒绝访问。 (os error 5)`。此时 glob 的行为是整次作废：只要 ripgrep 以 ≥2 的退出码结束，整条搜索连同已扫到的结果一起丢弃，模型拿到的只有这一条 Error。

真正的伤害在语义上：一次"因为权限失败"的搜索和一次"没找到"的搜索，在下游推理里很容易被混为一谈，于是"文件不存在"的错误结论就从一次失败的搜索里被顺手推出来了。本插件把"部分失败"当成一等结果：读不了的目录跳过（不中断搜索），连同 errno 一起写进结果；任何让覆盖不完整的因素——权限、时间预算、结果上限、深度上限——都会把 `complete` 置为 `false` 并给出 `incompleteReason`。这次搜索覆盖了多少、缺了哪一块，变成模型可以直接读到的事实，不用猜。

## 安装

两种方式都只动两个位置：profile 的 `node_modules` 下建一个目录联接（junction），`cordis.patch.yml` 末尾加一行插件声明。

### 方式一：install.ps1 一键装

```powershell
git clone https://github.com/Ronniealgo/dsh-find-file.git
cd dsh-find-file
powershell -ExecutionPolicy Bypass -File install.ps1              # 装进 desktop profile
powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall   # 卸载
```

脚本只做两件事：把本目录 junction 进 `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-find-file`，并在该 profile 的 `cordis.patch.yml` 末尾追加 `- insert:` 块。每次改动前先写时间戳备份，`-Uninstall` 按同一算法把行删回去（备份保留，可逐字节还原）。`-Profile` 指定其它 profile，`-DshHome` 指定其它 DSH 主目录。

### 方式二：手动

1. 建联接（junction 不需要管理员权限）：

```powershell
New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-find-file" -Target "C:\path\to\dsh-find-file"
```

2. 在 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml` 末尾追加（`config:` 可整体省略，四个键都有默认值）：

```yaml
- insert:
    - id: find-file
      name: dsh-find-file
      config:
        maxResults: 50
        timeBudgetMs: 90000
        maxDepth: 64
        includeDirs: false
```

3. 重启 DSH，到 设置 → 插件 里确认 dsh-find-file 已启用。

> 写错键名不会静默失效：未知配置键在插件加载时直接抛错（刻意设计，见「配置」）。

## 使用

### 作为 agent 工具（find_file）

工具注册后，必填参数只有两个：`root`（搜索起点，目录或单个文件）和 `pattern`（纯文件名模式：`*` 匹配任意长度，`?` 恰好一个字符，其余按字面匹配；不允许路径分隔符——要找子目录里的东西，就把 root 指到那个子目录）。四个上限可选。

```json
{
  "root": "C:\\Users\\me\\AppData",
  "pattern": "pdftotext.exe",
  "maxResults": 100
}
```

返回（真实字段）：

```json
{
  "root": "C:\\Users\\me\\AppData",
  "pattern": "pdftotext.exe",
  "matches": [
    "C:\\Users\\me\\AppData\\Local\\Programs\\poppler\\Library\\bin\\pdftotext.exe"
  ],
  "matchedCount": 1,
  "dirsWalked": 14120,
  "symlinkSkipped": 3,
  "skippedCount": 2,
  "skipped": [
    { "path": "C:\\Users\\me\\AppData\\Local\\Temp\\ipc-lock", "code": "EPERM" },
    { "path": "C:\\Users\\me\\AppData\\Roaming\\VendorX\\protected", "code": "EACCES" }
  ],
  "complete": false,
  "incompleteReason": "permission-denied",
  "elapsedMs": 8421,
  "limits": {
    "maxResults": 100,
    "timeBudgetMs": 90000,
    "maxDepth": 64,
    "includeDirs": false,
    "caseInsensitive": true
  }
}
```

字段速览：`matches` 是绝对路径（按遍历顺序，封顶 `maxResults`）；`dirsWalked` 是成功读取的目录数；`symlinkSkipped` 是看到但未跟随的符号链接/junction 数；`skipped` 是读不了的目录清单，每条带 errno 代码（最多列 30 条，总数看 `skippedCount`）；`limits` 是这次调用实际生效的上限。

工具返回给模型的文本块永远以 VERDICT 行收尾，例如：

```
find_file: 1 match(es) · 14120 dirs walked · 8421 ms · search INCOMPLETE (permission-denied)
  C:\Users\me\AppData\Local\Programs\poppler\Library\bin\pdftotext.exe
skipped 2 dir(s): C:\Users\me\AppData\Local\Temp\ipc-lock (EPERM); C:\Users\me\AppData\Roaming\VendorX\protected (EACCES)
symlinks/junctions not followed: 3
VERDICT: search incomplete — absence here is NOT proof of absence overall. Narrow the root or recheck before concluding.
```

### 作为 CLI

```powershell
node bin\find-file.mjs C:\Users\me\AppData pdftotext.exe --max-results 100
node bin\find-file.mjs C:\Users\me\Documents "*.pdf" --include-dirs --quiet
```

选项：`--max-results N`、`--time-budget-ms N`、`--max-depth N`、`--include-dirs`、`--case-sensitive`、`--quiet`（只打印匹配路径）。退出码：`0` = 搜索完成（0 个匹配也算完成）；`1` = 致命错误（root 访问不了）；`2` = 用法错误（参数或模式不合法）。

## complete 的语义（这个插件的核心）

- `complete: true`——预算内把 root 下整棵树读完。只有这时，`matchedCount: 0` 才允许下结论「该文件在此 root 下不存在」。
- symlink / junction 一律不跟随，计入 `symlinkSkipped`。这是刻意策略（Windows 上 junction 环会让天真的遍历永不终止），不算覆盖缺口，也不影响 `complete`。
- `complete: false`——搜索不完整，「没找到」不成立。`incompleteReason` 只有四个值：
  - `permission-denied`：有目录读不了，清单在 `skipped`；
  - `time-budget`：时间预算用尽；
  - `result-limit`：匹配数到达 `maxResults`；
  - `depth-limit`：树比 `maxDepth` 深。
- 实用规则：`complete: false` 时先缩小 root 或放宽上限重查，再谈存在与否。

## 配置

四个 entry config 键（写进 cordis.patch.yml 的 `config:` 块），每次调用可用同名参数覆盖：

| 键 | 范围 | 默认 | 说明 |
|---|---|---|---|
| `maxResults` | 1–1000 | `50` | 命中即停，标记 `result-limit` |
| `timeBudgetMs` | 1000–600000 | `90000` | 毫秒墙钟预算，用尽即停，标记 `time-budget` |
| `maxDepth` | 1–256 | `64` | root 下的目录层数，超过标记 `depth-limit` |
| `includeDirs` | `true` / `false` | `false` | 目录名也参与匹配；匹配到的目录仍会被深入遍历 |

- 越界数值会被夹回范围内（不是报错）；类型错误和未知键抛错。
- 未知键抛错是刻意设计：patch 里把 `maxResults` 拼成 `maxRsults`，必须炸在加载时，而不是静默退回默认值。
- `caseInsensitive` 不是 entry config 键；调用时可显式传，不传则按平台取默认——win32/darwin 不区分大小写，其余平台区分。CLI 对应 `--case-sensitive`。

## 与内置 glob 的对比

| | 内置 glob | `find_file` |
|---|---|---|
| 撞上读不了的目录 | 整次搜索作废，返回 `Error: glob search failed (exit 2)` | 跳过该目录继续搜，`skipped` 里记下 `{path, code}` |
| 已扫到的结果 | 全部丢弃 | 照常返回，`complete: false` 明示覆盖不完整 |
| 「没找到」的可信度 | 失败时无意义 | `complete: true` 且 0 匹配 ⇒ 确定不存在 |
| 部分覆盖的可见性 | 无 | `incompleteReason` 说明缺哪一类 |
| 匹配目标 | glob 模式匹配整条路径 | 纯文件名 `*` / `?`（不许路径分隔符） |
| 运行时依赖 | ripgrep 二进制 | 无（node:fs/promises + node:path） |

## 测试与开发

```bash
npm test        # 显式点名 4 个测试文件，零依赖，无需 npm install
npm run check   # node --check 全部源文件
```

要求 Node ≥ 20。引擎（lib/walk.js）的文件系统与时钟是注入的，单测不碰真实磁盘；CLI 测试会真实拉起 bin/find-file.mjs。更完整的来龙去脉见 [docs/MOTIVATION.md](docs/MOTIVATION.md)。

## 已知限制

- 不跟随 symlink/junction：链接目标下的树不会被覆盖（结果里以 `symlinkSkipped` 计数明示）。
- 只按文件名匹配：不做内容搜索，不支持 `a/**/b` 这类路径 glob。
- `skipped` 清单最多 30 条（`skippedCount` 始终准确）；`matches` 封顶 `maxResults`。
- 为 Windows ACL 场景设计；慢速网络盘靠 `timeBudgetMs` 兜底。

## 许可证

[MIT](LICENSE)

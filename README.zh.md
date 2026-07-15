# zclean

**面向 Codex、Claude Code、Cursor、Windsurf、MCP server、agent browser、测试服务器和本地开发缓存的 AI 编程运行时清理 CLI。**

[English](README.md) | [한국어](README.ko.md) | [中文](README.zh.md)

## zclean 解决什么问题

AI 编程工具在工作时会启动很多临时运行时：

它以相同方式支持 Codex、Claude Code、Cursor、Windsurf、MCP server、agent browser 和本地测试服务器。支持 Claude Code，但它从来不是必需项。

- MCP server
- Claude Code sub-agent
- Codex sandbox
- headless browser / Playwright
- `npm exec`、`tsx`、`bun`、`deno`、Python helper
- Vite、Next.js、webpack、esbuild 等开发服务器和 watcher

当会话崩溃、终端关闭或 agent 强制退出时，一些子进程可能会继续运行，占用内存、端口、CPU 和文件句柄。`zclean` 会找出这些候选项，解释原因，并且只在你明确确认后清理。

## zclean 可以做什么

1. **清理 AI 运行时 zombie process**
   - 覆盖 Claude Code、Codex、Cursor/Windsurf 类 agent、MCP server、agent browser 等遗留进程。
   - 默认只做 dry-run。
   - 只有 `classification: "confirmed-stale"` 且 `cleanupEligible: true` 的候选项才会在传入 `--yes` 时被终止。

2. **安全清理 workspace cache**
   - `.next/cache`
   - `.turbo`
   - `.vite`
   - `.parcel-cache`
   - `node_modules/.cache`
   - `.pytest_cache`
   - `.ruff_cache`
   - `.mypy_cache`
   - `__pycache__`

3. **提供报告和自动化 JSON**
   - `zclean report --json`
   - `zclean history --json`
   - `zclean cache --json`
   - `zclean doctor --json`

## zclean 不是什么

`zclean` 不是通用系统清理器。

- 不卸载应用。
- 不扫描整个磁盘。
- 不删除文档、下载、照片等用户文件。
- 不发送遥测数据。
- 不猜测并删除任意文件夹。

它的定位很明确：**AI 编程运行时清理和开发 workspace cache hygiene**。

## 安装

先运行只读 audit；它不会安装 hook、创建定时任务或执行清理：

```bash
npx --yes z-clean audit
```

清理前先查看候选项：

```bash
npx --yes z-clean
npx --yes z-clean report
```

准备长期使用时再全局安装：

```bash
npm install --global z-clean --foreground-scripts
zclean report
```

`--foreground-scripts` 会显示 zclean 安装字标。npm 7 及以上默认隐藏 lifecycle 输出，因此普通的 `npm install -g z-clean` 仍会正常安装，但可能不显示品牌完成画面。

自动运行是可选项：

```bash
zclean init
```

`zclean init` 只会创建或保留 zclean 配置，并安装原生的每小时只读 `audit --json` 调度器。请先检查 dry-run 结果；它不会安装常驻 daemon。

从 v0.3.3 升级时，init 只会移除过去由 zclean 写入、完全匹配且不安全的 v0.3.3 Claude Code `Stop` hook。不会安装替代 hook。没有 zclean hook 是健康且完全受支持的状态。

原生调度器每小时只运行只读的 `audit --json`。它不会传入 `--yes`，也不会自动清理。`zclean init` 不会安装 provider hook。它绝不会自动调度 cache、rescue、worktree 或独立的 MCP maintenance。

## 常用命令

```bash
zclean                  # zombie process dry-run scan
zclean --yes            # 只清理 cleanupEligible confirmed-stale 候选项
zclean report           # 只读 hygiene report
zclean report --json    # 自动化 JSON report
zclean cache            # workspace cache dry-run scan
zclean cache --yes      # 删除支持的 cache directory
zclean cache --json     # 输出 cache 候选 JSON
zclean --pattern=my-agent-worker  # 为本次扫描添加 literal orphan pattern
zclean history --json   # 清理历史 JSON
zclean protect list     # 查看保护列表
zclean protect add mcp-server-keep
zclean doctor --json    # 检查安装、调度器和进程枚举状态
```

如需长期使用，请把字符串加入 `~/.zclean/config.json` 的 `customPatterns` 数组。pattern 是忽略大小写的 literal 文本，不是正则表达式；只允许 3–80 个可打印字符，并拒绝 `node`、`node /`、`ode` 等通用 runtime 名称或片段。只有 orphan 且超过 `maxAge`（默认 24 小时）的 process 才会成为候选项；无效或为零的时长会回退到安全的 24 小时默认值。whitelist、PID 再验证、dry-run 和显式 `--yes` 安全限制仍然有效。

候选 JSON 包含 `provider`、`classification`、`confidence`、已清理的 `evidence`、`cleanupEligible` 和 `blockedReasons`。只有同时满足 `classification: "confirmed-stale"` 和 `cleanupEligible: true` 的候选项才会被 `zclean --yes` 终止；suspected 或 unattributed 候选项始终保持 report-only。

扫描另一个 workspace：

```bash
zclean cache --path=/path/to/project
```

`zclean cache` 会拒绝文件系统根目录、用户 HOME、symbolic link 或 junction root。`--json` 会输出 blocked JSON report，并以非零退出码结束。

## 安全设计

- 默认 dry-run。
- runtime 清理只针对带有 `--yes` 的 `cleanupEligible` `confirmed-stale` 候选项。
- 如果父进程仍然存在，不会触碰该进程。
- 保护 tmux、screen、PM2、Forever、Docker、VS Code child process。
- kill 前会重新验证 PID identity，降低 PID recycling 风险。
- 进程枚举失败会报告错误，不会伪装成“系统干净”。
- 公开 JSON 不包含 raw process command line 和本地文件系统路径。

## 平台状态

| 平台 | 状态 |
|------|------|
| macOS | launchd scheduler、provider-neutral dry-run/cleanup |
| Linux | systemd user timer、provider-neutral dry-run/cleanup |
| Windows | Task Scheduler installer、非破坏性 CI coverage，建议运行 `zclean doctor` |

## 卸载

```bash
zclean uninstall
npm uninstall -g z-clean
```

## 许可证

MIT - [LICENSE](LICENSE)

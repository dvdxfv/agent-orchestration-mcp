# Windows 安装与配置

## DeepSeek Harness

1. 独立安装并登录 Harness。历史已测版本为 `0.2.0-rc.2`、`0.2.1-rc.2`，升级后需重新验收。
2. 设置用户环境变量 `DSH_WORKER_HARNESS_ROOT` 为安装根目录，默认 `D:/dsh`。桌面进程也必须继承该变量，配置后完整重启应用。
3. 在 Harness 的桌面 profile `~/.dsh/profiles/desktop/cordis.patch.yml` 中按现有插件格式追加下列条目，保留已有配置。先自行备份该文件，不覆盖整个 profile：

```yaml
- id: sol-desktop-worker-bridge
  name: 'D:/Projects/agent-orchestration-mcp/deepseek-worker/desktop-bridge.cjs'
```

路径须改为实际克隆位置，使用正斜杠。插件依赖内部 Host API，加载失败应检查版本与错误，不另起独立 Host 绕过。

4. 完整重启 Harness，运行 `deepseek-worker/check-compat.cmd`。检查通过仅说明接口可见。
5. 在 Codex 注册 MCP（替换实际路径）：

```powershell
codex mcp add deepseek-worker -- cmd.exe /d /c D:\Projects\agent-orchestration-mcp\scripts\deepseek-worker-mcp.cmd
```

路径包含空格时，建议使用下方 JSON 对应的客户端配置或按客户端要求引用整个命令路径，避免 cmd 多层引号问题。重新打开 Codex 会话加载工具，然后依次验证 `list_modes`、`list_workspaces`、只读任务和同会话 follow-up，并在真实 Harness 桌面查看。

```json
{
  "mcpServers": {
    "deepseek-worker": {
      "command": "D:/Apps/Harness/DeepSeek Harness.exe",
      "args": ["D:/Projects/agent-orchestration-mcp/deepseek-worker/server.mjs"],
      "env": {"ELECTRON_RUN_AS_NODE": "1", "DSH_WORKER_HARNESS_ROOT": "D:/Apps/Harness"}
    }
  }
}
```

该 JSON 表达通用 STDIO 配置，Codex `config.toml` 使用对应 TOML 结构。桌面插件的环境也必须指向同一 Harness。本仓库保留省略 mode 的历史 headless 代码路径，它还需要自建 `~/.dsh/profiles/sol-worker`；不作为快速安装入口。使用显式 mode 连接桌面。不包含历史独立 preset Host 及其第三方全量配置。

## Gemini 可见 TUI

自行安装 Gemini CLI 并完成认证。使用既有 `@lydell/node-pty` 时，设置 `GEMINI_TUI_PTY_MODULE` 为其绝对模块目录；若没有，可在自选工具环境安装该依赖并指定路径。本仓库不复制任何机器的 Gemini profile 或密钥加载脚本。

设置 `GEMINI_TUI_LAUNCHER` 为实际 PowerShell 启动脚本绝对路径。仓库的 `scripts/gemini-launcher.example.ps1` 调用 PATH 中的 `gemini`，可作为起点。`GEMINI_TUI_PWSH` 可指定 PowerShell 7 可执行文件，默认 `pwsh.exe`。宿主会向脚本传入 `--approval-mode default|plan|auto_edit`。

```powershell
$env:GEMINI_TUI_PTY_MODULE = 'D:/Tools/gemini/node_modules/@lydell/node-pty'
$env:GEMINI_TUI_LAUNCHER = 'D:/Projects/agent-orchestration-mcp/scripts/gemini-launcher.example.ps1'
node D:/Projects/agent-orchestration-mcp/gemini-tui/host.cjs plan
```

必须在用户可见的交互终端中运行，保持终端打开。MCP 不启动该宿主。

```powershell
codex mcp add gemini-tui -- node D:/Projects/agent-orchestration-mcp/gemini-tui/server.cjs
```

重新打开主控会话。先 `get_session`，检查可见终端，发送时提供真实 `session_id`。只能发送无控制字符的单行消息。发送后检查结果；输入送达不是模型完成。`send_key` 支持 enter/down/up/escape/interrupt，不代表获得自动审批授权。

## 退出与卸载

按需关闭可见 Gemini 会话；不要误关其他工作终端。`codex mcp remove deepseek-worker` 和 `codex mcp remove gemini-tui` 取消注册，不删除用户历史。要移除 Harness 桥接，删除自己追加的插件条目并在任务结束后重启桌面。不要删除完整 profile 或任务资料。

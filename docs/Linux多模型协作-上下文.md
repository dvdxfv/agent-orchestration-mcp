# Linux 多模型协作：测试结论与 MCP 设计上下文

日期：2026-11-16　环境：WSL Ubuntu（xia-laptop）　主控：Claude Code

目的：把一天的实测浓缩成新会话可直接读的上下文，用来在本仓库新增 **Linux 版**（Claude 主控 + 四个 CLI 非交互执行端）。

## 1. 四个执行端：安装与模型

| 工具 | 位置（均 Linux 原生） | 目标模型/档位 | 非交互命令（已验证） |
| --- | --- | --- | --- |
| Codex | 已装 | gpt-6.1-sol，high，fast | `codex exec -m gpt-6.1-sol -c model_reasoning_effort=high -c service_tier=priority --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -C <cwd> -o <末条输出文件> "<prompt>"` |
| OpenCode | npm 全局 | DeepSeek V4.1 Flash，max | `opencode run -m opencode/deepseek-v4.1-flash-free --variant max --auto --dir <cwd> "<prompt>"` |
| Grok | `~/.grok/bin`（`~/.local/bin` 有软链） | grok-4.7-build-fast，high | `grok -p "<prompt>" -m grok-4.7-build-fast --reasoning-effort high --permission-mode bypassPermissions --cwd <cwd>` |
| agy（Antigravity） | `~/.local/bin/agy` | gemini-4-hydrogen-high | `agy -p "<prompt>" --model gemini-4-hydrogen-high --dangerously-skip-permissions` |

- 权限全部"完全访问"；"没特别说明 fast 就是普通速度"。
- Windows 版 agy 已卸载并删除转发器，不要再装回来；`~/AI-tools/bin/_win-forward` 已去掉 agy。
- 共享工具改动记录在 `~/AI-tools/README.md`（agy 行为 Linux 原生）。
- 原型脚本：`docs/参考/dispatch.sh`（一次派一个，进程退出即完成，写 `<工具>.{out,err,status.json}`）。

## 2. 非交互实测

四个工具并行跑同一份"写一个 hello 文件"小简报，全部成功退出：

| 工具 | 耗时 | 退出码 |
| --- | --- | --- |
| OpenCode | 11 秒 | 0 |
| Grok | 13 秒 | 0 |
| Codex | 22 秒 | 0 |
| agy | 44 秒 | 0 |

结论：
- **完成 = 进程退出**，用后台 Bash 即可拿到完成通知，不用读屏幕。
- tmux + `send-keys` / `capture-pane` 能控制 TUI，但慢且脆（长提示词会吞回车，要补发；桌面应用终端标签收不到外部按键）。不作为主路径。
- 用 `</dev/null` 避免 CLI 等 stdin。

## 3. 协作流程与分工（实测有效）

| 角色 | 谁 | 做什么 |
| --- | --- | --- |
| 主控 | Claude Code | 写事实底座和简报、派活、独立验收 |
| 文案 | agy | 写长文案 |
| 标题/话题 | OpenCode（DeepSeek） | 标题、标签 |
| 审稿 | Codex | 找没依据的内容、数据与口径问题 |
| 调研/生图 | Grok | 研究、`/imagine` 无字配图（864×1152） |

测试任务：同一主题"AI 编程工具多模型协作"，写 2 篇小红书（A 干货清单体 / B 个人故事体）和 2 篇抖音图文（A 步骤卡片体 / B 经历观察体），另出 18 张配图。

关键经验：
- **先写事实底座**，文案只能用底座里的事实；审稿人是独立一角。第一稿里确实出现了编造内容，Codex 审出来，经修订再复审才过。
- **完成 ≠ 验收通过**：执行端自报"做完了"不可信，主控必须核对文件和脚本检查。
- 配图流程：Grok 出**不带文字**的插画 → HTML 叠字 → 用 Windows 的 `playwright-node` 截成 1080×1440 PNG；由 agy 做视觉验收。
- 用 Windows playwright 时必须传绝对路径，相对输出目录会落到 `C:\`。
- 两篇抖音各 9 张图，分别放在以标题命名的两个文件夹。

## 4. 发布测试（已全部下架，一条待补）

- 小红书 2 篇、抖音 2 篇均实际发布过一次用于测流程，用户随后要求全部下架。
- 已删 3 条；**抖音 A 篇那条因该账号登录态失效未删**，需重新扫码登录后再删。
- 发布端的坑（供之后做发布自动化参考）：
  - ego 的 Space 只隔离标签页，**不隔离 cookie**；多账号必须用不同个人资料。
  - 页面 geolocation 弹窗会让 ego 判定用户接管而中断脚本，需先注入 `navigator.geolocation` 打桩。
  - 小红书发布按钮是 shadow DOM 自定义元素，需按坐标点。
  - 抖音发布强制本人短信验证。
  - 话题标签只有从候选里选中才算真话题。
- ego CLI 的 `active_version_dir` 指向旧版本会导致"没安装 ego lite"，每次会话先 `ego-browser --version` 探活。

## 5. 复盘出的阻塞点（驱动 MCP 设计）

1. **派活和收结果靠读屏幕**：最大痛点，改成代码派发 + 完成通知。
2. 全局指令串味：OpenCode、Grok 非交互时会读 `~/.claude` 类全局指令，带出全局指令里的称呼等设定，要隔离。
3. 执行端越界改文件：简报说了只改指定文件，但没有机制核对。
4. 会话断开任务消失：长任务要能脱离 Claude Code 会话继续跑，之后回来接管。
5. 模型与档位没有逐一核实：Grok 非交互自述"Grok 4.7"，是否真是 `grok-4.7-build-fast` 未确认；OpenCode、agy 同样没核实。
6. 会话续接参数没测过：续跑各 CLI 的 flag 未验证。
7. 人工环节分散成多轮：要攒成一次交给用户。

## 6. 对本仓库（agent-orchestration-mcp）的分析

当前仓库：Codex 主控，DeepSeek Harness（桌面）+ 可见 Gemini TUI，**Windows 专用**，手写 stdio MCP，约 880 行。

**可直接复用**
- `deepseek-worker/manager.mjs` 的任务生命周期：持久化 `task.json`、原子写、pid 存活锁、目录冲突检测、owner / external_running / interrupted 状态、取消杀进程树、环境白名单、续跑排队。
- `server.mjs` 的 MCP 骨架：异步 `submit_task` + 限时 `get_task`（最多等 30 秒，超时不等于失败）。
- `skills/controller/SKILL.md` 的约定：主控独立验收；scope 是约束不是 ACL；完成不等于验收。
- 测试方式：fake-worker 子进程离线测试，不耗额度（`npm test`，Node ≥ 22）。

**必须换掉**
- Windows 专用部分：Harness 内部接口、`D:/` 路径、ConPTY、Windows 环境变量白名单。
- Gemini 可见 TUI 路线（送达 ≠ 完成）；改为四个非交互适配器。
- 断连即取消 → 改为任务可脱离会话。

**策略冲突（待用户拍板）**：`SKILL.md` 写"不得隐式启动 headless Gemini"，与现在"代码派发非交互"冲突。暂定：只对 agy 放开，并保留"可见模式"开关，默认可见与否由用户定。

## 7. 新 MCP 设计要点（最小版）

工具：`dispatch`（提交，立即返回 task_id）、`wait`（≤30 秒，不等于失败）、`status`、`result`、`cancel`、`list`。

- 适配器：codex / opencode / grok / agy，命令见第 1 节，统一 `</dev/null`、超时、`status.json`。
- 执行：detached 子进程，状态写盘，MCP 重连后凭 task_id 接管。
- 隔离：环境白名单要保留各 CLI 登录目录（`~/.codex`、`~/.grok`、`~/.config/opencode`、agy 的目录），并避免读到 Claude 全局指令。
- 完整版再加：范围清单 diff 检查、续跑、逐工具核实模型与档位。

估时：最小版约 1 小时，完整版 1.5 到 2 小时（估算，非实测）。

## 8. 注册与上线

- 用 `claude mcp add <name> <command> [args]` 注册，**会改配置，需用户批准**；新会话才加载工具。
- 写好并真机测通后再给命令，不擅自注册。
- 本地 `~/projects/agent-orchestration-mcp` 目前只是克隆，未提交、未改原有代码。

## 9. 相关文件位置

- 测试产物：`~/task/_临时/协作/`（文案、审查、复审、抖音图、`dispatch/test`、`发布记录.md`、`发布复盘.md`）。
- 原型脚本：`docs/参考/dispatch.sh`。
- 旧文章与图片不入库，留在临时目录。

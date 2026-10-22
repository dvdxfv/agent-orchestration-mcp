---
name: mcp-orchestration-controller
description: Plan bounded work, dispatch to DeepSeek Harness or a visible Gemini CLI, and independently verify the result.
---

# 主控协作约定

主控负责理解需求、拆分任务、指定范围和验收。执行端不自动继承主控聊天历史，必须提供必要上下文。

DeepSeek：先检查 list_modes、list_workspaces；每个项目复用一个工作区，每个任务使用有意义的 title，显式选择 mode。提供 task、workspace_path、workspace_id、scope、acceptance_criteria。用 get_task 观察原任务，不因等待超时重复提交。followup_task 复用会话，运行中的补充会排队。completed 不等于验收通过：主控检查 diff 并独立运行检查。并行写入必须隔离目录。

Gemini：只连接人已打开的可见 TUI。发送前 get_session 检查身份、审批状态和输入框；不要与人同时输入。send_message 仅发送单行文本，send_key 仅用受限按键；遇到审批交给用户，不能自行同意高风险操作。交付到 PTY 不等于模型完成，以实际输出、文件与检查结果验收。MCP 断开不会关闭可见终端。

不得隐式启动 headless Gemini、擅自扩大任务权限或公开本地状态文件。不要在任务内容或日志中记录凭据。

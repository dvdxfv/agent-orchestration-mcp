#!/usr/bin/env bash
# 用法：dispatch.sh <codex|opencode|grok|agy> <简报.md> <结果目录> [超时秒数，默认900]
# 一次只派一个工具；并行就同时起多个。进程退出即“做完了”，结果在 <结果目录>/<工具>.{out,err,status.json}
set -u
agent="${1:?agent}"; brief="$(readlink -f "${2:?brief}")"; mkdir -p "${3:?outdir}"; outdir="$(readlink -f "$3")"
tmo="${4:-900}"
cwd="${DISPATCH_CWD:-$HOME/task}"
prompt="你的代号是 ${agent}。请先完整阅读 ${brief}，严格按其中要求完成任务。只允许创建或修改简报里明确指定的文件，不要动其它任何文件。完成后用一句话汇报做了什么。"

case "$agent" in
  codex)    cmd=(codex exec -m gpt-6.1-sol -c model_reasoning_effort=high -c service_tier=priority
                 --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -C "$cwd"
                 -o "$outdir/codex.last.txt" "$prompt") ;;
  opencode) cmd=(opencode run -m opencode/deepseek-v4.1-flash-free --variant max --auto
                 --dir "$cwd" "$prompt") ;;
  grok)     cmd=(grok -p "$prompt" -m grok-4.7-build-fast --reasoning-effort high
                 --permission-mode bypassPermissions --cwd "$cwd") ;;
  agy)      cmd=(agy -p "$prompt" --model gemini-4-hydrogen-high --dangerously-skip-permissions) ;;
  *) echo "未知工具: $agent" >&2; exit 2 ;;
esac

cd "$cwd" || exit 2
start=$(date +%s)
timeout "$tmo" "${cmd[@]}" </dev/null >"$outdir/$agent.out" 2>"$outdir/$agent.err"
code=$?
secs=$(( $(date +%s) - start ))
printf '{"agent":"%s","exit":%d,"seconds":%d,"timed_out":%s}\n' "$agent" "$code" "$secs" "$([ "$code" = 124 ] && echo true || echo false)" \
  >"$outdir/$agent.status.json"
echo "[dispatch] $agent exit=$code ${secs}s"
exit "$code"

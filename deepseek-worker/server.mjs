import { createInterface } from 'node:readline';
import { TaskManager } from './manager.mjs';

const manager = new TaskManager();
const text = { type: 'string', minLength: 1 };
const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const tools = [
  { name: 'list_modes', description: 'Read and validate the four installed Harness presets: standard, ptc, minimal, cordis (创造模式). Reports broken activation instead of pretending a prompt is a mode.', inputSchema: schema({}) },
  { name: 'list_workspaces', description: 'List actual persisted Harness Workspaces and their session membership.', inputSchema: schema({}) },
  { name: 'add_workspace', description: 'Register an existing absolute directory as an actual Harness Workspace. Reuses the same canonical path without duplication. Does not create or delete files.', inputSchema: schema({ path: text, title: text }, ['path']) },
  { name: 'submit_task', description: 'Delegate actual implementation to a DeepSeek Harness Worker. It independently reads files, edits code and runs checks in the supplied workspace. Returns immediately with a task_id; use get_task to wait. Supply an independent checkout when Sol or another Worker is editing. No automatic push/deploy. Uses the existing DeepSeek account.', inputSchema: schema({ task: text, mode: { type: 'string', enum: ['standard', 'ptc', 'minimal', 'cordis'], description: 'Actual Harness preset. Omit for legacy headless execution.' }, workspace_id: text, title: { ...text, description: 'Human-readable Chinese task subject, at most 80 UTF-8 bytes.' }, workspace_path: { ...text, description: 'Absolute existing working directory. Worker uses workspace-write permissions.' }, acceptance_criteria: text, scope: text, max_time_seconds: { type: 'integer', minimum: 10, maximum: 3600, default: 900 } }, ['task', 'workspace_path', 'acceptance_criteria']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
  { name: 'get_task', description: 'Read Worker progress, tool evidence and final delivery. Optional wait up to 30 seconds; a wait timeout does not stop the Worker. A completed status means execution finished, not independent acceptance. Full logs/results are in the returned local paths.', inputSchema: schema({ task_id: text, wait_seconds: { type: 'integer', minimum: 0, maximum: 30, default: 0 } }, ['task_id']), annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'followup_task', description: 'Add instructions to the same Worker session. While running, queues a follow-up for after successful completion of the current turn. After a terminal turn, resumes the persisted session immediately. This is not a live mid-turn interruption.', inputSchema: schema({ task_id: text, instruction: text }, ['task_id', 'instruction']), annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true } },
  { name: 'cancel_task', description: 'Stop this connection\'s Worker process tree and discard queued follow-ups. Keeps modified files and logs. Reports stopping until process termination is confirmed.', inputSchema: schema({ task_id: text }, ['task_id']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'list_tasks', description: 'List current and historical Worker tasks. Historical tasks from other connections are observable; resume/cancel must use their owning connection.', inputSchema: schema({}), annotations: { readOnlyHint: true, openWorldHint: false } },
];

const write = message => process.stdout.write(JSON.stringify(message) + '\n');
let initialized = false;
async function request(message) {
  if (message.id === undefined) return;
  const response = result => write({ jsonrpc: '2.0', id: message.id, result });
  try {
    if (message.method === 'initialize') {
      initialized = true;
      const supported = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
      const version = message.params?.protocolVersion;
      return response({ protocolVersion: supported.includes(version) ? version : '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'deepseek-worker-mcp', version: '1.0.0' }, instructions: 'Sol remains the controller. Delegate bounded implementation to DeepSeek with submit_task, poll get_task, and independently verify code and tests. Use independent working directories. followup_task continues the same session; queued messages are delivered after the current turn. cancel_task terminates the Worker tree. Closing this MCP connection cancels its active Workers. Never treat Worker claims as acceptance evidence without inspection.' });
    }
    if (message.method === 'ping') return response({});
    if (!initialized) throw new Error('initialize is required');
    if (message.method === 'tools/list') return response({ tools });
    if (message.method !== 'tools/call') return write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } });
    const { name, arguments: args = {} } = message.params || {};
    let result;
    switch (name) {
      case 'list_modes': result = await manager.workspaceCommand({ operation: name }); break;
      case 'list_workspaces': result = await manager.workspaceCommand({ operation: name }); break;
      case 'add_workspace': result = await manager.workspaceCommand({ ...args, operation: name }); break;
      case 'submit_task': result = manager.submit(args); break;
      case 'get_task': result = await manager.get(args); break;
      case 'followup_task': result = manager.followup(args); break;
      case 'cancel_task': result = await manager.stop(args.task_id); break;
      case 'list_tasks': result = { tasks: manager.list() }; break;
      default: throw new Error(`Unknown tool: ${name}`);
    }
    response({ content: [{ type: 'text', text: JSON.stringify(result) }], isError: false });
  } catch (error) {
    if (message.method === 'tools/call') response({ content: [{ type: 'text', text: error.message }], isError: true });
    else write({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: error.message } });
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', line => {
  let message;
  try { message = JSON.parse(line); } catch { write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
  void request(message).catch(error => process.stderr.write(error.message + '\n'));
});
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  lines.close();
  await manager.close();
}
lines.on('close', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

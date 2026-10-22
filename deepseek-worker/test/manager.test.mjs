import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TaskManager, overlaps } from '../manager.mjs';

const fake = fileURLToPath(new URL('./fake-worker.mjs', import.meta.url));
function fixture(t, mode = 'ok') {
  const directory = mkdtempSync(join(tmpdir(), 'deepseek-worker-test-'));
  const workspace = join(directory, '工作目录');
  mkdirSync(workspace);
  const launches = [];
  const options = {
    stateDir: join(directory, 'state'),
    launch: task => {
      launches.push(task.session_id);
      return spawn(process.execPath, [fake, mode, task.session_id || 'session-test'], { cwd: workspace, windowsHide: true });
    },
    kill: async child => child.kill(),
  };
  const manager = new TaskManager(options);
  t.after(async () => { await manager.close(); rmSync(directory, { recursive: true, force: true }); });
  const submit = extra => manager.submit({ task: 'Implement the assigned change', workspace_path: workspace, acceptance_criteria: 'Run focused tests', ...extra });
  return { manager, workspace, directory, options, launches, submit };
}

test('overlapping workspace directories are detected', () => {
  assert.equal(overlaps('D:/repo', 'D:/repo/child'), true);
  assert.equal(overlaps('D:/repo', 'D:/repo-other'), false);
});

test('actual process completion and evidence are persisted, including UTF-8', async t => {
  const f = fixture(t);
  const start = f.submit();
  assert.equal(start.status, 'running');
  const result = await f.manager.get({ task_id: start.task_id, wait_seconds: 5 });
  assert.equal(result.status, 'completed');
  assert.equal(result.exit_code, 0);
  assert.equal(result.result, 'Verified 中文交付');
  assert.equal(result.tool_calls, 1);
  assert.deepEqual(result.usage, { inputTokens: 20, outputTokens: 5 });
  assert.equal(JSON.parse(readFileSync(result.task_record_path, 'utf8')).status, 'completed');
  const observer = new TaskManager(f.options);
  assert.equal((await observer.get({ task_id: start.task_id })).result, result.result);
  assert.throws(() => observer.followup({ task_id: start.task_id, instruction: 'Continue' }), /not owned/);
});

test('queued follow-up resumes the same persisted session', async t => {
  const f = fixture(t);
  const start = f.submit();
  const queued = f.manager.followup({ task_id: start.task_id, instruction: 'Extend the tests' });
  assert.equal(queued.pending_followups, 1);
  let result;
  for (let i = 0; i < 3; i++) {
    result = await f.manager.get({ task_id: start.task_id, wait_seconds: 5 });
    if (result.round === 2 && result.status === 'completed') break;
  }
  assert.equal(result.round, 2);
  assert.equal(result.status, 'completed');
  assert.deepEqual(f.launches, [null, 'session-test']);
  f.manager.followup({ task_id: start.task_id, instruction: 'Continue once more' });
  result = await f.manager.get({ task_id: start.task_id, wait_seconds: 5 });
  assert.equal(result.round, 3);
  assert.equal(result.status, 'completed');
});

test('same workspace, ancestor and other MCP connection conflicts are rejected', async t => {
  const f = fixture(t, 'hang');
  f.submit();
  assert.throws(() => f.submit(), /overlaps/);
  assert.throws(() => f.submit({ workspace_path: f.directory }), /overlaps/);
  const other = new TaskManager(f.options);
  assert.throws(() => other.submit({ task: 'other', workspace_path: f.workspace, acceptance_criteria: 'test' }), /overlaps/);
});

test('wait timeout leaves the live process running, cancellation confirms termination', async t => {
  const f = fixture(t, 'hang');
  const start = f.submit();
  const running = await f.manager.get({ task_id: start.task_id, wait_seconds: 1 });
  assert.equal(running.status, 'running');
  process.kill(running.pid, 0);
  f.manager.followup({ task_id: start.task_id, instruction: 'Queued follow-up' });
  const cancelled = await f.manager.stop(start.task_id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.pid, null);
  assert.equal(cancelled.pending_followups, 0);
  assert.equal((await f.manager.stop(start.task_id)).status, 'cancelled');
});

test('connection shutdown stops its Workers', async t => {
  const f = fixture(t, 'hang');
  const start = f.submit();
  await f.manager.close();
  assert.equal((await f.manager.get({ task_id: start.task_id })).status, 'cancelled');
});

test('execution deadline actually terminates the process and reports timed_out', async t => {
  const f = fixture(t, 'hang');
  const start = f.submit({ max_time_seconds: 10 });
  const result = await f.manager.get({ task_id: start.task_id, wait_seconds: 15 });
  assert.equal(result.status, 'timed_out');
  assert.equal(result.pid, null);
  assert.match(result.error, /Exceeded 10s/);
});

test('Worker errors and missing final events are never reported completed', async t => {
  for (const mode of ['fail', 'missing-final']) {
    const f = fixture(t, mode);
    const start = f.submit();
    const result = await f.manager.get({ task_id: start.task_id, wait_seconds: 5 });
    assert.equal(result.status, 'failed');
  }
});

test('invalid paths, empty criteria, invalid timeout are rejected before launch', t => {
  const f = fixture(t);
  assert.throws(() => f.submit({ workspace_path: 'relative' }), /absolute/);
  assert.throws(() => f.submit({ acceptance_criteria: '' }), /non-empty/);
  assert.throws(() => f.submit({ max_time_seconds: 0 }), /10 to 3600/);
  assert.equal(f.launches.length, 0);
});

test('preset workers serialize shared Harness registry across connections and release after cancellation', async t => {
  const f = fixture(t, 'hang');
  const other = new TaskManager(f.options);
  t.after(() => other.close());
  const start = f.submit({ mode: 'standard', title: '串行注册表验证' });
  assert.throws(() => other.registryLease(), /registry is busy/);
  await f.manager.stop(start.task_id);
  const release = other.registryLease();
  release();
});

test('unknown presets and oversized display titles reject before execution', t => {
  const f = fixture(t);
  assert.throws(() => f.submit({ mode: 'imaginary' }), /mode must/);
  assert.throws(() => f.submit({ title: '中文'.repeat(14) }), /80 UTF-8/);
  assert.equal(f.launches.length, 0);
});

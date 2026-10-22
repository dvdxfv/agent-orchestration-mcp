// Mount inside the desktop Host: its existing browser subscriptions see these Agents.
const { join, dirname } = require('node:path');
const { createServer } = require('node:http');
const { mkdirSync, writeFileSync, renameSync, readFileSync, unlinkSync, realpathSync } = require('node:fs');
const { randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const { loadHarness, assertHostCapabilities } = require('./harness-compat.cjs');
const endpointFile = join(__dirname, 'state', 'desktop-bridge.json');
const statusFile = join(__dirname, 'state', 'desktop-bridge-status.json');
exports.name = 'sol-desktop-worker-bridge';
exports.inject = ['agents', 'sessions', 'agentPresets', 'workspaceRegistry', 'sessionTitle', 'sessionQuery', 'tools', 'sessionController'];
exports.apply = async (ctx) => {
  let harness;
  const status = value => {
    mkdirSync(join(__dirname, 'state'), { recursive: true });
    writeFileSync(statusFile, JSON.stringify({ ...value, updated_at: new Date().toISOString() }));
  };
  try {
    // Capability discovery survives version and bundled chunk-name changes.
    harness = await loadHarness();
    assertHostCapabilities(ctx);
  } catch (error) {
    status({ status: 'incompatible', error: error.message });
    throw error;
  }
  const { installModelSelection, createUserMessage, setSandboxMode, setApprovalPolicy, projectJsonRun, compatibility } = harness;
  const token = randomBytes(32).toString('hex');
  const runs = new Map();
  const view = w => ({ workspace_id: w.id, path: w.path, title: w.title, session_ids: [...w.sessionIds] });
  const emit = (res, value) => { if (!res.destroyed) res.write(JSON.stringify(value) + '\n'); };
  let stopping = false;
  async function cancel(run) {
    run.cancelled = true;
    if (run.agent) {
      run.agent.cancel({ kind: 'user' }, { keepInbox: false });
      await run.agent.whenIdle();
    }
  }
  async function execute(req, res, request) {
    const registry = ctx.workspaceRegistry;
    if (request.operation === 'health') return emit(res, { type: 'response', transport: 'desktop-host', pid: process.pid, compatibility });
    if (request.operation === 'list_workspaces') return emit(res, { type: 'response', workspaces: registry.list().map(view) });
    if (request.operation === 'add_workspace') {
      const existing = await registry.resolveByPath(request.path);
      const workspace = existing || await registry.create(request.path, request.title);
      return emit(res, { type: 'response', workspace: view(workspace), created: !existing });
    }
    if (request.operation === 'list_modes') return emit(res, { type: 'response', ...(await ctx.agentPresets.remoteExportList()), compatibility });
    if (request.operation === 'cancel') {
      const run = runs.get(request.task_id);
      if (run) await cancel(run);
      return emit(res, { type: 'response', cancelled: !!run });
    }
    if (request.operation && request.operation !== 'run') throw new Error('Unknown desktop bridge operation');
    if (!request.task_id || runs.has(request.task_id)) throw new Error('Duplicate or missing task identity');
    if (!['standard', 'ptc', 'minimal', 'cordis'].includes(request.mode)) throw new Error('Unknown Harness preset');
    if (typeof request.prompt !== 'string' || !request.prompt.trim()) throw new Error('Empty Worker prompt');
    const cwd = realpathSync(request.workspace_path);
    const workspace = request.workspace_id ? registry.get(request.workspace_id) : await registry.resolveByPath(cwd);
    if (!workspace || realpathSync(workspace.path).toLowerCase() !== cwd.toLowerCase()) throw new Error('Worker Workspace does not match its directory');
    const run = { agent: null, cancelled: false };
    runs.set(request.task_id, run);
    const disconnected = () => { if (!res.writableEnded) cancel(run).catch(error => ctx.logger.warn(error.message)); };
    res.once('close', disconnected);
    let projection;
    try {
      const selection = { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'max' };
      const setup = async agentCtx => {
        installModelSelection(agentCtx, { current: selection, assembled: undefined });
        await ctx.agentPresets.mount(agentCtx, request.mode);
      };
      const options = { agentOptions: { provider: selection.provider, model: selection.model }, setup };
      let agent;
      if (request.session_id) {
        const observation = await ctx.sessionQuery.observeSession(request.session_id);
        try {
          if (realpathSync(observation.header.cwd).toLowerCase() !== cwd.toLowerCase() || observation.projections.values.agentPreset !== request.mode) throw new Error('Resume mode or cwd mismatch');
        } finally { observation[Symbol.dispose](); }
        agent = ctx.agents.get(request.session_id);
        if (agent && agent.status === 'running') throw new Error('Session is already executing in Harness');
        agent ||= (await ctx.agents.resume({ ...options, resumeSessionId: request.session_id })).agent;
      } else {
        agent = (await ctx.agents.create({ ...options, sessionId: `session-${randomUUID()}`, meta: { cwd, agentPreset: request.mode } })).agent;
      }
      run.agent = agent;
      await agent.whenIdle();
      if (run.cancelled || res.destroyed) return;
      // Per-session events preserve the desktop user's defaults and Worker sandbox.
      installModelSelection(agent.ctx, { current: selection, assembled: undefined });
      setSandboxMode(agent.session, 'workspace-write');
      setApprovalPolicy(agent.session, 'never');
      await workspace.attachSession(agent.id);
      if (request.title) ctx.sessionTitle.rename(agent.session, request.title);
      emit(res, { type: 'mode', mode: ctx.agentPresets.composedPreset(agent.ctx), workspace: view(workspace), transport: 'desktop-host', compatibility, selection });
      const firstSeq = agent.session.seq;
      projection = projectJsonRun(ctx, agent, res, { cwd });
      agent.followup(createUserMessage({ content: [{ type: 'text', text: request.prompt }], source: { kind: 'user' } }));
      await agent.whenIdle();
      await ctx.sessions.flush(agent.session);
      let text = '';
      for (let seq = firstSeq; seq < agent.session.seq; seq++) {
        const event = agent.session.eventAt(seq);
        if (event.type === 'assistant/message') {
          const message = event.data.message.content.filter(b => b.type === 'text').map(b => b.text).join('');
          if (message) text = message;
        }
      }
      projection.finish(text);
    } finally {
      projection?.dispose();
      res.removeListener('close', disconnected);
      runs.delete(request.task_id);
    }
  }
  const server = createServer(async (req, res) => {
    // Local authenticated machine-to-machine carrier; browser pages cannot invoke it.
    const supplied = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (stopping || req.method !== 'POST' || req.url !== '/worker' || req.headers.origin || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.writeHead(403); res.end(); return;
    }
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 250000) throw new Error('Worker request too large'); chunks.push(chunk); }
      await execute(req, res, JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch (error) { emit(res, { type: 'error', message: error.message }); }
    finally { res.end(); }
  });
  server.on('error', error => ctx.logger.error(`desktop-worker-bridge: ${error.message}`));
  server.listen(0, '127.0.0.1', () => {
    mkdirSync(dirname(endpointFile), { recursive: true });
    const temp = `${endpointFile}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify({ pid: process.pid, port: server.address().port, token, version: 1 }), { mode: 0o600 });
    renameSync(temp, endpointFile);
    status({ status: 'connected', ...compatibility });
    ctx.logger.info('DeepSeek Worker MCP 已连接桌面 Host，可实时显示任务进度');
  });
  ctx.effect(() => () => {
    stopping = true;
    for (const run of runs.values()) cancel(run).catch(() => {});
    server.close(); server.closeAllConnections();
    try { if (JSON.parse(readFileSync(endpointFile, 'utf8')).pid === process.pid) unlinkSync(endpointFile); } catch {}
    status({ status: 'stopped', ...compatibility });
  });
};

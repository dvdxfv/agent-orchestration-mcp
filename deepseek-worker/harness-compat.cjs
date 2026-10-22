const { createRequire } = require('node:module');
const { dirname, join, basename } = require('node:path');
const { readdirSync, readFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');

const testedVersions = ['0.2.0-rc.2', '0.2.1-rc.2'];

function projectionExport(source) {
  for (const match of source.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const entry of match[1].split(',')) {
      const exported = entry.trim().match(/^projectJsonRun(?:\s+as\s+([\w$]+))?$/);
      if (exported) return exported[1] || 'projectJsonRun';
    }
  }
  throw new Error('JSON stream module no longer exports projectJsonRun');
}

function assertHostCapabilities(ctx) {
  const required = {
    agents: ['create', 'resume', 'get'], sessions: ['flush'],
    agentPresets: ['mount', 'remoteExportList', 'composedPreset'],
    workspaceRegistry: ['list', 'resolveByPath', 'create', 'get'],
    sessionTitle: ['rename'], sessionQuery: ['observeSession'],
  };
  for (const [service, methods] of Object.entries(required)) {
    for (const method of methods) {
      if (typeof ctx[service]?.[method] !== 'function') throw new Error(`Harness API missing: ${service}.${method}`);
    }
  }
}

async function loadHarness(anchor = join(process.env.DSH_WORKER_HARNESS_ROOT || 'D:/dsh', 'resources/app.asar/dsh/package.json')) {
  const bundled = createRequire(anchor);
  const version = bundled('@deepseek-ai/dsh/package.json').version;
  const load = name => import(pathToFileURL(bundled.resolve(name)).href);
  try {
    const modules = await Promise.all([
      load('@deepseek-ai/dsh-agent'), load('@deepseek-ai/dsh-llm'),
      load('@deepseek-ai/dsh-sandbox-policy'), load('@deepseek-ai/dsh-user-approval'),
    ]);
    const names = ['installModelSelection', 'createUserMessage', 'setSandboxMode', 'setApprovalPolicy'];
    const api = Object.fromEntries(names.map((name, i) => [name, modules[i][name]]));
    for (const name of names) if (typeof api[name] !== 'function') throw new Error(`Harness export missing: ${name}`);
    const directory = dirname(bundled.resolve('@deepseek-ai/dsh-headless'));
    const candidates = readdirSync(directory).filter(file => /^json-stream(?:-[\w-]+)?\.js$/.test(file));
    if (candidates.length !== 1) throw new Error(`Expected one JSON stream module, found ${candidates.length}`);
    const projectionPath = join(directory, candidates[0]);
    const exportName = projectionExport(readFileSync(projectionPath, 'utf8'));
    api.projectJsonRun = (await import(pathToFileURL(projectionPath).href))[exportName];
    if (typeof api.projectJsonRun !== 'function') throw new Error('Harness projectJsonRun is not callable');
    return { ...api, compatibility: {
      harness_version: version, adapter: 'capability-v1',
      tested_version: testedVersions.includes(version), tested_versions: testedVersions,
      projection_module: basename(projectionPath),
    } };
  } catch (error) {
    throw new Error(`Harness ${version} bridge compatibility check failed: ${error.message}`);
  }
}

module.exports = { loadHarness, assertHostCapabilities, projectionExport };

const fs = require('node:fs');
const path = require('node:path');
const {stripVTControlCharacters} = require('node:util');
const stateFile = path.join(__dirname, 'tui-host-state.json');
async function request(route, body, expectedSession) {
  if (!fs.existsSync(stateFile)) throw new Error('No visible host. Run gemini-tui in the right-side terminal first. Never fall back to headless.');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  if (expectedSession && state.sessionId !== expectedSession) throw new Error('Visible session changed before delivery');
  if (!Number.isInteger(state.port) || state.port < 1 || state.port > 65535 || !Number.isInteger(state.pid)) throw new Error('Invalid host state');
  try { process.kill(state.pid, 0); } catch { throw new Error('The visible host has exited. Start gemini-tui again.'); }
  const response = await fetch(`http://127.0.0.1:${state.port}${route}`, {
    method: body ? 'POST' : 'GET', headers: {Authorization:`Bearer ${state.token}`,'Content-Type':'application/json'},
    ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(5000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  if (result.sessionId !== state.sessionId) throw new Error('Visible host identity changed');
  return result;
}
async function call(name,args={}) {
  if (name === 'get_session') {
    const result = await request('/status');
    const limit = args.max_chars ?? 6000;
    if (!Number.isInteger(limit) || limit < 0 || limit > 20000) throw new Error('max_chars must be 0..20000');
    result.output = limit ? stripVTControlCharacters(result.output).slice(-limit) : '';
    result.note = 'Output is a bounded terminal stream, not a reconstructed screen. Delivery/quietness does not prove model completion. Full native TUI remains in the visible terminal.';
    return result;
  }
  const current = await request('/status');
  if (!args.session_id || args.session_id !== current.sessionId) throw new Error('session_id must match the current visible session');
  if (name === 'send_message') {
    if (typeof args.text !== 'string' || !args.text.trim() || args.text.length > 16000 || /[\x00-\x1f\x7f]/.test(args.text)) throw new Error('Supply one nonempty line, at most 16000 characters, without controls');
    if (args.text.startsWith('/')) throw new Error('Slash commands are not messages; use close_session for exit');
    return request('/send',{text:args.text}, args.session_id);
  }
  if (name === 'send_key') {
    if (!['enter','down','up','escape','interrupt'].includes(args.key)) throw new Error('Unsupported key');
    return request('/key',{key:args.key}, args.session_id);
  }
  if (name === 'close_session') return request('/send',{text:'/quit'}, args.session_id);
  throw new Error('Unknown tool');
}
module.exports={call};

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Launch inside the visible terminal; headless mode is not supported.');
const pty = require(process.env.GEMINI_TUI_PTY_MODULE || '@lydell/node-pty');
const stateFile = path.join(__dirname, 'tui-host-state.json');
const approvalMode = process.argv[2] || 'default';
if (!['default', 'plan', 'auto_edit'].includes(approvalMode)) throw new Error('Approval mode must be default, plan, or auto_edit.');
if (fs.existsSync(stateFile)) {
  const prior = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  let alive = false; try { process.kill(prior.pid, 0); alive = true; } catch {}
  if (alive) throw new Error('A visible host is already running.');
}
const token = crypto.randomBytes(32).toString('hex');
const sessionId = crypto.randomUUID();
const env = {...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor'};
if (!process.env.GEMINI_TUI_LAUNCHER) throw new Error('Set GEMINI_TUI_LAUNCHER to an absolute PowerShell script that launches your installed Gemini CLI.');
const child = pty.spawn(process.env.GEMINI_TUI_PWSH || 'pwsh.exe', ['-NoLogo', '-NoProfile', '-File', process.env.GEMINI_TUI_LAUNCHER, '--approval-mode', approvalMode], {
  name: 'xterm-256color', cwd: process.cwd(), env,
  cols: process.stdout.columns || 120, rows: process.stdout.rows || 40,
});
let output = '', seq = 0, lastOutput = Date.now(), sending = false, closed = false;
child.onData(data => {
  seq++; lastOutput = Date.now(); output = (output + data).slice(-120000);
  if (!process.stdout.write(data)) { child.pause(); process.stdout.once('drain', () => { if (!closed) child.resume(); }); }
});
process.stdin.setRawMode(true); process.stdin.resume();
process.stdin.on('data', data => child.write(data.toString('utf8')));
process.stdout.on('resize', () => { if (!closed) child.resize(process.stdout.columns || 120, process.stdout.rows || 40); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const server = http.createServer(async (req,res) => {
  const respond = (status, body) => { res.writeHead(status, {'Content-Type':'application/json'}); res.end(JSON.stringify(body)); };
  if (req.headers.authorization !== `Bearer ${token}`) return respond(401, {error:'Unauthorized'});
  if (req.method === 'GET' && req.url === '/status') return respond(200, {sessionId,pid:process.pid,childPid:child.pid,cwd:process.cwd(),seq,lastOutput,closed,output});
  if (req.method !== 'POST' || !['/send','/key'].includes(req.url)) return respond(404,{error:'Unknown route'});
  let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 40000) return respond(413,{error:'Input too large'}); }
  try {
    const args = JSON.parse(body);
    if (closed || sending) return respond(409,{error:'Host closed or another write is in progress'});
    sending = true;
    if (req.url === '/send') {
      if (typeof args.text !== 'string' || !args.text.trim() || /[\x00-\x1f\x7f]/.test(args.text)) throw new Error('Use a nonempty single-line prompt without control characters');
      child.write('\x1b[200~' + args.text + '\x1b[201~');
      await sleep(150); child.write('\r');
    } else {
      const keys = {enter:'\r',down:'\x1b[B',up:'\x1b[A',escape:'\x1b',interrupt:'\x03'};
      if (!keys[args.key]) throw new Error('Unknown key');
      child.write(keys[args.key]);
    }
    respond(200,{sessionId,deliveredToPty:true,modelCompletionUnverified:true});
  } catch(e) { respond(400,{error:e.message}); }
  finally { sending = false; }
});
server.listen(0,'127.0.0.1',()=>fs.writeFileSync(stateFile,JSON.stringify({port:server.address().port,token,pid:process.pid,sessionId,cwd:process.cwd()}),{mode:0o600}));
function cleanup() {
  if (closed) return; closed = true;
  try { child.kill(); } catch {}
  try { const s=JSON.parse(fs.readFileSync(stateFile,'utf8')); if(s.sessionId===sessionId) fs.unlinkSync(stateFile); } catch {}
  try { process.stdin.setRawMode(false); } catch {}
  // ConPTY can enable extended keyboard modes in the outer terminal.
  // Restore normal input before returning control to PowerShell.
  try { process.stdout.write('\x1b[?9001l\x1b[<u\x1b[?2004l\x1b[?1004l'); } catch {}
  server.close();
}
child.onExit(({exitCode}) => { cleanup(); process.exit(exitCode || 0); });
process.on('exit',cleanup);
process.on('SIGTERM',()=>{cleanup();process.exit(0);});
process.on('SIGHUP',()=>{cleanup();process.exit(0);});

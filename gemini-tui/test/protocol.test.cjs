const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {spawn, spawnSync} = require('node:child_process');
const {createInterface} = require('node:readline');

test('MCP protocol, bounded output, identity checks and input rejection', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-mcp-test-'));
  for (const file of ['server.cjs', 'client.cjs']) fs.copyFileSync(path.join(__dirname, '..', file), path.join(directory, file));
  const deliveries = [];
  const host = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer mock-only');
    let body = ''; for await (const chunk of req) body += chunk;
    if (body) deliveries.push(JSON.parse(body));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url === '/status' ? {sessionId:'mock-session', closed:false, output:'hello world'} : {sessionId:'mock-session', deliveredToPty:true}));
  });
  await new Promise(resolve => host.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(path.join(directory, 'tui-host-state.json'), JSON.stringify({port:host.address().port, token:'mock-only', pid:process.pid, sessionId:'mock-session'}));
  const child = spawn(process.execPath, [path.join(directory, 'server.cjs')], {stdio:['pipe','pipe','inherit'], windowsHide:true});
  t.after(async () => {
    child.stdin.end();
    if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
    await new Promise(resolve => host.close(resolve));
    fs.rmSync(directory, {recursive:true, force:true});
  });
  let id = 0; const pending = new Map();
  createInterface({input:child.stdout}).on('line', line => { const m=JSON.parse(line); pending.get(m.id)?.(m); });
  const rpc = (method, params={}) => new Promise((resolve,reject) => {
    const key=++id; const timer=setTimeout(() => {pending.delete(key); reject(new Error('MCP timeout'));}, 5000);
    pending.set(key, value => {clearTimeout(timer); pending.delete(key); resolve(value);});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:key,method,params})+'\n');
  });
  assert.equal((await rpc('initialize')).result.serverInfo.name, 'gemini-tui');
  assert.equal((await rpc('tools/list')).result.tools.length, 4);
  const invoke = async (name,args) => (await rpc('tools/call',{name,arguments:args})).result;
  const status = await invoke('get_session',{max_chars:5});
  assert.equal(JSON.parse(status.content[0].text).output, 'world');
  assert.equal((await invoke('send_message',{session_id:'stale',text:'no'})).isError,true);
  assert.equal((await invoke('send_message',{session_id:'mock-session',text:'no\n'})).isError,true);
  assert.equal((await invoke('send_key',{session_id:'mock-session',key:'unknown'})).isError,true);
  assert.equal((await invoke('send_message',{session_id:'mock-session',text:'hello'})).isError,false);
  assert.deepEqual(deliveries, [{text:'hello'}]);
  fs.unlinkSync(path.join(directory, 'tui-host-state.json'));
  assert.equal((await invoke('get_session',{})).isError,true);
});

test('host rejects a noninteractive launch before loading native dependencies', () => {
  const result=spawnSync(process.execPath,[path.join(__dirname,'..','host.cjs')],{encoding:'utf8',windowsHide:true});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/visible terminal/);
});

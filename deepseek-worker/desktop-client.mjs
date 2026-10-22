import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const endpointFile = join(dirname(fileURLToPath(import.meta.url)), 'state', 'desktop-bridge.json');
export async function desktopRequest(request, { signal } = {}) {
  let endpoint;
  try {
    endpoint = JSON.parse(readFileSync(endpointFile, 'utf8'));
    if (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535 || !/^[a-f0-9]{64}$/.test(endpoint.token)) throw new Error('Invalid endpoint');
    process.kill(endpoint.pid, 0);
  } catch {
    let diagnostic = '';
    try {
      const status = JSON.parse(readFileSync(join(dirname(endpointFile), 'desktop-bridge-status.json'), 'utf8'));
      if (status.status === 'incompatible') diagnostic = ` 最近一次兼容检查失败（${status.updated_at}）：${status.error}`;
    } catch {}
    throw new Error(`Harness 桌面实时接入未启动。请打开或重新加载 DeepSeek Harness；升级后运行共享工具的 check-compat.cmd。${diagnostic}`);
  }
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${endpoint.port}/worker`, { method: 'POST', headers: { Authorization: `Bearer ${endpoint.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal });
  } catch (error) { throw new Error(`Harness 桌面连接中断：${error.message}`); }
  if (!response.ok) throw new Error(`Harness desktop bridge rejected request (${response.status})`);
  return response;
}
export async function desktopCommand(request) {
  const response = await desktopRequest(request, { signal: AbortSignal.timeout(25000) });
  const events = (await response.text()).split('\n').filter(Boolean).map(line => JSON.parse(line));
  const error = events.find(event => event.type === 'error');
  if (error) throw new Error(error.message);
  const result = events.find(event => event.type === 'response');
  if (!result) throw new Error('Harness bridge returned no response');
  return result;
}

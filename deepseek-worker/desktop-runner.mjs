import { desktopRequest } from './desktop-client.mjs';
import { randomUUID } from 'node:crypto';
try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  // Compatibility for a manager loaded before the live transport was installed.
  if (!request.operation) {
    request.operation = 'run';
    request.task_id ||= `legacy-${randomUUID()}`;
    request.workspace_path ||= process.cwd();
  }
  const response = await desktopRequest(request);
  let error = false, buffer = '';
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    const text = decoder.decode(chunk, { stream: true });
    process.stdout.write(text);
    buffer += text;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      if (line.trim() && JSON.parse(line).type === 'error') error = true;
    }
  }
  process.exitCode = error ? 1 : 0;
} catch (error) {
  process.stdout.write(JSON.stringify({ type: 'error', message: error.message }) + '\n');
  process.exitCode = 1;
}

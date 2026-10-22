const mode = process.argv[2];
const sessionId = process.argv[3] || 'session-test';
const event = value => process.stdout.write(JSON.stringify(value) + '\n');
process.stdin.resume();
process.stdin.on('end', () => {
  event({ type: 'session', sessionId });
  event({ type: 'tool_call', tool: 'write', callId: 'call-test', input: { file_path: 'example.txt' } });
  if (mode === 'hang') { setInterval(() => {}, 1000); return; }
  setTimeout(() => {
    if (mode === 'fail') {
      event({ type: 'status', phase: 'turn_end', reason: { kind: 'error', error: { message: 'test failure' } } });
      event({ type: 'final', text: '' });
      process.exitCode = 1;
    } else if (mode === 'missing-final') {
      event({ type: 'status', phase: 'turn_end', reason: { kind: 'completed' } });
    } else {
      event({ type: 'status', phase: 'step_end', usage: { inputTokens: 20, outputTokens: 5 } });
      event({ type: 'status', phase: 'turn_end', reason: { kind: 'completed' } });
      event({ type: 'final', text: 'Verified 中文交付' });
    }
  }, 80);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import compat from '../harness-compat.cjs';

test('projectJsonRun export discovery tolerates renamed bundler aliases', () => {
  assert.equal(compat.projectionExport('export { projectJsonRun as n, boundJsonLine as t };'), 'n');
  assert.equal(compat.projectionExport('export { projectJsonRun as renamed$1 };'), 'renamed$1');
  assert.equal(compat.projectionExport('export { projectJsonRun };'), 'projectJsonRun');
  assert.throws(() => compat.projectionExport('export { unrelated as n };'), /no longer exports/);
});

test('missing runtime service methods report the specific incompatible API', () => {
  assert.throws(() => compat.assertHostCapabilities({ agents: { create() {}, resume() {}, get() {} } }), /sessions.flush/);
  assert.throws(() => compat.assertHostCapabilities({ agents: {} }), /agents.create/);
});

// Run with Harness's Electron runtime (ELECTRON_RUN_AS_NODE=1), so ASAR imports work.
import compat from './harness-compat.cjs';
try {
  const { compatibility } = await compat.loadHarness();
  console.log(JSON.stringify({ status: 'capabilities-available', ...compatibility }, null, 2));
  if (!compatibility.tested_version) console.log('New Harness version: run a real MCP Worker and follow-up before accepting project work.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

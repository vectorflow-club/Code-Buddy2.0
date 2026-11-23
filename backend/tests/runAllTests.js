// Combined test runner: runs the wallet suite and then the integration
// suite in sequence, and exits non-zero if either suite fails.
//
// Each suite runs as its own child process so their module state stays
// isolated: the wallet suite stubs Mongoose globals in-process, while
// the integration suite boots an in-memory MongoDB replica set. A suite
// that fails does not stop the other suite from running; both results
// are reported before the runner exits.
const { spawn } = require('child_process');
const path = require('path');

const suites = [
  { name: 'wallet', file: path.join(__dirname, 'walletAllocation.test.js') },
  { name: 'integration', file: path.join(__dirname, 'integration', 'task6.integration.test.js') },
];

function runSuite(suite) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [suite.file], { stdio: 'inherit' });
    child.on('error', (err) => {
      console.error(`[runner] Could not start the ${suite.name} suite: ${err.message}`);
      resolve(1);
    });
    child.on('close', (code) => resolve(code === null ? 1 : code));
  });
}

async function main() {
  const results = [];
  for (const suite of suites) {
    console.log(`\n[runner] Running the ${suite.name} suite...\n`);
    const code = await runSuite(suite);
    results.push({ name: suite.name, code });
    if (code === 0) {
      console.log(`[runner] The ${suite.name} suite passed.`);
    } else {
      console.error(`[runner] The ${suite.name} suite failed (exit code ${code}).`);
    }
  }

  console.log('\n[runner] Summary:');
  for (const result of results) {
    console.log(`[runner]   ${result.name}: ${result.code === 0 ? 'PASS' : `FAIL (exit code ${result.code})`}`);
  }

  const failed = results.find((result) => result.code !== 0);
  if (failed) {
    process.exit(failed.code);
  }
  console.log('[runner] All suites passed.');
}

main();

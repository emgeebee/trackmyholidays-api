'use strict';

const { spawnSync } = require('child_process');
const { waitForVersion } = require('./waitForVersion');

async function main() {
  await waitForVersion();

  // A token passed in (e.g. for a manual run) is used as-is; otherwise create one.
  let createdToken;
  if (!process.env.LIVE_TEST_TOKEN) {
    const { createTestToken } = require('./testUser');
    createdToken = await createTestToken();
    console.log('Created a temporary token for the live test user.');
  }

  try {
    const result = spawnSync(
      process.execPath,
      ['--test', '--test-concurrency=1', '--test-reporter=spec', 'tests/live/**/*.test.js'],
      {
        stdio: 'inherit',
        env: { ...process.env, LIVE_TEST_TOKEN: process.env.LIVE_TEST_TOKEN || createdToken },
      }
    );
    process.exitCode = result.status === null ? 1 : result.status;
  } finally {
    if (createdToken) {
      const { deleteTestToken } = require('./testUser');
      await deleteTestToken(createdToken);
      console.log('Deleted the temporary live test token.');
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

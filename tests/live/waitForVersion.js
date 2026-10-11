'use strict';

// Blocks until the deployed API reports EXPECTED_COMMIT, so the live tests
// never run against a previous deployment.
const { api, API_URL } = require('./helpers');

const EXPECTED_COMMIT = process.env.EXPECTED_COMMIT;
const TIMEOUT_MS = Number(process.env.VERSION_TIMEOUT_MS || 120000);
const INTERVAL_MS = 5000;

async function main() {
  const deadline = Date.now() + TIMEOUT_MS;
  let last;

  while (Date.now() < deadline) {
    try {
      last = await api('/version', { token: null });
      if (last.status === 200 && (!EXPECTED_COMMIT || last.json.commit === EXPECTED_COMMIT)) {
        console.log(`Live API at ${API_URL} is running ${JSON.stringify(last.json)}`);
        return;
      }
    } catch (err) {
      last = { status: 'network error', text: err.message };
    }
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }

  console.error(
    `Deployed version never matched. Expected commit ${EXPECTED_COMMIT}, last response: ${last && last.status} ${last && last.text}`
  );
  process.exit(1);
}

main();

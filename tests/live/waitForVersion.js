'use strict';

// Resolves once the deployed API reports EXPECTED_COMMIT, so the live tests
// never run against a previous deployment.
const { api, API_URL } = require('./helpers');

const TIMEOUT_MS = Number(process.env.VERSION_TIMEOUT_MS || 120000);
const INTERVAL_MS = 5000;

async function waitForVersion(expectedCommit = process.env.EXPECTED_COMMIT) {
  const deadline = Date.now() + TIMEOUT_MS;
  let last;

  while (Date.now() < deadline) {
    try {
      last = await api('/version', { token: null });
      if (last.status === 200 && (!expectedCommit || last.json.commit === expectedCommit)) {
        console.log(`Live API at ${API_URL} is running ${JSON.stringify(last.json)}`);
        return;
      }
    } catch (err) {
      last = { status: 'network error', text: err.message };
    }
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }

  throw new Error(
    `Deployed version never matched. Expected commit ${expectedCommit}, last response: ${last && last.status} ${last && last.text}`
  );
}

module.exports = { waitForVersion };

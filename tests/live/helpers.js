'use strict';

const API_URL = (process.env.API_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.LIVE_TEST_TOKEN;
const ALLOWED_ORIGIN = 'http://localhost:3000';

if (!API_URL) {
  throw new Error('API_URL is not set, e.g. https://xxxx.execute-api.us-west-2.amazonaws.com/dev');
}

async function api(path, { method = 'GET', token = TOKEN, body, headers = {} } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }

  return { status: res.status, headers: res.headers, json, text };
}

function requireToken() {
  if (!TOKEN) {
    throw new Error(
      'LIVE_TEST_TOKEN is not set. Generate one with POST /generateToken against this stage and store it as a secret.'
    );
  }
  return TOKEN;
}

module.exports = { API_URL, ALLOWED_ORIGIN, api, requireToken };

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { api, ALLOWED_ORIGIN } = require('./helpers');

test('version endpoint is public', async () => {
  const res = await api('/version', { token: null });
  assert.equal(res.status, 200);
  assert.ok(res.json.version);
  assert.ok(res.json.commit);
});

test('protected endpoint rejects a missing token', async () => {
  const res = await api('/docs', { token: null });
  assert.equal(res.status, 401);
});

test('protected endpoint rejects an invalid token', async () => {
  const res = await api('/docs', { token: 'not-a-real-token' });
  assert.equal(res.status, 401);
});

test('CORS preflight allows a configured origin', async () => {
  const res = await api('/docs', {
    method: 'OPTIONS',
    token: null,
    headers: { Origin: ALLOWED_ORIGIN, 'Access-Control-Request-Method': 'GET' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
});

test('CORS preflight does not allow an unknown origin', async () => {
  const origin = 'https://not-allowed.example.com';
  const res = await api('/docs', {
    method: 'OPTIONS',
    token: null,
    headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
  });
  assert.notEqual(res.headers.get('access-control-allow-origin'), origin);
});

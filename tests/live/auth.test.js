'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { api, ALLOWED_ORIGIN } = require('./helpers');

describe('version', () => {
  it('GET /version is public and reports version and commit', async () => {
    const res = await api('/version', { token: null });
    assert.equal(res.status, 200, res.text);
    assert.ok(res.json.version, 'response has a version');
    assert.ok(res.json.commit, 'response has a commit');
  });
});

describe('authorizer', () => {
  it('rejects a request with no token with 401', async () => {
    const res = await api('/docs', { token: null });
    assert.equal(res.status, 401, res.text);
  });

  it('rejects a request with an invalid token with 401', async () => {
    const res = await api('/docs', { token: 'not-a-real-token' });
    assert.equal(res.status, 401, res.text);
  });
});

describe('CORS', () => {
  it('preflight allows a configured origin', async () => {
    const res = await api('/docs', {
      method: 'OPTIONS',
      token: null,
      headers: { Origin: ALLOWED_ORIGIN, 'Access-Control-Request-Method': 'GET' },
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
  });

  it('preflight does not allow an unknown origin', async () => {
    const origin = 'https://not-allowed.example.com';
    const res = await api('/docs', {
      method: 'OPTIONS',
      token: null,
      headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
    });
    assert.notEqual(res.headers.get('access-control-allow-origin'), origin);
  });

  it('responses echo a configured origin', async () => {
    const res = await api('/version', { token: null, headers: { Origin: ALLOWED_ORIGIN } });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
  });
});

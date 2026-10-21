'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { api, requireToken } = require('./helpers');

describe('long-lived tokens', () => {
  let generated;
  let expired = false;

  before(() => requireToken());

  after(async () => {
    if (generated && !expired) {
      await api('/expireToken', { method: 'POST', body: { token: generated.token } });
    }
  });

  it('POST /generateToken returns a new token with its name', async () => {
    const res = await api('/generateToken', { method: 'POST', body: { name: '  live test  ' } });
    assert.equal(res.status, 200, res.text);
    assert.ok(res.json.token, 'response has a token');
    assert.ok(res.json.sub, 'response has a sub');
    assert.ok(res.json.expiresAt, 'response has an expiresAt');
    assert.equal(res.json.name, 'live test');
    generated = res.json;
  });

  it('the generated token authenticates requests', async (t) => {
    if (!generated) return t.skip('no token was generated');
    const res = await api('/tokens', { token: generated.token });
    assert.equal(res.status, 200, res.text);
  });

  it('GET /tokens lists the generated token', async (t) => {
    if (!generated) return t.skip('no token was generated');
    const res = await api('/tokens');
    assert.equal(res.status, 200, res.text);
    const listed = res.json.tokens.find((item) => item.token === generated.token);
    assert.ok(listed, 'generated token is listed');
    assert.equal(listed.name, 'live test');
  });

  it('POST /renameToken updates the name', async (t) => {
    if (!generated) return t.skip('no token was generated');
    const res = await api('/renameToken', {
      method: 'POST',
      body: { token: generated.token, name: 'renamed' },
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.name, 'renamed');
  });

  it('GET /tokens shows the renamed token', async (t) => {
    if (!generated) return t.skip('no token was generated');
    const res = await api('/tokens');
    assert.equal(res.status, 200, res.text);
    const listed = res.json.tokens.find((item) => item.token === generated.token);
    assert.ok(listed, 'generated token is listed');
    assert.equal(listed.name, 'renamed');
  });

  it('POST /renameToken rejects a name over 64 characters', async (t) => {
    if (!generated) return t.skip('no token was generated');
    const res = await api('/renameToken', {
      method: 'POST',
      body: { token: generated.token, name: 'x'.repeat(65) },
    });
    assert.equal(res.status, 400, res.text);
  });

  it('POST /expireToken expires the generated token', async (t) => {
    if (!generated) return t.skip('no token was generated');
    const res = await api('/expireToken', { method: 'POST', body: { token: generated.token } });
    assert.equal(res.status, 200, res.text);
    expired = true;
  });

  it('GET /tokens no longer lists the expired token', async (t) => {
    if (!expired) return t.skip('the token was not expired');
    // API Gateway caches authorizer results, so the expired token may still work
    // for a few minutes; check the store instead.
    const res = await api('/tokens');
    assert.equal(res.status, 200, res.text);
    assert.ok(!res.json.tokens.some((item) => item.token === generated.token));
  });

  it('POST /expireToken returns 404 for an unknown token', async () => {
    const res = await api('/expireToken', { method: 'POST', body: { token: 'no-such-token' } });
    assert.equal(res.status, 404, res.text);
  });

  it('POST /expireToken returns 400 without a token', async () => {
    const res = await api('/expireToken', { method: 'POST', body: {} });
    assert.equal(res.status, 400, res.text);
  });
});

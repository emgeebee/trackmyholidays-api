'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { api, requireToken } = require('./helpers');

test('generate, list and expire a long-lived token', async () => {
  requireToken();

  const generated = await api('/generateToken', { method: 'POST' });
  assert.equal(generated.status, 200, generated.text);
  const { token, sub } = generated.json;
  assert.ok(token);
  assert.ok(sub);

  try {
    const usable = await api('/tokens', { token });
    assert.equal(usable.status, 200, 'newly generated token should authenticate');

    const listed = await api('/tokens');
    assert.equal(listed.status, 200, listed.text);
    assert.ok(listed.json.tokens.some((t) => t.token === token));
  } finally {
    const expired = await api('/expireToken', { method: 'POST', body: { token } });
    assert.equal(expired.status, 200, expired.text);
  }

  // API Gateway caches authorizer results, so the expired token may still work
  // for a few minutes; check the store instead.
  const after = await api('/tokens');
  assert.ok(!after.json.tokens.some((t) => t.token === token));
});

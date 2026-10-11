'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { api, requireToken } = require('./helpers');

test('holidays record can be read', async () => {
  requireToken();
  const res = await api('/holidays');
  assert.equal(res.status, 200, res.text);
});

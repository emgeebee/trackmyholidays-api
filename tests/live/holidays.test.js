'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, requireToken } = require('./helpers');

describe('holidays', () => {
  before(() => requireToken());

  it('GET /holidays returns 200', async () => {
    const res = await api('/holidays');
    assert.equal(res.status, 200, res.text);
  });
});

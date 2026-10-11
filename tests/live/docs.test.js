'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { api, requireToken } = require('./helpers');

const id = `live-test-${Date.now()}`;

after(async () => {
  await api(`/docs/${id}`, { method: 'DELETE' });
});

test('document lifecycle: create, read, list, update, delete', async () => {
  requireToken();

  const created = await api('/docs', {
    method: 'POST',
    body: { id, title: 'Live test', data: { n: 1 } },
  });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.json.id, id);

  const duplicate = await api('/docs', { method: 'POST', body: { id } });
  assert.equal(duplicate.status, 409, duplicate.text);

  const fetched = await api(`/docs/${id}`);
  assert.equal(fetched.status, 200, fetched.text);
  assert.deepEqual(fetched.json.data, { n: 1 });

  const listed = await api('/docs');
  assert.equal(listed.status, 200, listed.text);
  assert.ok(listed.json.docs.some((doc) => doc.id === id));

  const updated = await api(`/docs/${id}`, {
    method: 'PUT',
    body: { title: 'Live test updated', data: { n: 2 } },
  });
  assert.equal(updated.status, 200, updated.text);
  assert.equal(updated.json.createdAt, created.json.createdAt);
  assert.deepEqual((await api(`/docs/${id}`)).json.data, { n: 2 });

  const deleted = await api(`/docs/${id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200, deleted.text);
  assert.equal((await api(`/docs/${id}`)).status, 404);
});

test('document ids are validated', async () => {
  requireToken();
  const res = await api('/docs/bad.id');
  assert.equal(res.status, 400, res.text);
});

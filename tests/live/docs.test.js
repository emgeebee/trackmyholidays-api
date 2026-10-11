'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { api, requireToken } = require('./helpers');

describe('documents', () => {
  const id = `live-test-${Date.now()}`;
  let created;
  let deleted = false;

  before(() => requireToken());

  after(async () => {
    if (created && !deleted) {
      await api(`/docs/${id}`, { method: 'DELETE' });
    }
  });

  it('POST /docs creates a document', async () => {
    const res = await api('/docs', {
      method: 'POST',
      body: { id, title: 'Live test', data: { n: 1 } },
    });
    assert.equal(res.status, 201, res.text);
    assert.equal(res.json.id, id);
    assert.ok(res.json.createdAt, 'response has a createdAt');
    created = res.json;
  });

  it('POST /docs rejects a duplicate id with 409', async (t) => {
    if (!created) return t.skip('the document was not created');
    const res = await api('/docs', { method: 'POST', body: { id } });
    assert.equal(res.status, 409, res.text);
  });

  it('GET /docs/{id} returns the document', async (t) => {
    if (!created) return t.skip('the document was not created');
    const res = await api(`/docs/${id}`);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.title, 'Live test');
    assert.deepEqual(res.json.data, { n: 1 });
  });

  it('GET /docs lists the document', async (t) => {
    if (!created) return t.skip('the document was not created');
    const res = await api('/docs');
    assert.equal(res.status, 200, res.text);
    assert.ok(res.json.docs.some((doc) => doc.id === id));
  });

  it('PUT /docs/{id} updates the document and keeps createdAt', async (t) => {
    if (!created) return t.skip('the document was not created');
    const res = await api(`/docs/${id}`, {
      method: 'PUT',
      body: { title: 'Live test updated', data: { n: 2 } },
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.createdAt, created.createdAt);
  });

  it('GET /docs/{id} returns the updated content', async (t) => {
    if (!created) return t.skip('the document was not created');
    const res = await api(`/docs/${id}`);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.title, 'Live test updated');
    assert.deepEqual(res.json.data, { n: 2 });
  });

  it('DELETE /docs/{id} deletes the document', async (t) => {
    if (!created) return t.skip('the document was not created');
    const res = await api(`/docs/${id}`, { method: 'DELETE' });
    assert.equal(res.status, 200, res.text);
    deleted = true;
  });

  it('GET /docs/{id} returns 404 once deleted', async (t) => {
    if (!deleted) return t.skip('the document was not deleted');
    const res = await api(`/docs/${id}`);
    assert.equal(res.status, 404, res.text);
  });

  it('PUT /docs/{id} returns 404 for a missing document', async () => {
    const res = await api('/docs/live-test-missing', { method: 'PUT', body: { title: 'x' } });
    assert.equal(res.status, 404, res.text);
  });

  it('GET /docs/{id} rejects an invalid id with 400', async () => {
    const res = await api('/docs/bad.id');
    assert.equal(res.status, 400, res.text);
  });
});

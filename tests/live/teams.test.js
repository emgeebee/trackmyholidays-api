'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { api, requireToken } = require('./helpers');

let createdTeamId = null;
let createdSubTeamId = null;
let inviteId = null;

describe('teams', () => {
  before(() => requireToken());

  after(async () => {
    if (createdSubTeamId) {
      try {
        await api(`/api/teams/${createdSubTeamId}`, { method: 'DELETE' });
      } catch (e) {
        console.log('cleanup: could not delete sub-team');
      }
    }
    if (createdTeamId) {
      try {
        await api(`/api/teams/${createdTeamId}`, { method: 'DELETE' });
      } catch (e) {
        console.log('cleanup: could not delete team');
      }
    }
  });

  it('GET /api/teams returns 200', async () => {
    const res = await api('/api/teams');
    assert.equal(res.status, 200, res.text);
    const body = await res.json();
    assert.ok(Array.isArray(body.teams), 'response should have teams array');
  });

  it('POST /api/teams creates a team', async () => {
    const res = await api('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Team' }),
    });
    assert.equal(res.status, 200, res.text);
    const body = await res.json();
    assert.ok(body.team, 'response should have team');
    assert.equal(body.team.name, 'Test Team');
    assert.ok(body.team.id, 'team should have id');
    createdTeamId = body.team.id;
  });

  it('PATCH /api/teams/{id} updates a team', async () => {
    const res = await api(`/api/teams/${createdTeamId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Test Team' }),
    });
    assert.equal(res.status, 200, res.text);
    const body = await res.json();
    assert.equal(body.team.name, 'Updated Test Team');
  });

  it('POST /api/teams creates a sub-team', async () => {
    const res = await api('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Sub Team', parentId: createdTeamId }),
    });
    assert.equal(res.status, 200, res.text);
    const body = await res.json();
    assert.equal(body.team.name, 'Sub Team');
    assert.equal(body.team.parentId, createdTeamId);
    createdSubTeamId = body.team.id;
  });

  it('GET /api/teams/{id}/members returns team members', async () => {
    const res = await api(`/api/teams/${createdTeamId}/members`);
    assert.equal(res.status, 200, res.text);
    const body = await res.json();
    assert.ok(Array.isArray(body.members), 'response should have members array');
    assert.ok(body.members.length >= 1, 'team should have at least the creator');
  });

  it('POST /api/teams/invite creates an invitation', async () => {
    const res = await api('/api/teams/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        teamIds: [createdTeamId],
        role: 'member',
      }),
    });
    assert.equal(res.status, 200, res.text);
    const body = await res.json();
    assert.ok(body.success);
    assert.ok(body.inviteId);
    inviteId = body.inviteId;
  });

  it('GET /api/teams/invites/pending returns pending invitations', async () => {
    const res = await api('/api/teams/invites/pending');
    assert.equal(res.status, 200, res.text);
    const body = await res.json();
    assert.ok(Array.isArray(body.invites), 'response should have invites array');
  });

  it('GET /api/teams/holidays returns team holidays', async () => {
    const res = await api('/api/teams/holidays');
    assert.equal(res.status, 200, res.text);
    const body = await res.json();
    assert.ok(Array.isArray(body.members), 'response should have members array');
    assert.ok(Array.isArray(body.teams), 'response should have teams array');
    assert.ok(Array.isArray(body.holidays), 'response should have holidays array');
    
    const bankHolidays = body.holidays.filter(h => h.type === 'bank-holiday');
    assert.ok(bankHolidays.length > 0, 'should include bank holidays');
  });

  it('GET /api/teams/holidays with teamId filter', async () => {
    const res = await api(`/api/teams/holidays?teamId=${createdTeamId}`);
    assert.equal(res.status, 200, res.text);
    const body = await res.json();
    assert.ok(Array.isArray(body.holidays), 'response should have holidays array');
  });

  it('DELETE /api/teams/{id} fails with sub-teams', async () => {
    const res = await api(`/api/teams/${createdTeamId}`, { method: 'DELETE' });
    assert.equal(res.status, 400, 'should not allow deleting team with sub-teams');
  });

  it('DELETE /api/teams/{id} succeeds after deleting sub-team', async () => {
    await api(`/api/teams/${createdSubTeamId}`, { method: 'DELETE' });
    createdSubTeamId = null;
    
    const res = await api(`/api/teams/${createdTeamId}`, { method: 'DELETE' });
    assert.equal(res.status, 200, res.text);
    const body = await res.json();
    assert.ok(body.success);
    createdTeamId = null;
  });
});

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
    assert.ok(Array.isArray(res.json.teams), 'response should have teams array');
  });

  it('POST /api/teams creates a team', async () => {
    const res = await api('/api/teams', {
      method: 'POST',
      body: { name: 'Test Team' },
    });
    assert.equal(res.status, 200, res.text);
    assert.ok(res.json.team, 'response should have team');
    assert.equal(res.json.team.name, 'Test Team');
    assert.ok(res.json.team.id, 'team should have id');
    createdTeamId = res.json.team.id;
  });

  it('PATCH /api/teams/{id} updates a team', async () => {
    const res = await api(`/api/teams/${createdTeamId}`, {
      method: 'PATCH',
      body: { name: 'Updated Test Team' },
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.team.name, 'Updated Test Team');
  });

  it('POST /api/teams creates a sub-team', async () => {
    const res = await api('/api/teams', {
      method: 'POST',
      body: { name: 'Sub Team', parentId: createdTeamId },
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.team.name, 'Sub Team');
    assert.equal(res.json.team.parentId, createdTeamId);
    createdSubTeamId = res.json.team.id;
  });

  it('GET /api/teams/{id}/members returns team members', async () => {
    const res = await api(`/api/teams/${createdTeamId}/members`);
    assert.equal(res.status, 200, res.text);
    assert.ok(Array.isArray(res.json.members), 'response should have members array');
    assert.ok(res.json.members.length >= 1, 'team should have at least the creator');
  });

  it('POST /api/teams/invite creates an invitation', async () => {
    const res = await api('/api/teams/invite', {
      method: 'POST',
      body: {
        email: 'test@example.com',
        teamIds: [createdTeamId],
        role: 'member',
      },
    });
    assert.equal(res.status, 200, res.text);
    assert.ok(res.json.success);
    assert.ok(res.json.inviteId);
    inviteId = res.json.inviteId;
  });

  it('GET /api/teams/invites/pending returns pending invitations', async () => {
    const res = await api('/api/teams/invites/pending');
    assert.equal(res.status, 200, res.text);
    assert.ok(Array.isArray(res.json.invites), 'response should have invites array');
  });

  it('GET /api/teams/holidays returns team holidays', async () => {
    const res = await api('/api/teams/holidays');
    assert.equal(res.status, 200, res.text);
    assert.ok(Array.isArray(res.json.members), 'response should have members array');
    assert.ok(Array.isArray(res.json.teams), 'response should have teams array');
    assert.ok(Array.isArray(res.json.holidays), 'response should have holidays array');
    
    const bankHolidays = res.json.holidays.filter(h => h.type === 'bank-holiday');
    assert.ok(bankHolidays.length > 0, 'should include bank holidays');
  });

  it('GET /api/teams/holidays with teamId filter', async () => {
    if (!createdTeamId) {
      console.log('Skipping: no team created');
      return;
    }
    const res = await api(`/api/teams/holidays?teamId=${createdTeamId}`);
    assert.equal(res.status, 200, res.text);
    assert.ok(Array.isArray(res.json.holidays), 'response should have holidays array');
  });

  it('DELETE /api/teams/{id} fails with sub-teams', async () => {
    const res = await api(`/api/teams/${createdTeamId}`, { method: 'DELETE' });
    assert.equal(res.status, 400, 'should not allow deleting team with sub-teams');
  });

  it('DELETE /api/teams/{id} succeeds after deleting sub-team', async () => {
    const deleteSubRes = await api(`/api/teams/${createdSubTeamId}`, { method: 'DELETE' });
    assert.equal(deleteSubRes.status, 200, 'should delete sub-team');
    createdSubTeamId = null;
    
    const res = await api(`/api/teams/${createdTeamId}`, { method: 'DELETE' });
    assert.equal(res.status, 200, res.text);
    assert.ok(res.json.success);
    createdTeamId = null;
  });
});

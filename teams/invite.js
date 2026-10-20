'use strict';

const { randomUUID } = require('crypto');
const inviteStore = require('./inviteStore');
const memberStore = require('./memberStore');
const teamStore = require('./teamStore');
const { getUserIdFromEvent, corsHeaders } = require('../holidays/authorizer');

module.exports.invite = async (event) => {
  const userId = getUserIdFromEvent(event);
  
  if (!userId) {
    return {
      statusCode: 401,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { email, teamIds, role } = body;

    if (!email || !teamIds || !Array.isArray(teamIds) || teamIds.length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders(event),
        body: JSON.stringify({ error: 'Email and teamIds are required' }),
      };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return {
        statusCode: 400,
        headers: corsHeaders(event),
        body: JSON.stringify({ error: 'Invalid email address' }),
      };
    }

    for (const teamId of teamIds) {
      const team = await teamStore.getTeam(teamId);
      if (!team) {
        return {
          statusCode: 404,
          headers: corsHeaders(event),
          body: JSON.stringify({ error: `Team ${teamId} not found` }),
        };
      }

      const memberships = await memberStore.getMembershipsByUser(userId);
      const membership = memberships.find(m => m.teamId === teamId && m.status === 'active');
      
      if (!membership || membership.role !== 'admin') {
        return {
          statusCode: 403,
          headers: corsHeaders(event),
          body: JSON.stringify({ error: 'You must be an admin to invite members' }),
        };
      }
    }

    const inviteId = randomUUID();
    const invite = await inviteStore.createInvite(
      inviteId,
      email,
      teamIds,
      role || 'member',
      userId
    );

    for (const teamId of teamIds) {
      const membershipId = randomUUID();
      await memberStore.addMember(
        membershipId,
        inviteId,
        teamId,
        role || 'member',
        email,
        null,
        null
      );
    }

    return {
      statusCode: 200,
      headers: corsHeaders(event),
      body: JSON.stringify({
        success: true,
        inviteId: invite.id,
      }),
    };
  } catch (error) {
    console.error('Error creating invite:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'Failed to create invite' }),
    };
  }
};

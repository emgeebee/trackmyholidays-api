'use strict';

const { randomUUID } = require('crypto');
const teamStore = require('./teamStore');
const memberStore = require('./memberStore');
const { getUserIdFromEvent, corsHeaders, getAuthenticatedIdentity } = require('../holidays/authorizer');

module.exports.create = async (event) => {
  const userId = getUserIdFromEvent(event);
  const identity = getAuthenticatedIdentity(event);
  
  if (!userId) {
    return {
      statusCode: 401,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { name, parentId } = body;

    if (!name || typeof name !== 'string') {
      return {
        statusCode: 400,
        headers: corsHeaders(event),
        body: JSON.stringify({ error: 'Team name is required' }),
      };
    }

    if (parentId) {
      const parentTeam = await teamStore.getTeam(parentId);
      if (!parentTeam) {
        return {
          statusCode: 404,
          headers: corsHeaders(event),
          body: JSON.stringify({ error: 'Parent team not found' }),
        };
      }

      const memberships = await memberStore.getMembershipsByUser(userId);
      const parentMembership = memberships.find(m => m.teamId === parentId && m.status === 'active');
      
      if (!parentMembership || parentMembership.role !== 'admin') {
        return {
          statusCode: 403,
          headers: corsHeaders(event),
          body: JSON.stringify({ error: 'You must be an admin of the parent team' }),
        };
      }
    }

    const teamId = randomUUID();
    const team = await teamStore.createTeam(teamId, name, parentId || null, userId);

    const membershipId = randomUUID();
    await memberStore.addMember(
      membershipId,
      userId,
      teamId,
      'admin',
      identity.email,
      identity.name,
      null
    );
    await memberStore.acceptInvitation(membershipId);

    const memberIds = [userId];

    return {
      statusCode: 200,
      headers: corsHeaders(event),
      body: JSON.stringify({
        team: {
          ...team,
          memberIds,
        },
      }),
    };
  } catch (error) {
    console.error('Error creating team:', error);
    
    if (error.name === 'ConditionalCheckFailedException') {
      return {
        statusCode: 409,
        headers: corsHeaders(event),
        body: JSON.stringify({ error: 'Team already exists' }),
      };
    }
    
    return {
      statusCode: 500,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'Failed to create team' }),
    };
  }
};

'use strict';

const teamStore = require('./teamStore');
const memberStore = require('./memberStore');
const { getUserIdFromEvent, corsHeaders } = require('../holidays/authorizer');

module.exports.update = async (event) => {
  const userId = getUserIdFromEvent(event);
  
  if (!userId) {
    return {
      statusCode: 401,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  const teamId = event.pathParameters.id;

  try {
    const team = await teamStore.getTeam(teamId);
    if (!team) {
      return {
        statusCode: 404,
        headers: corsHeaders(event),
        body: JSON.stringify({ error: 'Team not found' }),
      };
    }

    const memberships = await memberStore.getMembershipsByUser(userId);
    const membership = memberships.find(m => m.teamId === teamId && m.status === 'active');
    
    if (!membership || membership.role !== 'admin') {
      return {
        statusCode: 403,
        headers: corsHeaders(event),
        body: JSON.stringify({ error: 'Only admins can update teams' }),
      };
    }

    const body = JSON.parse(event.body);
    const { name } = body;

    if (!name || typeof name !== 'string') {
      return {
        statusCode: 400,
        headers: corsHeaders(event),
        body: JSON.stringify({ error: 'Team name is required' }),
      };
    }

    const updatedTeam = await teamStore.updateTeam(teamId, name);

    const teamMemberships = await memberStore.getMembershipsByTeam(teamId);
    const activeMemberIds = teamMemberships
      .filter(m => m.status === 'active')
      .map(m => m.userId);

    return {
      statusCode: 200,
      headers: corsHeaders(event),
      body: JSON.stringify({
        team: {
          ...updatedTeam,
          memberIds: activeMemberIds,
        },
      }),
    };
  } catch (error) {
    console.error('Error updating team:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'Failed to update team' }),
    };
  }
};

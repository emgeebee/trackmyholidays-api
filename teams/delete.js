'use strict';

const teamStore = require('./teamStore');
const memberStore = require('./memberStore');
const { getUserIdFromEvent, corsHeaders } = require('../holidays/authorizer');

module.exports.delete = async (event) => {
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
        body: JSON.stringify({ error: 'Only admins can delete teams' }),
      };
    }

    const childTeams = await teamStore.getTeamsByParent(teamId);
    if (childTeams.length > 0) {
      return {
        statusCode: 400,
        headers: corsHeaders(event),
        body: JSON.stringify({ error: 'Cannot delete team with sub-teams' }),
      };
    }

    const teamMemberships = await memberStore.getMembershipsByTeam(teamId);
    await Promise.all(
      teamMemberships.map(m => memberStore.removeMember(m.id))
    );

    await teamStore.deleteTeam(teamId);

    return {
      statusCode: 200,
      headers: corsHeaders(event),
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    console.error('Error deleting team:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'Failed to delete team' }),
    };
  }
};

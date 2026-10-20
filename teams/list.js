'use strict';

const teamStore = require('./teamStore');
const memberStore = require('./memberStore');
const { getUserIdFromEvent, corsHeaders } = require('../holidays/authorizer');

module.exports.list = async (event) => {
  const userId = getUserIdFromEvent(event);
  
  if (!userId) {
    return {
      statusCode: 401,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  try {
    const memberships = await memberStore.getMembershipsByUser(userId);
    const activeTeamIds = memberships
      .filter(m => m.status === 'active')
      .map(m => m.teamId);

    const teams = await Promise.all(
      activeTeamIds.map(id => teamStore.getTeam(id))
    );

    const teamsWithMembers = await Promise.all(
      teams.filter(t => t != null).map(async (team) => {
        const teamMemberships = await memberStore.getMembershipsByTeam(team.id);
        const activeMemberIds = teamMemberships
          .filter(m => m.status === 'active')
          .map(m => m.userId);
        
        return {
          ...team,
          memberIds: activeMemberIds,
        };
      })
    );

    return {
      statusCode: 200,
      headers: corsHeaders(event),
      body: JSON.stringify({ teams: teamsWithMembers }),
    };
  } catch (error) {
    console.error('Error listing teams:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'Failed to list teams' }),
    };
  }
};

'use strict';

const memberStore = require('./memberStore');
const teamStore = require('./teamStore');
const { getUserIdFromEvent, corsHeaders } = require('../holidays/authorizer');

module.exports.getMembers = async (event) => {
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

    const userMemberships = await memberStore.getMembershipsByUser(userId);
    const userMembership = userMemberships.find(m => m.teamId === teamId && m.status === 'active');
    
    if (!userMembership) {
      return {
        statusCode: 403,
        headers: corsHeaders(event),
        body: JSON.stringify({ error: 'You are not a member of this team' }),
      };
    }

    const memberships = await memberStore.getMembershipsByTeam(teamId);
    
    const membersMap = new Map();
    for (const membership of memberships) {
      if (membership.status === 'active') {
        const existing = membersMap.get(membership.userId);
        if (!existing) {
          membersMap.set(membership.userId, {
            id: membership.userId,
            email: membership.email,
            name: membership.name,
            picture: membership.picture,
            role: membership.role,
            teamIds: [teamId],
          });
        }
      }
    }

    const members = Array.from(membersMap.values());

    return {
      statusCode: 200,
      headers: corsHeaders(event),
      body: JSON.stringify({ members }),
    };
  } catch (error) {
    console.error('Error getting team members:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'Failed to get team members' }),
    };
  }
};

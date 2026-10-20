'use strict';

const memberStore = require('./memberStore');
const teamStore = require('./teamStore');
const { getUserIdFromEvent, corsHeaders } = require('../holidays/authorizer');

module.exports.removeMember = async (event) => {
  const userId = getUserIdFromEvent(event);
  
  if (!userId) {
    return {
      statusCode: 401,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  const teamId = event.pathParameters.id;
  const memberIdToRemove = event.pathParameters.memberId;

  try {
    const team = await teamStore.getTeam(teamId);
    if (!team) {
      return {
        statusCode: 404,
        headers: corsHeaders(event),
        body: JSON.stringify({ error: 'Team not found' }),
      };
    }

    const isSelfRemoval = userId === memberIdToRemove;

    if (!isSelfRemoval) {
      const userMemberships = await memberStore.getMembershipsByUser(userId);
      const userMembership = userMemberships.find(m => m.teamId === teamId && m.status === 'active');
      
      if (!userMembership || userMembership.role !== 'admin') {
        return {
          statusCode: 403,
          headers: corsHeaders(event),
          body: JSON.stringify({ error: 'Only admins can remove other members' }),
        };
      }
    }

    const memberMemberships = await memberStore.getMembershipsByUser(memberIdToRemove);
    const membershipToRemove = memberMemberships.find(m => m.teamId === teamId && m.status === 'active');
    
    if (!membershipToRemove) {
      return {
        statusCode: 404,
        headers: corsHeaders(event),
        body: JSON.stringify({ error: 'Member not found in this team' }),
      };
    }

    const allTeamMemberships = await memberStore.getMembershipsByTeam(teamId);
    const activeAdmins = allTeamMemberships.filter(m => m.status === 'active' && m.role === 'admin');
    
    if (membershipToRemove.role === 'admin' && activeAdmins.length === 1) {
      return {
        statusCode: 400,
        headers: corsHeaders(event),
        body: JSON.stringify({ error: 'Cannot remove the last admin of a team' }),
      };
    }

    await memberStore.removeMember(membershipToRemove.id);

    return {
      statusCode: 200,
      headers: corsHeaders(event),
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    console.error('Error removing member:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'Failed to remove member' }),
    };
  }
};

'use strict';

const inviteStore = require('./inviteStore');
const teamStore = require('./teamStore');
const { getUserIdFromEvent, corsHeaders, getAuthenticatedIdentity } = require('../holidays/authorizer');

module.exports.getPendingInvites = async (event) => {
  const userId = getUserIdFromEvent(event);
  const identity = getAuthenticatedIdentity(event);
  
  if (!userId) {
    return {
      statusCode: 401,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  if (!identity.email) {
    return {
      statusCode: 400,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'Email not available from token' }),
    };
  }

  try {
    const invites = await inviteStore.getInvitesByEmail(identity.email);
    
    const now = new Date();
    const pendingInvites = invites.filter(invite => {
      if (invite.status !== 'pending') return false;
      const expiresAt = new Date(invite.expiresAt);
      return now <= expiresAt;
    });

    const invitesWithTeams = await Promise.all(
      pendingInvites.map(async (invite) => {
        const teams = await Promise.all(
          invite.teamIds.map(id => teamStore.getTeam(id))
        );
        return {
          ...invite,
          teams: teams.filter(t => t != null),
        };
      })
    );

    return {
      statusCode: 200,
      headers: corsHeaders(event),
      body: JSON.stringify({ invites: invitesWithTeams }),
    };
  } catch (error) {
    console.error('Error getting pending invites:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'Failed to get pending invites' }),
    };
  }
};

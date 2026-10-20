'use strict';

const inviteStore = require('./inviteStore');
const memberStore = require('./memberStore');
const { getUserIdFromEvent, corsHeaders, getAuthenticatedIdentity } = require('../holidays/authorizer');

module.exports.acceptInvite = async (event) => {
  const userId = getUserIdFromEvent(event);
  const identity = getAuthenticatedIdentity(event);
  
  if (!userId) {
    return {
      statusCode: 401,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  const inviteId = event.pathParameters.inviteId;

  try {
    const invite = await inviteStore.getInvite(inviteId);
    
    if (!invite) {
      return {
        statusCode: 404,
        headers: corsHeaders(event),
        body: JSON.stringify({ error: 'Invite not found' }),
      };
    }

    if (invite.status !== 'pending') {
      return {
        statusCode: 400,
        headers: corsHeaders(event),
        body: JSON.stringify({ error: 'Invite has already been accepted or expired' }),
      };
    }

    if (identity.email && invite.email.toLowerCase() !== identity.email.toLowerCase()) {
      return {
        statusCode: 403,
        headers: corsHeaders(event),
        body: JSON.stringify({ error: 'This invite is for a different email address' }),
      };
    }

    const now = new Date();
    const expiresAt = new Date(invite.expiresAt);
    if (now > expiresAt) {
      return {
        statusCode: 400,
        headers: corsHeaders(event),
        body: JSON.stringify({ error: 'Invite has expired' }),
      };
    }

    const memberships = await memberStore.getMembershipsByUser(inviteId);
    
    for (const membership of memberships) {
      await memberStore.removeMember(membership.id);
      
      const { randomUUID } = require('crypto');
      const newMembershipId = randomUUID();
      await memberStore.addMember(
        newMembershipId,
        userId,
        membership.teamId,
        membership.role,
        identity.email,
        identity.name,
        null
      );
      await memberStore.acceptInvitation(newMembershipId);
    }

    await inviteStore.acceptInvite(inviteId);

    return {
      statusCode: 200,
      headers: corsHeaders(event),
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    console.error('Error accepting invite:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'Failed to accept invite' }),
    };
  }
};

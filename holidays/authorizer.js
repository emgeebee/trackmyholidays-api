'use strict';

// User id from the verified Authorization bearer token only (set by authFunc).
function getAuthenticatedUserId(event) {
  const authorizer =
    event.requestContext && event.requestContext.authorizer
      ? event.requestContext.authorizer
      : {};

  return authorizer.uid || authorizer.principalId || null;
}

function getUserIdFromEvent(event) {
  return getAuthenticatedUserId(event);
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Credentials': true,
  };
}

module.exports = {
  getAuthenticatedUserId,
  getUserIdFromEvent,
  corsHeaders,
};

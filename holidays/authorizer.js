'use strict';

const allowedOrigins = require('../config/allowedOrigins.json');

// User id from the verified Authorization bearer token only (set by authFunc).
function getAuthenticatedUserId(event) {
  const authorizer =
    event.requestContext && event.requestContext.authorizer
      ? event.requestContext.authorizer
      : {};

  return authorizer.uid || authorizer.principalId || null;
}

function getAuthenticatedIdentity(event) {
  const authorizer =
    event.requestContext && event.requestContext.authorizer
      ? event.requestContext.authorizer
      : {};

  return {
    uid: getAuthenticatedUserId(event),
    email: authorizer.email || null,
    name: authorizer.name || null,
  };
}

function getUserIdFromEvent(event) {
  return getAuthenticatedUserId(event);
}

function corsHeaders(event) {
  const headers = (event && event.headers) || {};
  const origin = headers.origin || headers.Origin;

  const result = {
    'Content-Type': 'application/json',
    Vary: 'Origin',
  };

  if (origin && allowedOrigins.includes(origin)) {
    result['Access-Control-Allow-Origin'] = origin;
    result['Access-Control-Allow-Credentials'] = true;
  }

  return result;
}

module.exports = {
  getAuthenticatedUserId,
  getAuthenticatedIdentity,
  getUserIdFromEvent,
  corsHeaders,
};

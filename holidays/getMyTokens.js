'use strict';

const { getAuthenticatedUserId, corsHeaders } = require('./authorizer');
const tokenStore = require('./tokenStore');

module.exports.getMyTokens = async (event, context, callback) => {
  // No query, path, or body params are read — user id comes from the bearer token only.
  const userid = getAuthenticatedUserId(event);

  if (!userid) {
    callback(null, {
      statusCode: 401,
      headers: corsHeaders(),
      body: JSON.stringify({ message: 'Unauthorized: no user subject found.' }),
    });
    return;
  }

  try {
    const tokens = await tokenStore.getTokensForUser(userid);
    callback(null, {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ tokens }),
    });
  } catch (err) {
    console.error(err);
    callback(null, {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ message: 'Failed to fetch tokens.' }),
    });
  }
};

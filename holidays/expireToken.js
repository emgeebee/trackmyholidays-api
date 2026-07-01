'use strict';

const { getUserIdFromEvent, corsHeaders } = require('./authorizer');
const tokenStore = require('./tokenStore');

module.exports.expireToken = async (event, context, callback) => {
  const userid = getUserIdFromEvent(event);

  if (!userid) {
    callback(null, {
      statusCode: 401,
      headers: corsHeaders(),
      body: JSON.stringify({ message: 'Unauthorized: no user subject found.' }),
    });
    return;
  }

  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch (err) {
    callback(null, {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ message: 'Invalid request body.' }),
    });
    return;
  }

  if (!body.token || typeof body.token !== 'string') {
    callback(null, {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ message: 'Missing token in request body.' }),
    });
    return;
  }

  try {
    const result = await tokenStore.expireToken(body.token, userid);

    if (!result.ok) {
      callback(null, {
        statusCode: result.statusCode,
        headers: corsHeaders(),
        body: JSON.stringify({ message: result.message }),
      });
      return;
    }

    callback(null, {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ message: 'Token expired.' }),
    });
  } catch (err) {
    console.error(err);
    callback(null, {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ message: 'Failed to expire token.' }),
    });
  }
};

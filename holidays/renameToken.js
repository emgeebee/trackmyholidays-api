'use strict';

const { getUserIdFromEvent, corsHeaders } = require('./authorizer');
const tokenStore = require('./tokenStore');

module.exports.renameToken = async (event, context, callback) => {
  const userid = getUserIdFromEvent(event);

  if (!userid) {
    callback(null, {
      statusCode: 401,
      headers: corsHeaders(event),
      body: JSON.stringify({ message: 'Unauthorized: no user subject found.' }),
    });
    return;
  }

  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch (err) {
    body = null;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    callback(null, {
      statusCode: 400,
      headers: corsHeaders(event),
      body: JSON.stringify({ message: 'Invalid request body.' }),
    });
    return;
  }

  if (!body.token || typeof body.token !== 'string') {
    callback(null, {
      statusCode: 400,
      headers: corsHeaders(event),
      body: JSON.stringify({ message: 'Missing token in request body.' }),
    });
    return;
  }

  const tokenName = tokenStore.normaliseTokenName(body.name, { required: true });
  if (!tokenName.ok) {
    callback(null, {
      statusCode: 400,
      headers: corsHeaders(event),
      body: JSON.stringify({ message: tokenName.message }),
    });
    return;
  }

  try {
    const result = await tokenStore.renameToken(body.token, userid, tokenName.name);

    if (!result.ok) {
      callback(null, {
        statusCode: result.statusCode,
        headers: corsHeaders(event),
        body: JSON.stringify({ message: result.message }),
      });
      return;
    }

    callback(null, {
      statusCode: 200,
      headers: corsHeaders(event),
      body: JSON.stringify({ name: result.name }),
    });
  } catch (err) {
    console.error(err);
    callback(null, {
      statusCode: 500,
      headers: corsHeaders(event),
      body: JSON.stringify({ message: 'Failed to rename token.' }),
    });
  }
};

'use strict';

const { getAuthenticatedUserId, corsHeaders } = require('../authorizer');
const docStore = require('./docStore');

module.exports.list = async (event, context, callback) => {
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
    const docs = await docStore.listDocs(userid);
    callback(null, {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ docs }),
    });
  } catch (err) {
    console.error(err);
    callback(null, {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ message: 'Failed to list documents.' }),
    });
  }
};

'use strict';

const { getAuthenticatedUserId, corsHeaders } = require('../authorizer');
const docStore = require('./docStore');

module.exports.get = async (event, context, callback) => {
  const userid = getAuthenticatedUserId(event);

  if (!userid) {
    callback(null, {
      statusCode: 401,
      headers: corsHeaders(),
      body: JSON.stringify({ message: 'Unauthorized: no user subject found.' }),
    });
    return;
  }

  const id = event.pathParameters && event.pathParameters.id;
  if (!docStore.validateDocId(id)) {
    callback(null, {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ message: 'Invalid document id.' }),
    });
    return;
  }

  try {
    const doc = await docStore.getDoc(userid, id);
    if (!doc) {
      callback(null, {
        statusCode: 404,
        headers: corsHeaders(),
        body: JSON.stringify({ message: 'Document not found.' }),
      });
      return;
    }

    callback(null, {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify(doc),
    });
  } catch (err) {
    console.error(err);
    callback(null, {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ message: 'Failed to fetch document.' }),
    });
  }
};

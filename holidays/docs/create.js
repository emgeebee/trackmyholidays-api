'use strict';

const uuid = require('uuid');
const { getAuthenticatedUserId, corsHeaders } = require('../authorizer');
const docStore = require('./docStore');

module.exports.create = async (event, context, callback) => {
  const userid = getAuthenticatedUserId(event);

  if (!userid) {
    callback(null, {
      statusCode: 401,
      headers: corsHeaders(),
      body: JSON.stringify({ message: 'Unauthorized: no user subject found.' }),
    });
    return;
  }

  let body;
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

  const id = body.id || uuid.v4();
  if (!docStore.validateDocId(id)) {
    callback(null, {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ message: 'Invalid document id.' }),
    });
    return;
  }

  try {
    const existing = await docStore.getDoc(userid, id);
    if (existing) {
      callback(null, {
        statusCode: 409,
        headers: corsHeaders(),
        body: JSON.stringify({ message: 'Document already exists.' }),
      });
      return;
    }

    const now = new Date().toISOString();
    const { id: _ignored, ...data } = body;
    const doc = {
      id,
      ...data,
      createdAt: now,
      updatedAt: now,
    };

    await docStore.putDoc(userid, id, doc);
    callback(null, {
      statusCode: 201,
      headers: corsHeaders(),
      body: JSON.stringify(doc),
    });
  } catch (err) {
    console.error(err);
    callback(null, {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ message: 'Failed to create document.' }),
    });
  }
};

'use strict';

const { getAuthenticatedUserId, corsHeaders } = require('../authorizer');
const docStore = require('./docStore');
const shareStore = require('./shareStore');

function respond(callback, event, statusCode, body) {
  callback(null, {
    statusCode,
    headers: corsHeaders(event),
    body: JSON.stringify(body),
  });
}

function toPublicShare(share) {
  return {
    code: share.code,
    docId: share.docId,
    permission: share.permission,
    createdAt: share.createdAt,
  };
}

// Resolves the caller and checks they own the document in the path.
async function resolveOwnedDoc(event, callback) {
  const userid = getAuthenticatedUserId(event);
  if (!userid) {
    respond(callback, event, 401, { message: 'Unauthorized: no user subject found.' });
    return null;
  }

  const id = event.pathParameters && event.pathParameters.id;
  if (!docStore.validateDocId(id)) {
    respond(callback, event, 400, { message: 'Invalid document id.' });
    return null;
  }

  const doc = await docStore.getDoc(userid, id);
  if (!doc) {
    respond(callback, event, 404, { message: 'Document not found.' });
    return null;
  }

  return { userid, id };
}

module.exports.create = async (event, context, callback) => {
  try {
    const owned = await resolveOwnedDoc(event, callback);
    if (!owned) {
      return;
    }

    const share = await shareStore.createShare(owned.userid, owned.id);
    respond(callback, event, 201, toPublicShare(share));
  } catch (err) {
    console.error(err);
    respond(callback, event, 500, { message: 'Failed to create share link.' });
  }
};

module.exports.list = async (event, context, callback) => {
  try {
    const owned = await resolveOwnedDoc(event, callback);
    if (!owned) {
      return;
    }

    const shares = await shareStore.listSharesForDoc(owned.userid, owned.id);
    respond(callback, event, 200, shares.map(toPublicShare));
  } catch (err) {
    console.error(err);
    respond(callback, event, 500, { message: 'Failed to list share links.' });
  }
};

module.exports.revoke = async (event, context, callback) => {
  try {
    const owned = await resolveOwnedDoc(event, callback);
    if (!owned) {
      return;
    }

    const code = event.pathParameters && event.pathParameters.code;
    const share = shareStore.validateShareCode(code)
      ? await shareStore.getShare(code)
      : null;

    if (!share || share.ownerId !== owned.userid || share.docId !== owned.id) {
      respond(callback, event, 404, { message: 'Share link not found.' });
      return;
    }

    await shareStore.deleteShare(code);
    respond(callback, event, 200, { message: 'Share link revoked.' });
  } catch (err) {
    console.error(err);
    respond(callback, event, 500, { message: 'Failed to revoke share link.' });
  }
};

module.exports.getShared = async (event, context, callback) => {
  if (!getAuthenticatedUserId(event)) {
    respond(callback, event, 401, { message: 'Unauthorized: no user subject found.' });
    return;
  }

  const code = event.pathParameters && event.pathParameters.code;
  if (!shareStore.validateShareCode(code)) {
    respond(callback, event, 404, { message: 'Share link not found.' });
    return;
  }

  try {
    const share = await shareStore.getShare(code);
    const doc = share ? await docStore.getDoc(share.ownerId, share.docId) : null;

    if (!doc) {
      respond(callback, event, 404, { message: 'Share link not found.' });
      return;
    }

    respond(callback, event, 200, { permission: share.permission, doc });
  } catch (err) {
    console.error(err);
    respond(callback, event, 500, { message: 'Failed to fetch shared document.' });
  }
};

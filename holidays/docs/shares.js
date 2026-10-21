'use strict';

const {
  getAuthenticatedUserId,
  getAuthenticatedIdentity,
  corsHeaders,
} = require('../authorizer');
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
    accessedBy: (share.accessedBy || []).map((access) => ({
      ...access,
      permission: shareStore.accessPermission(share, access.userid),
    })),
  };
}

function parseJsonBody(event) {
  if (!event.body) {
    return {};
  }
  const body = JSON.parse(event.body);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    const err = new Error('Invalid request body.');
    err.statusCode = 400;
    throw err;
  }
  return body;
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

module.exports.setAccess = async (event, context, callback) => {
  try {
    const owned = await resolveOwnedDoc(event, callback);
    if (!owned) {
      return;
    }

    const code = event.pathParameters && event.pathParameters.code;
    const userid = event.pathParameters && event.pathParameters.userid;
    const share = shareStore.validateShareCode(code)
      ? await shareStore.getShare(code)
      : null;

    if (!share || share.ownerId !== owned.userid || share.docId !== owned.id) {
      respond(callback, event, 404, { message: 'Share link not found.' });
      return;
    }

    const known = (share.accessedBy || []).some((access) => access.userid === userid);
    if (!shareStore.validateUserId(userid) || !known) {
      respond(callback, event, 404, { message: 'This person has not opened the share link.' });
      return;
    }

    let body;
    try {
      body = parseJsonBody(event);
    } catch (err) {
      respond(callback, event, err.statusCode || 400, { message: 'Invalid request body.' });
      return;
    }

    if (body.permission !== 'read' && body.permission !== 'write') {
      respond(callback, event, 400, { message: 'Permission must be read or write.' });
      return;
    }

    const updated = await shareStore.setAccessPermission(share, userid, body.permission);
    respond(callback, event, 200, toPublicShare(updated));
  } catch (err) {
    console.error(err);
    respond(callback, event, 500, { message: 'Failed to update share access.' });
  }
};

module.exports.getShared = async (event, context, callback) => {
  const identity = getAuthenticatedIdentity(event);
  if (!identity.uid) {
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

    if (identity.uid !== share.ownerId) {
      try {
        await shareStore.recordAccess(share, identity);
      } catch (err) {
        console.error('Failed to record share access', err);
      }
    }

    respond(callback, event, 200, {
      permission: shareStore.accessPermission(share, identity.uid),
      doc,
    });
  } catch (err) {
    console.error(err);
    respond(callback, event, 500, { message: 'Failed to fetch shared document.' });
  }
};

module.exports.updateShared = async (event, context, callback) => {
  const identity = getAuthenticatedIdentity(event);
  if (!identity.uid) {
    respond(callback, event, 401, { message: 'Unauthorized: no user subject found.' });
    return;
  }

  const code = event.pathParameters && event.pathParameters.code;
  if (!shareStore.validateShareCode(code)) {
    respond(callback, event, 404, { message: 'Share link not found.' });
    return;
  }

  let body;
  try {
    body = parseJsonBody(event);
  } catch (err) {
    respond(callback, event, err.statusCode || 400, { message: 'Invalid request body.' });
    return;
  }

  try {
    const share = await shareStore.getShare(code);
    const existing = share ? await docStore.getDoc(share.ownerId, share.docId) : null;

    if (!existing) {
      respond(callback, event, 404, { message: 'Share link not found.' });
      return;
    }

    if (shareStore.accessPermission(share, identity.uid) !== 'write') {
      respond(callback, event, 403, { message: 'You have read only access to this share.' });
      return;
    }

    const { id: _ignored, createdAt, ...data } = body;
    const doc = {
      id: share.docId,
      ...data,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };

    await docStore.putDoc(share.ownerId, share.docId, doc);

    if (identity.uid !== share.ownerId) {
      try {
        await shareStore.recordAccess(share, identity);
      } catch (err) {
        console.error('Failed to record share access', err);
      }
    }

    respond(callback, event, 200, {
      permission: shareStore.accessPermission(share, identity.uid),
      doc,
    });
  } catch (err) {
    console.error(err);
    respond(callback, event, 500, { message: 'Failed to update shared document.' });
  }
};

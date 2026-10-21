'use strict';

const crypto = require('crypto');
const dynamoDb = require('../dynamodb');
const TABLE_NAME = `${process.env.DOC_SHARES_TABLE}-${process.env.STAGE}`;
const DOC_KEY_INDEX = 'docKey-index';

function docKey(ownerId, docId) {
  return `${ownerId}/${docId}`;
}

function validateShareCode(code) {
  return typeof code === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(code);
}

function validateUserId(userid) {
  return typeof userid === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(userid);
}

function writerIds(share) {
  const writers = share && share.writers;
  if (!writers) {
    return [];
  }
  if (Array.isArray(writers)) {
    return writers;
  }
  if (typeof writers[Symbol.iterator] === 'function') {
    return [...writers];
  }
  return [];
}

// The share link itself stays read. Write is granted per person in writers.
function accessPermission(share, userid) {
  if (userid && share && userid === share.ownerId) {
    return 'write';
  }
  return writerIds(share).includes(userid) ? 'write' : 'read';
}

async function createShare(ownerId, docId) {
  const share = {
    code: crypto.randomBytes(18).toString('base64url'),
    docKey: docKey(ownerId, docId),
    ownerId,
    docId,
    permission: 'read',
    createdAt: new Date().toISOString(),
  };

  await dynamoDb.put({ TableName: TABLE_NAME, Item: share }).promise();
  return share;
}

async function getShare(code) {
  const result = await dynamoDb
    .get({ TableName: TABLE_NAME, Key: { code } })
    .promise();
  return result.Item || null;
}

async function listSharesForDoc(ownerId, docId) {
  const result = await dynamoDb
    .query({
      TableName: TABLE_NAME,
      IndexName: DOC_KEY_INDEX,
      KeyConditionExpression: 'docKey = :docKey',
      ExpressionAttributeValues: { ':docKey': docKey(ownerId, docId) },
    })
    .promise();
  return result.Items || [];
}

async function recordAccess(share, identity) {
  const now = new Date().toISOString();
  const accessedBy = share.accessedBy || [];
  const existing = accessedBy.find((access) => access.userid === identity.uid);
  const access = {
    ...existing,
    userid: identity.uid,
    firstAccessedAt: existing ? existing.firstAccessedAt : now,
    lastAccessedAt: now,
    accessCount: existing ? existing.accessCount + 1 : 1,
  };
  if (identity.email) {
    access.email = identity.email;
  }
  if (identity.name) {
    access.name = identity.name;
  }

  await dynamoDb
    .update({
      TableName: TABLE_NAME,
      Key: { code: share.code },
      UpdateExpression: 'SET accessedBy = :accessedBy',
      // Stops a revoked share being recreated by a late access write.
      ConditionExpression: 'attribute_exists(docKey)',
      ExpressionAttributeValues: {
        ':accessedBy': [
          ...accessedBy.filter((item) => item.userid !== identity.uid),
          access,
        ],
      },
    })
    .promise();
}

async function setAccessPermission(share, userid, permission) {
  const writers = writerIds(share).filter((id) => id !== userid);
  if (permission === 'write') {
    writers.push(userid);
  }

  await dynamoDb
    .update({
      TableName: TABLE_NAME,
      Key: { code: share.code },
      UpdateExpression: 'SET writers = :writers',
      // Stops a revoked share being recreated by a late permission write.
      ConditionExpression: 'attribute_exists(docKey)',
      ExpressionAttributeValues: { ':writers': writers },
    })
    .promise();

  return { ...share, writers };
}

async function deleteShare(code) {
  await dynamoDb.delete({ TableName: TABLE_NAME, Key: { code } }).promise();
}

async function deleteSharesForDoc(ownerId, docId) {
  const shares = await listSharesForDoc(ownerId, docId);
  await Promise.all(shares.map((share) => deleteShare(share.code)));
}

module.exports = {
  validateShareCode,
  validateUserId,
  accessPermission,
  createShare,
  getShare,
  listSharesForDoc,
  recordAccess,
  setAccessPermission,
  deleteShare,
  deleteSharesForDoc,
};

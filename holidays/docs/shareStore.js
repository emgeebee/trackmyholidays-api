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

async function deleteShare(code) {
  await dynamoDb.delete({ TableName: TABLE_NAME, Key: { code } }).promise();
}

async function deleteSharesForDoc(ownerId, docId) {
  const shares = await listSharesForDoc(ownerId, docId);
  await Promise.all(shares.map((share) => deleteShare(share.code)));
}

module.exports = {
  validateShareCode,
  createShare,
  getShare,
  listSharesForDoc,
  recordAccess,
  deleteShare,
  deleteSharesForDoc,
};

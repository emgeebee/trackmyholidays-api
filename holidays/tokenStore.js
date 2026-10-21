'use strict';

const dynamoDb = require('./dynamodb');

const TABLE_NAME = `${process.env.TOKENS_TABLE}-${process.env.STAGE}`;
const USERID_INDEX = 'userid-index';
const MAX_TOKEN_NAME_LENGTH = 64;

function normaliseTokenName(name, { required = false } = {}) {
  if (name == null || name === '') {
    if (required) {
      return { ok: false, message: 'Missing name in request body.' };
    }
    return { ok: true, name: undefined };
  }

  if (typeof name !== 'string') {
    return { ok: false, message: 'Name must be a string.' };
  }

  const trimmed = name.trim();
  if (!trimmed) {
    if (required) {
      return { ok: false, message: 'Missing name in request body.' };
    }
    return { ok: true, name: undefined };
  }

  if (trimmed.length > MAX_TOKEN_NAME_LENGTH) {
    return { ok: false, message: 'Name must be 64 characters or fewer.' };
  }

  return { ok: true, name: trimmed };
}

async function saveToken(token, userid, expiresAt, name) {
  const item = {
    token,
    userid,
    createdAt: new Date().toISOString(),
    expiresAt,
  };
  if (name) {
    item.name = name;
  }

  await dynamoDb
    .put({
      TableName: TABLE_NAME,
      Item: item,
    })
    .promise();
}

async function getTokenRecord(token) {
  const result = await dynamoDb
    .get({
      TableName: TABLE_NAME,
      Key: { token },
    })
    .promise();

  return result.Item || null;
}

async function getSubForToken(token) {
  const record = await getTokenRecord(token);
  if (!record || !record.userid) {
    return null;
  }

  if (record.expiresAt && new Date(record.expiresAt) <= new Date()) {
    return null;
  }

  return record.userid;
}

async function getTokensForUser(userid) {
  const result = await dynamoDb
    .query({
      TableName: TABLE_NAME,
      IndexName: USERID_INDEX,
      KeyConditionExpression: 'userid = :userid',
      ExpressionAttributeValues: {
        ':userid': userid,
      },
    })
    .promise();

  const now = new Date();
  return (result.Items || []).filter(
    (item) => !item.expiresAt || new Date(item.expiresAt) > now
  );
}

async function expireToken(token, userid) {
  const record = await getTokenRecord(token);
  if (!record) {
    return { ok: false, statusCode: 404, message: 'Token not found.' };
  }

  if (record.userid !== userid) {
    return { ok: false, statusCode: 403, message: 'Token does not belong to this user.' };
  }

  await dynamoDb
    .delete({
      TableName: TABLE_NAME,
      Key: { token },
    })
    .promise();

  return { ok: true };
}

async function renameToken(token, userid, name) {
  const record = await getTokenRecord(token);
  if (!record || (record.expiresAt && new Date(record.expiresAt) <= new Date())) {
    return { ok: false, statusCode: 404, message: 'Token not found.' };
  }

  if (record.userid !== userid) {
    return { ok: false, statusCode: 403, message: 'Token does not belong to this user.' };
  }

  await dynamoDb
    .update({
      TableName: TABLE_NAME,
      Key: { token },
      UpdateExpression: 'SET #name = :name',
      ExpressionAttributeNames: { '#name': 'name' },
      ExpressionAttributeValues: { ':name': name },
    })
    .promise();

  return { ok: true, name };
}

module.exports = {
  normaliseTokenName,
  saveToken,
  getSubForToken,
  getTokensForUser,
  expireToken,
  renameToken,
};

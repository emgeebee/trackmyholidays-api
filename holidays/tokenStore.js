'use strict';

const dynamoDb = require('./dynamodb');

const TABLE_NAME = `${process.env.TOKENS_TABLE}-${process.env.STAGE}`;
const USERID_INDEX = 'userid-index';

async function saveToken(token, userid, expiresAt) {
  await dynamoDb
    .put({
      TableName: TABLE_NAME,
      Item: {
        token,
        userid,
        createdAt: new Date().toISOString(),
        expiresAt,
      },
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

module.exports = {
  saveToken,
  getSubForToken,
  getTokensForUser,
  expireToken,
};

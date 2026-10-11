'use strict';

// Creates a short-lived token for a dedicated test user the same way
// POST /generateToken does: signed with the stage's secret and registered in
// the stage's tokens table. Needs TOKEN_SIGNING_SECRET, STAGE and AWS access.
const jwt = require('jsonwebtoken');

process.env.TOKENS_TABLE = process.env.TOKENS_TABLE || 'tokens';
const tokenStore = require('../../holidays/tokenStore');
const dynamoDb = require('../../holidays/dynamodb');

const TEST_USER_SUB = process.env.LIVE_TEST_USER_SUB || 'live-test-user';

async function createTestToken() {
  const secret = process.env.TOKEN_SIGNING_SECRET;
  if (!secret || !process.env.STAGE) {
    throw new Error('TOKEN_SIGNING_SECRET and STAGE are needed to create a live test token.');
  }

  const token = jwt.sign(
    { sub: TEST_USER_SUB, iss: 'holidays-api', name: 'Live test user' },
    secret,
    { expiresIn: '1h' }
  );
  const expiresAt = new Date(jwt.decode(token).exp * 1000).toISOString();
  await tokenStore.saveToken(token, TEST_USER_SUB, expiresAt);
  return token;
}

async function deleteTestToken(token) {
  await dynamoDb
    .delete({
      TableName: `${process.env.TOKENS_TABLE}-${process.env.STAGE}`,
      Key: { token },
    })
    .promise();
}

module.exports = { createTestToken, deleteTestToken };

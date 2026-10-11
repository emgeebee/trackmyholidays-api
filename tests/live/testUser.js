'use strict';

// Gets a token for a dedicated test user by invoking the deployed
// generateToken / expireToken Lambdas directly with a pre-authorised event,
// so the stage's own code and permissions create and remove it.
// Needs STAGE and AWS credentials allowed to invoke those two functions.
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const SERVICE = 'holidays';
const TEST_USER = {
  uid: process.env.LIVE_TEST_USER_SUB || 'live-test-user',
  name: 'Live test user',
};

const lambda = new LambdaClient({});

async function invoke(handler, body) {
  if (!process.env.STAGE) {
    throw new Error('STAGE is needed to create a live test token.');
  }

  const functionName = `${SERVICE}-${process.env.STAGE}-${handler}`;
  const event = {
    headers: {},
    requestContext: { authorizer: TEST_USER },
    body: body === undefined ? null : JSON.stringify(body),
  };

  const result = await lambda.send(
    new InvokeCommand({
      FunctionName: functionName,
      Payload: Buffer.from(JSON.stringify(event)),
    })
  );

  const payload = JSON.parse(Buffer.from(result.Payload).toString('utf8'));
  if (result.FunctionError || payload.statusCode !== 200) {
    throw new Error(`${functionName} failed: ${JSON.stringify(payload)}`);
  }
  return JSON.parse(payload.body);
}

async function createTestToken() {
  const { token } = await invoke('generateToken');
  return token;
}

async function deleteTestToken(token) {
  await invoke('expireToken', { token });
}

module.exports = { createTestToken, deleteTestToken };

'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, 
        DeleteCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

let clientConfig = {};

if (process.env.IS_OFFLINE) {
  clientConfig = {
    region: 'localhost',
    endpoint: 'http://localhost:8000',
    credentials: {
      accessKeyId: 'local',
      secretAccessKey: 'local',
    },
  };
}

const client = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig));
const tableName = `${process.env.TEAM_INVITES_TABLE}-${process.env.STAGE}`;

async function createInvite(id, email, teamIds, role, invitedBy) {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
  
  const invite = {
    id,
    email: email.toLowerCase(),
    teamIds,
    role: role || 'member',
    invitedBy,
    status: 'pending',
    createdAt: now,
    expiresAt,
  };

  await client.send(new PutCommand({
    TableName: tableName,
    Item: invite,
  }));

  return invite;
}

async function getInvite(id) {
  const result = await client.send(new GetCommand({
    TableName: tableName,
    Key: { id },
  }));
  return result.Item;
}

async function getInvitesByEmail(email) {
  const result = await client.send(new QueryCommand({
    TableName: tableName,
    IndexName: 'email-index',
    KeyConditionExpression: 'email = :email',
    ExpressionAttributeValues: {
      ':email': email.toLowerCase(),
    },
  }));
  return result.Items || [];
}

async function acceptInvite(id) {
  const result = await client.send(new UpdateCommand({
    TableName: tableName,
    Key: { id },
    UpdateExpression: 'SET #status = :status, acceptedAt = :acceptedAt',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':status': 'accepted',
      ':acceptedAt': new Date().toISOString(),
    },
    ReturnValues: 'ALL_NEW',
  }));
  return result.Attributes;
}

async function deleteInvite(id) {
  await client.send(new DeleteCommand({
    TableName: tableName,
    Key: { id },
  }));
}

module.exports = {
  createInvite,
  getInvite,
  getInvitesByEmail,
  acceptInvite,
  deleteInvite,
};

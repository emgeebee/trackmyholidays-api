'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, 
        DeleteCommand, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

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
const tableName = `${process.env.TEAM_MEMBERS_TABLE}-${process.env.STAGE}`;

async function addMember(id, userId, teamId, role, email, name, picture) {
  const now = new Date().toISOString();
  const member = {
    id,
    userId,
    teamId,
    role: role || 'member',
    email,
    name,
    picture,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };

  await client.send(new PutCommand({
    TableName: tableName,
    Item: member,
  }));

  return member;
}

async function acceptInvitation(id) {
  const result = await client.send(new UpdateCommand({
    TableName: tableName,
    Key: { id },
    UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':status': 'active',
      ':updatedAt': new Date().toISOString(),
    },
    ReturnValues: 'ALL_NEW',
  }));
  return result.Attributes;
}

async function getMembership(id) {
  const result = await client.send(new GetCommand({
    TableName: tableName,
    Key: { id },
  }));
  return result.Item;
}

async function getMembershipsByUser(userId) {
  const result = await client.send(new QueryCommand({
    TableName: tableName,
    IndexName: 'userId-index',
    KeyConditionExpression: 'userId = :userId',
    ExpressionAttributeValues: {
      ':userId': userId,
    },
  }));
  return result.Items || [];
}

async function getMembershipsByTeam(teamId) {
  const result = await client.send(new QueryCommand({
    TableName: tableName,
    IndexName: 'teamId-index',
    KeyConditionExpression: 'teamId = :teamId',
    ExpressionAttributeValues: {
      ':teamId': teamId,
    },
  }));
  return result.Items || [];
}

async function removeMember(id) {
  await client.send(new DeleteCommand({
    TableName: tableName,
    Key: { id },
  }));
}

async function updateMemberRole(id, role) {
  const result = await client.send(new UpdateCommand({
    TableName: tableName,
    Key: { id },
    UpdateExpression: 'SET #role = :role, updatedAt = :updatedAt',
    ExpressionAttributeNames: { '#role': 'role' },
    ExpressionAttributeValues: {
      ':role': role,
      ':updatedAt': new Date().toISOString(),
    },
    ReturnValues: 'ALL_NEW',
  }));
  return result.Attributes;
}

module.exports = {
  addMember,
  acceptInvitation,
  getMembership,
  getMembershipsByUser,
  getMembershipsByTeam,
  removeMember,
  updateMemberRole,
};

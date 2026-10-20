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
const tableName = `${process.env.TEAMS_TABLE}-${process.env.STAGE}`;

async function createTeam(id, name, parentId, createdBy) {
  const now = new Date().toISOString();
  const team = {
    id,
    name,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };

  // Only include parentId if it's not null (DynamoDB GSI doesn't allow null values)
  if (parentId) {
    team.parentId = parentId;
  }

  await client.send(new PutCommand({
    TableName: tableName,
    Item: team,
    ConditionExpression: 'attribute_not_exists(id)',
  }));

  // Always return with parentId for consistency (null for root teams)
  return {
    ...team,
    parentId: parentId || null,
  };
}

async function getTeam(id) {
  const result = await client.send(new GetCommand({
    TableName: tableName,
    Key: { id },
  }));
  return result.Item;
}

async function updateTeam(id, name) {
  const result = await client.send(new UpdateCommand({
    TableName: tableName,
    Key: { id },
    UpdateExpression: 'SET #name = :name, updatedAt = :updatedAt',
    ExpressionAttributeNames: { '#name': 'name' },
    ExpressionAttributeValues: {
      ':name': name,
      ':updatedAt': new Date().toISOString(),
    },
    ReturnValues: 'ALL_NEW',
  }));
  return result.Attributes;
}

async function deleteTeam(id) {
  await client.send(new DeleteCommand({
    TableName: tableName,
    Key: { id },
  }));
}

async function getAllTeams() {
  const result = await client.send(new ScanCommand({
    TableName: tableName,
  }));
  return result.Items || [];
}

async function getTeamsByParent(parentId) {
  const result = await client.send(new QueryCommand({
    TableName: tableName,
    IndexName: 'parentId-index',
    KeyConditionExpression: 'parentId = :parentId',
    ExpressionAttributeValues: {
      ':parentId': parentId,
    },
  }));
  return result.Items || [];
}

module.exports = {
  createTeam,
  getTeam,
  updateTeam,
  deleteTeam,
  getAllTeams,
  getTeamsByParent,
};

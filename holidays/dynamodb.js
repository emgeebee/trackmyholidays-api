'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} = require('@aws-sdk/lib-dynamodb');

let clientConfig = {};

// connect to local DB if running offline
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

function request(Command, params, callback) {
  const promise = client.send(new Command(params));

  if (typeof callback === 'function') {
    promise.then((result) => callback(null, result)).catch((err) => callback(err));
    return undefined;
  }

  // Keep aws-sdk v2 `.promise()` call sites working.
  promise.promise = () => promise;
  return promise;
}

module.exports = {
  put: (params, callback) => request(PutCommand, params, callback),
  get: (params, callback) => request(GetCommand, params, callback),
  update: (params, callback) => request(UpdateCommand, params, callback),
  delete: (params, callback) => request(DeleteCommand, params, callback),
  query: (params, callback) => request(QueryCommand, params, callback),
};

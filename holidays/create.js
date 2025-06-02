'use strict';

const uuid = require('uuid');
const dynamoDb = require('./dynamodb');

module.exports.create = (event, context, callback) => {
  const timestamp = new Date().getTime();
  const data = JSON.parse(event.body);
  // if (typeof data.text !== 'string') {
    // console.error('Validation Failed');
    // callback(null, {
      // statusCode: 400,
      // headers: { 'Content-Type': 'text/plain' },
      // body: 'Couldn\'t create the todo item.',
    // });
    // return;
  // }

  const params = {
    TableName: `${process.env.DYNAMODB_TABLE}-${process.env.STAGE}`,
    Item: {
      id: event.requestContext.authorizer.uid,
      text: data,
      checked: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  };

  // write the todo to the database
  dynamoDb.put(params, (error) => {
    // handle potential errors
    if (error) {
      console.error(error);
      callback(null, {
        statusCode: error.statusCode || 501,
        headers: { 'Content-Type': 'text/plain' },
        body: 'Couldn\'t create the todo item.',
      });
      return;
    }

    // create a response
    const response = {
      statusCode: 200,
      body: JSON.stringify(params.Item),
      headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true,
      },
    };
    callback(null, response);
  });
};

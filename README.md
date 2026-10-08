<!--
title: 'AWS Serverless REST API example in NodeJS'
description: 'This example demonstrates how to setup a RESTful Web Service allowing you to create, list, get, update and delete Todos. DynamoDB is used to store the data.'
layout: Doc
framework: v1
platform: AWS
language: nodeJS
authorLink: 'https://github.com/ozbillwang'
authorName: 'Bill Wang'
authorAvatar: 'https://avatars3.githubusercontent.com/u/8954908?v=4&s=140'
-->
# Serverless REST API


This example demonstrates how to setup a [RESTful Web Services](https://en.wikipedia.org/wiki/Representational_state_transfer#Applied_to_web_services) allowing you to create, list, get, update and delete Todos. DynamoDB is used to store the data. This is just an example and of course you could use any data storage as a backend.

## Structure

This service has a separate directory for all the todo operations. For each operation exactly one file exists e.g. `todos/delete.js`. In each of these files there is exactly one function which is directly attached to `module.exports`.

The idea behind the `todos` directory is that in case you want to create a service containing multiple resources e.g. users, notes, comments you could do so in the same service. While this is certainly possible you might consider creating a separate service for each resource. It depends on the use-case and your preference.

## Use-cases

- API for a Web Application
- API for a Mobile Application

## Setup

```bash
npm install
```

## Deploy

Deploys run through GitHub Actions: pull requests deploy to `dev`, pushes to `main` deploy to `prod`.

The expected result should be similar to:

```bash
Service Information
service: holidays
stage: prod
region: us-west-2
endpoints:
  POST - https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod/holidays
  GET - https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod/holidays
  PUT - https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod/holidays/{id}
  POST - https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod/generateToken
  GET - https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod/tokens
  POST - https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod/expireToken
  POST - https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod/docs
  GET - https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod/docs
  GET - https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod/docs/{id}
  PUT - https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod/docs/{id}
  DELETE - https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod/docs/{id}
  POST - https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod/docs/{id}/shares
  GET - https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod/docs/{id}/shares
  DELETE - https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod/docs/{id}/shares/{code}
  GET - https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod/shared/{code}
```

## Usage

Every endpoint requires an `Authorization: Bearer <token>` header. The token can be either a Google ID token or a long-lived token from `POST /generateToken`. The user id always comes from the token, never from the URL or body.

The examples below use the prod base URL. Swap `/prod` for `/dev` to hit the dev stage.

### Holidays

#### Save holidays

The whole request body is stored as the user's holidays record.

```bash
curl -X POST https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod/holidays \
  -H 'authorization: Bearer <token>' \
  -H 'content-type: application/json' \
  -d '{ "allowance": 25, "booked": ["2026-12-24", "2026-12-31"] }'
```

Example Result:
```bash
{"id":"103501357127260947071","text":{"allowance":25,"booked":["2026-12-24","2026-12-31"]},"checked":false,"createdAt":1791460800000,"updatedAt":1791460800000}
```

#### Get holidays

```bash
curl https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod/holidays \
  -H 'authorization: Bearer <token>'
```

Example Result:
```bash
{"id":"103501357127260947071","text":{"allowance":25,"booked":["2026-12-24","2026-12-31"]},"checked":false,"createdAt":1791460800000,"updatedAt":1791460800000}
```

#### Update holidays

```bash
curl -X PUT https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod/holidays/<id> \
  -H 'authorization: Bearer <token>' \
  -H 'content-type: application/json' \
  -d '{ "text": "Updated holidays", "checked": true }'
```

### Tokens

#### Generate a long-lived token

Call this with a Google ID token. The returned token authenticates as the same user.

```bash
curl -X POST https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod/generateToken \
  -H 'authorization: Bearer <google-id-token>'
```

Example Result:
```bash
{"token":"eyJhbGciOiJIUzI1NiIs...","sub":"103501357127260947071","expiresIn":"365d","expiresAt":"2027-10-08T18:00:00.000Z"}
```

#### List my tokens

```bash
curl https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod/tokens \
  -H 'authorization: Bearer <token>'
```

Example Result:
```bash
{"tokens":[{"token":"eyJhbGciOiJIUzI1NiIs...","userid":"103501357127260947071","createdAt":"2026-10-08T18:00:00.000Z","expiresAt":"2027-10-08T18:00:00.000Z"}]}
```

#### Expire a token

```bash
curl -X POST https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod/expireToken \
  -H 'authorization: Bearer <token>' \
  -H 'content-type: application/json' \
  -d '{ "token": "<token-to-expire>" }'
```

Example Result:
```bash
{"message":"Token expired."}
```

### Documents

Documents are stored as JSON in S3 at `docs/<userid>/<id>.json`. Ids may only contain letters, numbers, `_` and `-`.

#### Create a document

`id` is optional; one is generated if omitted.

```bash
curl -X POST https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod/docs \
  -H 'authorization: Bearer <token>' \
  -H 'content-type: application/json' \
  -d '{ "id": "summer-trip", "title": "Summer holiday", "data": { "destination": "Spain", "days": 10 } }'
```

Example Result:
```bash
{"id":"summer-trip","title":"Summer holiday","data":{"destination":"Spain","days":10},"createdAt":"2026-10-08T18:00:00.000Z","updatedAt":"2026-10-08T18:00:00.000Z"}
```

#### List my documents

```bash
curl https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod/docs \
  -H 'authorization: Bearer <token>'
```

Example Result:
```bash
{"docs":[{"id":"summer-trip","title":"Summer holiday","data":{"destination":"Spain","days":10},"createdAt":"2026-10-08T18:00:00.000Z","updatedAt":"2026-10-08T18:00:00.000Z"}]}
```

#### Get one document

```bash
curl https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod/docs/summer-trip \
  -H 'authorization: Bearer <token>'
```

#### Update a document

The body replaces the document's fields; `createdAt` is preserved.

```bash
curl -X PUT https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod/docs/summer-trip \
  -H 'authorization: Bearer <token>' \
  -H 'content-type: application/json' \
  -d '{ "title": "Summer holiday (updated)", "data": { "destination": "Spain", "days": 12 } }'
```

#### Delete a document

```bash
curl -X DELETE https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod/docs/summer-trip \
  -H 'authorization: Bearer <token>'
```

Example Result:
```bash
{"message":"Document deleted."}
```

Deleting a document also revokes all of its share links.

### Sharing documents

The owner creates a share link code for a document. Anyone signed in who has the code can read the document, but not change it. Only the owner can list or revoke codes, and see who has opened each one.

#### Create a share link

```bash
curl -X POST https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod/docs/summer-trip/shares \
  -H 'authorization: Bearer <token>'
```

Example Result:
```bash
{"code":"q3Zr8kP1xW9vYbT2nLm4sA0d","docId":"summer-trip","permission":"read","createdAt":"2026-10-08T18:00:00.000Z","accessedBy":[]}
```

#### List a document's share links

```bash
curl https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod/docs/summer-trip/shares \
  -H 'authorization: Bearer <token>'
```

Example Result:
```bash
[{"code":"q3Zr8kP1xW9vYbT2nLm4sA0d","docId":"summer-trip","permission":"read","createdAt":"2026-10-08T18:00:00.000Z","accessedBy":[{"userid":"117283546120394857261","email":"friend@example.com","name":"A Friend","firstAccessedAt":"2026-10-08T19:00:00.000Z","lastAccessedAt":"2026-10-09T08:30:00.000Z","accessCount":3}]}]
```

`accessedBy` lists everyone other than the owner who has opened the link. `email` and `name` come from their Google sign-in; long-lived tokens only include them if they were generated after this was added.

#### Revoke a share link

```bash
curl -X DELETE https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod/docs/summer-trip/shares/q3Zr8kP1xW9vYbT2nLm4sA0d \
  -H 'authorization: Bearer <token>'
```

Example Result:
```bash
{"message":"Share link revoked."}
```

#### Open a shared document

Called by the person the link was shared with, using their own token.

```bash
curl https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod/shared/q3Zr8kP1xW9vYbT2nLm4sA0d \
  -H 'authorization: Bearer <their-token>'
```

Example Result:
```bash
{"permission":"read","doc":{"id":"summer-trip","title":"Summer holiday","data":{"destination":"Spain","days":10},"createdAt":"2026-10-08T18:00:00.000Z","updatedAt":"2026-10-08T18:00:00.000Z"}}
```

## Scaling

### AWS Lambda

By default, AWS Lambda limits the total concurrent executions across all functions within a given region to 100. The default limit is a safety limit that protects you from costs due to potential runaway or recursive functions during initial development and testing. To increase this limit above the default, follow the steps in [To request a limit increase for concurrent executions](http://docs.aws.amazon.com/lambda/latest/dg/concurrent-executions.html#increase-concurrent-executions-limit).

### DynamoDB

When you create a table, you specify how much provisioned throughput capacity you want to reserve for reads and writes. DynamoDB will reserve the necessary resources to meet your throughput needs while ensuring consistent, low-latency performance. You can change the provisioned throughput and increasing or decreasing capacity as needed.

This is can be done via settings in the `serverless.yml`.

```yaml
  ProvisionedThroughput:
    ReadCapacityUnits: 1
    WriteCapacityUnits: 1
```

In case you expect a lot of traffic fluctuation we recommend to checkout this guide on how to auto scale DynamoDB [https://aws.amazon.com/blogs/aws/auto-scale-dynamodb-with-dynamic-dynamodb/](https://aws.amazon.com/blogs/aws/auto-scale-dynamodb-with-dynamic-dynamodb/)

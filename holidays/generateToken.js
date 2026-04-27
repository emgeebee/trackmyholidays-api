"use strict";

const jwt = require("jsonwebtoken");

const TOKEN_SIGNING_SECRET = process.env.TOKEN_SIGNING_SECRET;
const TOKEN_EXPIRY = process.env.TOKEN_EXPIRY || "365d";

module.exports.generateToken = (event, context, callback) => {
  if (!TOKEN_SIGNING_SECRET) {
    callback(null, {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Missing TOKEN_SIGNING_SECRET configuration.",
      }),
    });
    return;
  }

  const sub =
    event.requestContext &&
    event.requestContext.authorizer &&
    event.requestContext.authorizer.sub;

  if (!sub) {
    callback(null, {
      statusCode: 401,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Unauthorized: no user subject found." }),
    });
    return;
  }

  const token = jwt.sign({ sub, iss: "holidays-api" }, TOKEN_SIGNING_SECRET, {
    expiresIn: TOKEN_EXPIRY,
  });

  callback(null, {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": true,
    },
    body: JSON.stringify({
      token,
      sub,
      expiresIn: TOKEN_EXPIRY,
    }),
  });
};

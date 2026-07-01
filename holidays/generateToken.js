"use strict";

const jwt = require("jsonwebtoken");
const { getUserIdFromEvent, corsHeaders } = require("./authorizer");
const tokenStore = require("./tokenStore");

const TOKEN_SIGNING_SECRET = process.env.TOKEN_SIGNING_SECRET;
const TOKEN_EXPIRY = process.env.TOKEN_EXPIRY || "365d";

module.exports.generateToken = async (event, context, callback) => {
  if (!TOKEN_SIGNING_SECRET) {
    callback(null, {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({
        message: "Missing TOKEN_SIGNING_SECRET configuration.",
      }),
    });
    return;
  }

  const sub = getUserIdFromEvent(event);

  if (!sub) {
    callback(null, {
      statusCode: 401,
      headers: corsHeaders(),
      body: JSON.stringify({ message: "Unauthorized: no user subject found." }),
    });
    return;
  }

  const token = jwt.sign({ sub, iss: "holidays-api" }, TOKEN_SIGNING_SECRET, {
    expiresIn: TOKEN_EXPIRY,
  });

  const decoded = jwt.decode(token);
  const expiresAt = decoded && decoded.exp
    ? new Date(decoded.exp * 1000).toISOString()
    : null;

  try {
    await tokenStore.saveToken(token, sub, expiresAt);
  } catch (err) {
    console.error(err);
    callback(null, {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ message: "Failed to store token." }),
    });
    return;
  }

  callback(null, {
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify({
      token,
      sub,
      expiresIn: TOKEN_EXPIRY,
      expiresAt,
    }),
  });
};

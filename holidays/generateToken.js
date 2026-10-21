"use strict";

const jwt = require("jsonwebtoken");
const { getAuthenticatedIdentity, corsHeaders } = require("./authorizer");
const tokenStore = require("./tokenStore");

const TOKEN_SIGNING_SECRET = process.env.TOKEN_SIGNING_SECRET;
const TOKEN_EXPIRY = process.env.TOKEN_EXPIRY || "365d";

module.exports.generateToken = async (event, context, callback) => {
  if (!TOKEN_SIGNING_SECRET) {
    callback(null, {
      statusCode: 500,
      headers: corsHeaders(event),
      body: JSON.stringify({
        message: "Missing TOKEN_SIGNING_SECRET configuration.",
      }),
    });
    return;
  }

  const { uid: sub, email, name: userName } = getAuthenticatedIdentity(event);

  if (!sub) {
    callback(null, {
      statusCode: 401,
      headers: corsHeaders(event),
      body: JSON.stringify({ message: "Unauthorized: no user subject found." }),
    });
    return;
  }

  const claims = { sub, iss: "holidays-api" };
  if (email) {
    claims.email = email;
  }
  if (userName) {
    claims.name = userName;
  }

  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch (err) {
    body = null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    callback(null, {
      statusCode: 400,
      headers: corsHeaders(event),
      body: JSON.stringify({ message: "Invalid request body." }),
    });
    return;
  }

  const tokenName = tokenStore.normaliseTokenName(body.name);
  if (!tokenName.ok) {
    callback(null, {
      statusCode: 400,
      headers: corsHeaders(event),
      body: JSON.stringify({ message: tokenName.message }),
    });
    return;
  }

  const token = jwt.sign(claims, TOKEN_SIGNING_SECRET, {
    expiresIn: TOKEN_EXPIRY,
  });

  const decoded = jwt.decode(token);
  const expiresAt = decoded && decoded.exp
    ? new Date(decoded.exp * 1000).toISOString()
    : null;

  try {
    await tokenStore.saveToken(token, sub, expiresAt, tokenName.name);
  } catch (err) {
    console.error(err);
    callback(null, {
      statusCode: 500,
      headers: corsHeaders(event),
      body: JSON.stringify({ message: "Failed to store token." }),
    });
    return;
  }

  callback(null, {
    statusCode: 200,
    headers: corsHeaders(event),
    body: JSON.stringify({
      token,
      sub,
      expiresIn: TOKEN_EXPIRY,
      expiresAt,
      ...(tokenName.name ? { name: tokenName.name } : {}),
    }),
  });
};

"use strict";

// var verifier = require('google-id-token-verifier');
const jwt = require("jsonwebtoken");

// app's client IDs to check with audience in ID Token.
var CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const TOKEN_SIGNING_SECRET = process.env.TOKEN_SIGNING_SECRET;
const { OAuth2Client } = require("google-auth-library");
const client = new OAuth2Client(CLIENT_ID);

async function verify(token) {
  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: CLIENT_ID, // Specify the CLIENT_ID of the app that accesses the backend
      // Or, if multiple clients access the backend:
      //[CLIENT_ID_1, CLIENT_ID_2, CLIENT_ID_3]
    });
    const payload = ticket.getPayload();
    return payload.sub;
  } catch (googleErr) {
    if (!TOKEN_SIGNING_SECRET) {
      throw googleErr;
    }

    const payload = jwt.verify(token, TOKEN_SIGNING_SECRET);
    if (!payload || !payload.sub) {
      throw new Error("Token payload is missing required sub claim");
    }

    return payload.sub;
  }
}

// A function to generate a response from Authorizer to API Gateway.
function generate_policy(principal_id, effect, resource, uid) {
  return {
    principalId: principal_id,
    policyDocument: {
      Version: "2012-10-17",
      Statement: [
        {
          Action: "execute-api:Invoke",
          Effect: effect,
          // Resource: resource
          Resource: "*",
        },
      ],
    },
    context: {
      uid,
    },
  };
}

module.exports.authorizer = (event, context, callback) => {
  const authorizationHeader =
    (event.headers && (event.headers.Authorization || event.headers.authorization)) || "";
  const rawToken = event.authorizationToken || authorizationHeader;
  const token = rawToken.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    callback("Unauthorized");
    return;
  }

  verify(token)
    .then((uid) => {
      console.log("eee", event.methodArn);
      callback(null, generate_policy(uid, "Allow", event.methodArn, uid));
    })
    .catch((err) => {
      console.error(err);
      callback("Unauthorized");
    });
};

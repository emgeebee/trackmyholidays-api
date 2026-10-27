'use strict';

const GRAPHQL_URL =
  process.env.FINDMPAST_GRAPHQL_URL || 'https://www.findmypast.com/titan/marshal/graphql';

let accessToken = '';

function setAccessToken(token) {
  accessToken = typeof token === 'string' ? token.trim() : '';
}

function hasAccessToken() {
  return Boolean(accessToken);
}

function isMutation(query) {
  return /^\s*mutation\b/i.test(String(query || ''));
}

function cookieHeader() {
  if (!accessToken) {
    throw new Error('Findmypast token is not set');
  }
  if (/[;\r\n]/.test(accessToken)) {
    throw new Error('Findmypast token contains characters that cannot go in a cookie');
  }
  return `fmp_access_token=${accessToken}`;
}

async function graphql(query, variables) {
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'apollographql-client-name': 'trackmyholidays-tree-agent',
      cookie: cookieHeader(),
    },
    body: JSON.stringify({ query, variables: variables || {} }),
  });

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch (err) {
    throw new Error(`Findmypast returned a non-JSON response (${response.status})`);
  }

  if (!response.ok) {
    const message = body.errors && body.errors[0] && body.errors[0].message;
    throw new Error(message || `Findmypast GraphQL HTTP ${response.status}`);
  }

  return body;
}

module.exports = {
  GRAPHQL_URL,
  setAccessToken,
  hasAccessToken,
  isMutation,
  graphql,
};

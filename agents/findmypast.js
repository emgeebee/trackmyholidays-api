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

async function graphql(query, variables, retries = 3) {
  const vars = variables || {};
  let lastError;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'apollographql-client-name': 'trackmyholidays-tree-agent',
          cookie: cookieHeader(),
        },
        body: JSON.stringify({ query, variables: vars }),
      });

      const text = await response.text();
      let body;
      try {
        body = text ? JSON.parse(text) : {};
      } catch (err) {
        const error = new Error(`Findmypast returned a non-JSON response (${response.status}). Query: ${query.slice(0, 100)}...`);
        error.responseText = text.slice(0, 500);
        throw error;
      }

      if (!response.ok) {
        const errorMsg = body.errors && body.errors[0] && body.errors[0].message;
        const error = new Error(
          errorMsg || `Findmypast GraphQL HTTP ${response.status}. Query: ${query.slice(0, 100)}...`
        );
        error.statusCode = response.status;
        error.graphqlErrors = body.errors;
        error.query = query;
        error.variables = vars;
        
        // Don't retry on client errors (4xx), only server errors (5xx) and network issues
        if (response.status >= 400 && response.status < 500) {
          throw error;
        }
        lastError = error;
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
          continue;
        }
        throw error;
      }

      return body;
    } catch (err) {
      lastError = err;
      // Network errors or timeouts - retry
      if (err.name === 'TypeError' || err.name === 'FetchError') {
        if (attempt < retries) {
          console.log(`GraphQL attempt ${attempt + 1} failed, retrying...`, err.message);
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
          continue;
        }
      }
      throw err;
    }
  }
  
  throw lastError;
}

module.exports = {
  GRAPHQL_URL,
  setAccessToken,
  hasAccessToken,
  isMutation,
  graphql,
};

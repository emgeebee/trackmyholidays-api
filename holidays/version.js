'use strict';

const { version } = require('../package.json');
const { corsHeaders } = require('./authorizer');

module.exports.version = async (event) => ({
  statusCode: 200,
  headers: corsHeaders(event),
  body: JSON.stringify({
    version,
    commit: process.env.GIT_SHA,
    stage: process.env.STAGE,
  }),
});

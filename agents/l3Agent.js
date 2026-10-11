'use strict';

const {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
  DescribeLogGroupsCommand,
} = require('@aws-sdk/client-cloudwatch-logs');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const cloudwatchLogs = new CloudWatchLogsClient({});
const s3 = new S3Client({});

const SERVICE_NAME = process.env.SERVICE_NAME || 'holidays';
const STAGE = process.env.STAGE || 'dev';
const LOG_GROUP_PREFIX = `/aws/lambda/${SERVICE_NAME}-${STAGE}-`;
const ACCESS_LOG_GROUP = `/aws/api-gateway/${SERVICE_NAME}-${STAGE}`;
const LOG_LOOKBACK = process.env.LOG_LOOKBACK || '7d';
const REPORTS_PREFIX = 'reports';
const DOCS_BUCKET = process.env.DOCS_BUCKET;

function parseLookback(time) {
  const match = /^(\d+)(m|h|d)$/.exec(time || LOG_LOOKBACK);
  if (!match) {
    throw new Error('time must be a relative duration like "30m", "1h", or "7d"');
  }

  const amount = Number.parseInt(match[1], 10);
  const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]];
  return Date.now() - amount * unitMs;
}

function sanitizeReportTitle(title) {
  return title.replace(/[^a-zA-Z0-9-_]/g, '-').replace(/-+/g, '-').slice(0, 120);
}

async function waitForQueryResults(queryId, maxAttempts = 30) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const result = await cloudwatchLogs.send(
      new GetQueryResultsCommand({ queryId })
    );

    if (result.status === 'Complete') {
      return result.results || [];
    }

    if (result.status === 'Failed' || result.status === 'Cancelled') {
      throw new Error(`CloudWatch Logs query ${result.status.toLowerCase()}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error('CloudWatch Logs query timed out');
}

async function runInsightsQuery(logGroupName, queryString, startTime, endTime) {
  const { queryId } = await cloudwatchLogs.send(
    new StartQueryCommand({
      logGroupName,
      startTime: Math.floor(startTime / 1000),
      endTime: Math.floor(endTime / 1000),
      queryString,
    })
  );
  return waitForQueryResults(queryId);
}

function rowsToObjects(results) {
  return results.map((row) =>
    Object.fromEntries(
      row.filter((field) => field.field !== '@ptr').map((field) => [field.field, field.value])
    )
  );
}

function percent(part, whole) {
  if (!whole) {
    return '0%';
  }
  const value = (part / whole) * 100;
  return `${value < 1 && value > 0 ? value.toFixed(2) : value.toFixed(1)}%`;
}

// Requests from authenticated users have a uid; authorizer rejections log "-".
const AUTHED = 'filter ispresent(uid) and uid != "-"';

async function summariseTraffic(startTime, endTime) {
  const query = async (queryString) =>
    rowsToObjects(await runInsightsQuery(ACCESS_LOG_GROUP, queryString, startTime, endTime));

  const [[totals = {}], byStatus, [authed = {}], [serverErrors = {}], [clientErrors = {}], byEndpoint, errorsByEndpoint] =
    await Promise.all([
      query('stats count(*) as requests'),
      query('stats count(*) as requests by status | sort status asc'),
      query(`${AUTHED} | stats count(*) as requests, count_distinct(uid) as users`),
      query(`${AUTHED} | filter status >= 500 | stats count(*) as requests, count_distinct(uid) as users`),
      query(`${AUTHED} | filter status >= 400 and status < 500 | stats count(*) as requests, count_distinct(uid) as users`),
      query(`${AUTHED} | stats count(*) as requests, count_distinct(uid) as users by method, resource | sort requests desc`),
      query(`${AUTHED} | filter status >= 400 | stats count(*) as requests, count_distinct(uid) as users by method, resource, status | sort requests desc`),
    ]);

  const totalRequests = Number(totals.requests || 0);
  const totalUsers = Number(authed.users || 0);
  const authedRequests = Number(authed.requests || 0);
  const unauthorised = byStatus
    .filter((row) => row.status === '401' || row.status === '403')
    .reduce((sum, row) => sum + Number(row.requests), 0);

  const lines = [
    `Traffic for ${SERVICE_NAME}-${STAGE}, ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`,
    `(from API Gateway access logs; user counts are distinct authenticated user ids and may be approximate at very high volumes)`,
    '',
    `- Total requests: ${totalRequests}`,
    `- Authenticated requests: ${authedRequests}`,
    `- Distinct users: ${totalUsers}`,
    `- Rejected as unauthorised (401/403): ${unauthorised} (${percent(unauthorised, totalRequests)} of requests)`,
    `- Server errors (5xx) for signed-in users: ${serverErrors.requests || 0} requests (${percent(Number(serverErrors.requests || 0), authedRequests)}), affecting ${serverErrors.users || 0} users (${percent(Number(serverErrors.users || 0), totalUsers)} of users)`,
    `- Client errors (4xx) for signed-in users: ${clientErrors.requests || 0} requests (${percent(Number(clientErrors.requests || 0), authedRequests)}), affecting ${clientErrors.users || 0} users (${percent(Number(clientErrors.users || 0), totalUsers)} of users)`,
    '',
    'Requests by status:',
    ...byStatus.map((row) => `- ${row.status}: ${row.requests} (${percent(Number(row.requests), totalRequests)})`),
    '',
    'Signed-in traffic by endpoint:',
    ...byEndpoint.map(
      (row) => `- ${row.method} ${row.resource}: ${row.requests} requests from ${row.users} users (${percent(Number(row.users), totalUsers)} of users)`
    ),
    '',
    'Error responses to signed-in users by endpoint:',
    ...(errorsByEndpoint.length
      ? errorsByEndpoint.map(
          (row) =>
            `- ${row.method} ${row.resource} ${row.status}: ${row.requests} requests, ${row.users} users (${percent(Number(row.users), totalUsers)} of all users)`
        )
      : ['- none']),
  ];

  return lines.join('\n');
}

function formatQueryResults(results) {
  if (!results.length) {
    return 'No log events matched the query.';
  }

  return results
    .map((row) =>
      row
        .map((field) => `${field.field}=${field.value}`)
        .join(' | ')
    )
    .join('\n');
}

function buildTools(tool, z) {
  const listServiceLogGroups = tool({
    name: 'list_service_log_groups',
    description: 'List CloudWatch log groups for this service and stage.',
    inputSchema: z.object({}),
    callback: async () => {
      const groups = [];
      let nextToken;

      do {
        const result = await cloudwatchLogs.send(
          new DescribeLogGroupsCommand({
            logGroupNamePrefix: LOG_GROUP_PREFIX,
            nextToken,
          })
        );

        groups.push(
          ...(result.logGroups || []).map((group) => group.logGroupName)
        );
        nextToken = result.nextToken;
      } while (nextToken);

      if (!groups.length) {
        return `No log groups found with prefix ${LOG_GROUP_PREFIX}`;
      }

      return groups.join('\n');
    },
  });

  const logAnalyser = tool({
    name: 'log_analyser',
    description: 'Query AWS CloudWatch Logs and return matching events.',
    inputSchema: z.object({
      logGroupName: z
        .string()
        .describe('CloudWatch log group name from list_service_log_groups'),
      query: z
        .string()
        .describe('CloudWatch Logs Insights query string'),
      time: z
        .string()
        .optional()
        .describe(
          `Lookback window such as "30m", "1h", or "7d". Defaults to ${LOG_LOOKBACK}.`
        ),
      limit: z
        .number()
        .int()
        .positive()
        .max(1000)
        .optional()
        .describe('Maximum number of log rows to return. Defaults to 100.'),
    }),
    callback: async ({ logGroupName, query, time, limit }) => {
      const endTime = Date.now();
      const startTime = parseLookback(time);
      const rowLimit = limit || 100;

      const results = await runInsightsQuery(
        logGroupName,
        `${query}\n| limit ${rowLimit}`,
        startTime,
        endTime
      );
      return formatQueryResults(results);
    },
  });

  const trafficSummary = tool({
    name: 'traffic_summary',
    description:
      'Summarise API traffic from API Gateway access logs: total requests, distinct users, ' +
      'status codes, per-endpoint usage, and how many users each error affected (with percentages).',
    inputSchema: z.object({
      time: z
        .string()
        .optional()
        .describe(`Lookback window such as "1d" or "7d". Defaults to ${LOG_LOOKBACK}.`),
    }),
    callback: async ({ time }) => {
      try {
        return await summariseTraffic(parseLookback(time), Date.now());
      } catch (err) {
        if (err.name === 'ResourceNotFoundException') {
          return `No access logs found in ${ACCESS_LOG_GROUP}; traffic cannot be summarised yet.`;
        }
        throw err;
      }
    },
  });

  const saveReport = tool({
    name: 'save_report',
    description: 'Save the compiled markdown log analysis report to S3.',
    inputSchema: z.object({
      title: z
        .string()
        .describe('Short report title, e.g. weekly-log-report-2026-04-27'),
      content: z
        .string()
        .describe('Full markdown report content'),
    }),
    callback: async ({ title, content }) => {
      if (!DOCS_BUCKET) {
        throw new Error('DOCS_BUCKET is not configured');
      }

      const key = `${REPORTS_PREFIX}/${sanitizeReportTitle(title)}.md`;
      await s3.send(
        new PutObjectCommand({
          Bucket: DOCS_BUCKET,
          Key: key,
          Body: content,
          ContentType: 'text/markdown',
        })
      );

      return `Saved report to s3://${DOCS_BUCKET}/${key}`;
    },
  });

  return [listServiceLogGroups, logAnalyser, trafficSummary, saveReport];
}

function buildAnalysisPrompt() {
  const reportDate = new Date().toISOString().slice(0, 10);

  return `Review Lambda logs for the ${SERVICE_NAME} service in the ${STAGE} stage over the last ${LOG_LOOKBACK}.

Your job:
1. Call traffic_summary once to get this week's traffic: total requests, distinct users, status codes, per-endpoint usage and how many users each error affected. Use these numbers as given; do not recalculate or estimate them.
2. Call list_service_log_groups to find all relevant log groups.
3. For each log group, run log_analyser queries to investigate:
   - errors and exceptions (ERROR, Exception, Task timed out, Runtime exited)
   - authorization failures (Unauthorized, Denied, 401, 403)
   - repeated warnings that may indicate a problem
   - any unusual spikes or new error patterns
4. Compile a markdown report with these sections:
   - Executive summary, opening with the traffic headline (e.g. "1,240 requests from 100 users; server errors affected 1 user (1%)")
   - Traffic summary: the traffic_summary figures, including per-endpoint usage
   - Findings by severity (critical, warning, info). Quantify each finding's impact using the traffic numbers: how many requests and users it affected and what share of the total that is. Say so when a finding can't be tied to users.
   - Findings by Lambda function
   - Recommended follow-up actions, ordered by how many users are affected
   - Appendix with representative log excerpts
5. Save the report with save_report using title "log-report-${reportDate}".
6. Return a short summary of the most important findings, including the traffic headline.

Suggested Insights queries to adapt per log group:
- fields @timestamp, @message | filter @message like /(?i)(error|exception|timed out|unauthorized|denied|failed)/
- stats count(*) as eventCount by bin(1d)
- fields @timestamp, @message | sort @timestamp desc`;
}

module.exports.l3Agent = async (event, context, callback) => {
  try {
    // @strands-agents/sdk and zod are ESM-only; load them dynamically from CJS.
    const [{ Agent, tool, BedrockModel }, { z }] = await Promise.all([
      import('@strands-agents/sdk'),
      import('zod'),
    ]);

    const model = new BedrockModel({
      modelId: process.env.L3_AGENT_MODEL || 'amazon.nova-lite-v1:0',
      region: process.env.AWS_REGION || 'us-west-2',
      maxTokens: 4096,
      temperature: 0.2,
    });

    const agent = new Agent({
      model,
      tools: buildTools(tool, z),
      systemPrompt:
        'You are an AWS log analysis agent for trackmyholidays-api. ' +
        'Investigate CloudWatch logs methodically, cite evidence from log lines, ' +
        'and produce actionable reports. Always save the final markdown report with save_report.',
    });

    const result = await agent.invoke(buildAnalysisPrompt());
    const summary =
      result && result.lastMessage
        ? result.lastMessage
        : 'Log analysis completed.';

    console.log('l3Agent report summary:', summary);
    callback(null, { summary });
  } catch (err) {
    console.error(err);
    callback(err);
  }
};

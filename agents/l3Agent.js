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

      const { queryId } = await cloudwatchLogs.send(
        new StartQueryCommand({
          logGroupName,
          startTime: Math.floor(startTime / 1000),
          endTime: Math.floor(endTime / 1000),
          queryString: `${query}\n| limit ${rowLimit}`,
        })
      );

      const results = await waitForQueryResults(queryId);
      return formatQueryResults(results);
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

  return [listServiceLogGroups, logAnalyser, saveReport];
}

function buildAnalysisPrompt() {
  const reportDate = new Date().toISOString().slice(0, 10);

  return `Review Lambda logs for the ${SERVICE_NAME} service in the ${STAGE} stage over the last ${LOG_LOOKBACK}.

Your job:
1. Call list_service_log_groups to find all relevant log groups.
2. For each log group, run log_analyser queries to investigate:
   - errors and exceptions (ERROR, Exception, Task timed out, Runtime exited)
   - authorization failures (Unauthorized, Denied, 401, 403)
   - repeated warnings that may indicate a problem
   - any unusual spikes or new error patterns
3. Compile a markdown report with these sections:
   - Executive summary
   - Findings by severity (critical, warning, info)
   - Findings by Lambda function
   - Recommended follow-up actions
   - Appendix with representative log excerpts
4. Save the report with save_report using title "log-report-${reportDate}".
5. Return a short summary of the most important findings.

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

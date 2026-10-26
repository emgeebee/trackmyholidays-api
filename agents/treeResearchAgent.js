'use strict';

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const findmypast = require('./findmypast');

const s3 = new S3Client({});
const DOCS_BUCKET = process.env.DOCS_BUCKET;
const STAGE = process.env.STAGE || 'dev';

function clip(value, limit = 12000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n… truncated`;
}

function personLabel(person) {
  const name = findmypast.preferredName(person);
  return [name.givenNames, name.surnames].filter(Boolean).join(' ') || person.id;
}

function gapSummary(person) {
  const facts = person.facts || [];
  const types = new Set(facts.map((fact) => (fact.factType && fact.factType.description) || ''));
  const missing = [];
  if (!person.birthDate && ![...types].some((type) => /birth/i.test(type))) missing.push('birth');
  if (!person.birthPlace && !facts.some((fact) => /birth/i.test(fact.factType && fact.factType.description || '') && fact.place)) {
    missing.push('birth place');
  }
  if (!person.isLiving && !person.deathDate && ![...types].some((type) => /death|burial/i.test(type))) {
    missing.push('death');
  }
  return missing;
}

function buildDiff(mapping, extensions) {
  return mapping.map((entry) => ({
    sourcePersonId: entry.source.id,
    researchPersonId: entry.research && entry.research.id,
    name: personLabel(entry.source),
    facts: entry.research
      ? findmypast.diffPerson(entry.source, entry.research)
      : { added: [], missingFromResearchCopy: (entry.source.facts || []).map(findmypast.factSignature) },
    extensions: extensions.filter((item) => item.researchPersonId === (entry.research && entry.research.id)),
  }));
}

function renderReport(context, diff, narrative) {
  const lines = [
    `# Family tree research ${context.date}`,
    '',
    `Source tree: ${context.source.title || context.source.id} (\`${context.source.id}\`)`,
    `Research tree: ${context.researchTitle} (\`${context.researchTree.id}\`)`,
    '',
    'The source tree was only read. Facts the agent added are on the research tree, so the two trees can be compared in Findmypast.',
    context.copiedRootOnly
      ? 'Only the root person was copied. Findmypast rejected a tree that included the wider family in one create call.'
      : `Copied ${context.copiedCount} people into the research tree. Family links are not copied; the relationship list below is from the source tree.`,
    context.truncated ? `The walk stopped at ${findmypast.MAX_PEOPLE} people.` : '',
    '',
    '## Differences',
    '',
  ];

  for (const person of diff) {
    lines.push(`### ${person.name}`);
    lines.push('');
    if (!person.facts.added.length) {
      lines.push('No new facts on the research copy.');
    } else {
      for (const fact of person.facts.added) {
        const detail = [fact.type, fact.date, fact.place, fact.description, fact.address].filter(Boolean).join(' — ');
        lines.push(`- Added: ${detail}`);
      }
    }
    if (person.facts.missingFromResearchCopy.length) {
      lines.push(`- ${person.facts.missingFromResearchCopy.length} source facts were not on the research copy.`);
    }
    for (const extension of person.extensions) {
      lines.push(`- Schema extension \`${extension.field}\`: ${extension.value} (${extension.evidence})`);
    }
    lines.push('');
  }

  lines.push('## Agent notes', '', narrative || 'No narrative returned.', '');
  return lines.filter((line) => line !== undefined).join('\n');
}

async function saveReport(date, markdown, json) {
  if (!DOCS_BUCKET) throw new Error('DOCS_BUCKET is not configured');
  const markdownKey = `reports/tree-research-${date}.md`;
  const jsonKey = `reports/tree-research-${date}.json`;
  await s3.send(new PutObjectCommand({
    Bucket: DOCS_BUCKET,
    Key: markdownKey,
    Body: markdown,
    ContentType: 'text/markdown',
  }));
  await s3.send(new PutObjectCommand({
    Bucket: DOCS_BUCKET,
    Key: jsonKey,
    Body: JSON.stringify(json, null, 2),
    ContentType: 'application/json',
  }));
  return { markdownKey, jsonKey };
}

function buildTools(tool, z, session) {
  const researchIds = () => new Set(session.mapping.filter((entry) => entry.research).map((entry) => entry.research.id));

  const listHints = tool({
    name: 'list_hints',
    description:
      'Read pending Findmypast hints for a person on the source tree. ' +
      'Pass the source person id. Hints are evidence; they are not written anywhere.',
    inputSchema: z.object({
      sourcePersonId: z.string().describe('Person id on the source tree, from the prompt mapping'),
    }),
    callback: async ({ sourcePersonId }) => {
      const known = session.mapping.some((entry) => entry.source.id === sourcePersonId);
      if (!known) return `Unknown source person ${sourcePersonId}`;
      const hints = await findmypast.hintsForPerson(session.source.id, sourcePersonId);
      return clip(hints);
    },
  });

  const factTypes = tool({
    name: 'fact_types',
    description:
      'List fact types the research tree accepts, including which of date, place and description each type allows. ' +
      'Use one of these ids for add_fact. This is the live schema.',
    inputSchema: z.object({
      researchPersonId: z.string(),
    }),
    callback: async ({ researchPersonId }) => {
      if (!researchIds().has(researchPersonId)) return `Unknown research person ${researchPersonId}`;
      const types = await findmypast.factTypes(session.researchTree.id, researchPersonId);
      return clip(types.map((type) => ({
        id: type.id,
        description: type.description,
        shape: type.shape,
      })));
    },
  });

  const addFact = tool({
    name: 'add_fact',
    description:
      'Add one fact to a person on the research tree. Refuses source-tree person ids. ' +
      'factTypeId must come from fact_types. Only add a fact a hint supports.',
    inputSchema: z.object({
      researchPersonId: z.string(),
      factTypeId: z.number().int(),
      originalDate: z.string().optional().describe('Date text, for example "12 Mar 1891" or "1891"'),
      placeName: z.string().optional(),
      description: z.string().optional(),
      address: z.string().optional(),
      evidence: z.string().describe('Hint source name, year and place this fact came from'),
    }),
    callback: async ({ researchPersonId, factTypeId, originalDate, placeName, description, address, evidence }) => {
      if (!researchIds().has(researchPersonId)) {
        return `Refused. ${researchPersonId} is not a person on the research tree.`;
      }
      const created = await findmypast.addPersonFact(researchPersonId, {
        factTypeId,
        originalDate,
        placeName,
        description,
        address,
      });
      session.added.push({ researchPersonId, factTypeId, originalDate, placeName, description, address, evidence });
      return clip({ saved: true, fact: created && created.fact, evidence });
    },
  });

  const recordExtension = tool({
    name: 'record_extension',
    description:
      'Record a useful attribute that fact_types does not have a type for. ' +
      'It is stored in this run\'s research report, not sent to Findmypast as an invented fact type.',
    inputSchema: z.object({
      researchPersonId: z.string(),
      field: z.string().describe('Short field name, for example occupation or emigrationShip'),
      value: z.string(),
      evidence: z.string(),
    }),
    callback: async ({ researchPersonId, field, value, evidence }) => {
      if (!researchIds().has(researchPersonId)) {
        return `Refused. ${researchPersonId} is not a person on the research tree.`;
      }
      const extension = {
        researchPersonId,
        field: field.trim().slice(0, 64),
        value: value.trim().slice(0, 500),
        evidence: evidence.trim().slice(0, 500),
      };
      session.extensions.push(extension);
      return clip({ recorded: true, extension });
    },
  });

  const graphqlQuery = tool({
    name: 'graphql_query',
    description:
      'Run a read-only GraphQL query against Findmypast. Mutations are refused; use add_fact to write.',
    inputSchema: z.object({
      query: z.string(),
      variables: z.record(z.string(), z.any()).optional(),
    }),
    callback: async ({ query, variables }) => {
      if (findmypast.isMutation(query)) {
        return 'Refused. graphql_query is read-only. Use add_fact or record_extension.';
      }
      const body = await findmypast.graphql(query, variables || {});
      return clip(body);
    },
  });

  return [listHints, factTypes, addFact, recordExtension, graphqlQuery];
}

function buildPrompt(session) {
  const people = session.mapping.map((entry) => ({
    name: personLabel(entry.source),
    sourcePersonId: entry.source.id,
    researchPersonId: entry.research && entry.research.id,
    gaps: gapSummary(entry.source),
    facts: (entry.source.facts || []).map(findmypast.factSignature),
  }));

  return `Research the Findmypast tree "${session.source.title}" and add supported details to the research tree "${session.researchTitle}" (${session.researchTree.id}).

People already copied (source id -> research id):
${clip(people, 20000)}

Rules:
1. Call list_hints with a source person id before adding anything about that person.
2. Add a fact only when a hint gives the value. Put the hint's source name, year and place in evidence.
3. Call fact_types and use one of those ids. Match the fact to the shape: do not send a place to a type whose shape has hasPlaceAndAddressFields false.
4. When a useful value has no fact type, call record_extension. Do not invent a factTypeId.
5. Do not try to write to the source tree. The tools reject those ids.
6. Prefer people with gaps. Stop after the clearest supported additions.
7. Finish with a short account of what you added and what you left out because the hint was weak.`;
}

function tokenFromEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return '';
  return typeof event.token === 'string' ? event.token.trim() : '';
}

module.exports.treeResearchAgent = async (event, context, callback) => {
  const token = tokenFromEvent(event) || process.env.FINDMPAST_ACCESS_TOKEN || '';
  findmypast.setAccessToken(token);
  if (!findmypast.hasAccessToken()) {
    console.log('treeResearchAgent skipped: no token in the event payload or FINDMPAST_ACCESS_TOKEN');
    callback(null, {
      summary: 'No Findmypast token. Pass {"token":"<fmp_access_token>"} or set FINDMPAST_ACCESS_TOKEN.',
    });
    return;
  }

  const date = new Date().toISOString().slice(0, 10);
  const session = {
    source: null,
    researchTree: null,
    researchTitle: '',
    mapping: [],
    added: [],
    extensions: [],
    copiedRootOnly: false,
    truncated: false,
    copiedCount: 0,
  };

  try {
    const trees = await findmypast.listTrees();
    session.source = findmypast.chooseSourceTree(trees);
    if (!session.source.rootPerson || !session.source.rootPerson.id) {
      throw new Error(`Tree ${session.source.id} has no root person`);
    }

    const walked = await findmypast.walkTree(session.source.rootPerson.id);
    session.truncated = walked.truncated;
    session.researchTitle = `Research ${session.source.title || 'tree'} ${date}`;
    const created = await findmypast.createResearchTree(session.researchTitle, walked.people);
    session.researchTree = created.tree;
    session.copiedRootOnly = created.copiedRootOnly;
    session.copiedCount = created.requestedCount;

    const researchIds = (created.tree.people || []).map((person) => person.id);
    const copied = session.copiedRootOnly ? walked.people.slice(0, 1) : walked.people;
    session.mapping = copied.map((source, index) => ({
      source,
      research: researchIds[index] ? { id: researchIds[index] } : null,
    }));

    const [{ Agent, tool, BedrockModel }, { z }] = await Promise.all([
      import('@strands-agents/sdk'),
      import('zod'),
    ]);

    const model = new BedrockModel({
      modelId: process.env.TREE_AGENT_MODEL || 'amazon.nova-lite-v1:0',
      region: process.env.AWS_REGION || 'us-west-2',
      maxTokens: 8192,
      temperature: 0.2,
    });

    const agent = new Agent({
      model,
      tools: buildTools(tool, z, session),
      systemPrompt:
        'You research a Findmypast family tree. You read the source tree and write only to the research tree created for this run. ' +
        'Every new fact needs a Findmypast hint. Attributes with no fact type go in record_extension so the research report can hold them.',
    });

    const result = await agent.invoke(buildPrompt(session));
    const narrative = result && result.lastMessage ? String(result.lastMessage) : '';

    for (const entry of session.mapping) {
      if (!entry.research) continue;
      try {
        entry.research = await findmypast.readPerson(entry.research.id);
      } catch (err) {
        console.error('reread research person failed', entry.research.id, err.message);
      }
    }

    const diff = buildDiff(session.mapping, session.extensions);
    const markdown = renderReport({
      date,
      source: session.source,
      researchTree: session.researchTree,
      researchTitle: session.researchTitle,
      copiedRootOnly: session.copiedRootOnly,
      truncated: session.truncated,
      copiedCount: session.copiedCount,
    }, diff, narrative);

    const saved = await saveReport(date, markdown, {
      stage: STAGE,
      date,
      graphqlUrl: findmypast.GRAPHQL_URL,
      sourceTreeId: session.source.id,
      researchTreeId: session.researchTree.id,
      diff,
      extensions: session.extensions,
      narrative,
    });

    console.log('treeResearchAgent saved', saved.markdownKey);
    callback(null, { summary: narrative.slice(0, 2000), report: saved.markdownKey });
  } catch (err) {
    console.error(err);
    callback(err);
  } finally {
    findmypast.setAccessToken(process.env.FINDMPAST_ACCESS_TOKEN || '');
  }
};

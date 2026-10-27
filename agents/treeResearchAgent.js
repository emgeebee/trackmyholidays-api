'use strict';

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const famtreeStore = require('./famtreeStore');
const findmypast = require('./findmypast');

const s3 = new S3Client({});
const DOCS_BUCKET = process.env.DOCS_BUCKET;
const STAGE = process.env.STAGE || 'dev';

function clip(value, limit = 12000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n… truncated`;
}

function stringFromEvent(event, keys) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return '';
  const names = Array.isArray(keys) ? keys : [keys];
  for (const key of names) {
    if (typeof event[key] === 'string' && event[key].trim()) return event[key].trim();
  }
  return '';
}

function paramsFromEvent(event) {
  return {
    userid: stringFromEvent(event, ['userid', 'userId', 'user_id']),
    docId: stringFromEvent(event, ['docId', 'treeId', 'tree_id', 'doc_id']),
    token: stringFromEvent(event, ['token', 'findmypastToken', 'fmpAccessToken']),
  };
}

function renderReport(context, changes, narrative) {
  const lines = [
    `# Family tree research ${context.date}`,
    '',
    `Source document: ${context.source.name} (\`${context.source.id}\`) owned by \`${context.source.userid}\``,
    `Research document: ${context.research.name} (\`${context.research.id}\`)`,
    '',
    'The source document was only read. Updates were written to the research document in the docs store, so the two trees can be compared in famtree.',
    context.truncated ? `The walk stopped at ${famtreeStore.MAX_PEOPLE} people.` : '',
    `People considered: ${context.peopleCount}.`,
    '',
    '## Changes',
    '',
  ];

  if (!changes.length) {
    lines.push('No person fields were updated.');
    lines.push('');
  }

  for (const change of changes) {
    lines.push(`### ${change.name} (\`${change.personId}\`)`);
    lines.push('');
    for (const [field, value] of Object.entries(change.fields || {})) {
      lines.push(`- Set \`${field}\` to ${JSON.stringify(value)}`);
    }
    if (change.evidence) lines.push(`- Evidence: ${change.evidence}`);
    lines.push('');
  }

  if (context.extensions.length) {
    lines.push('## Schema extensions', '');
    for (const extension of context.extensions) {
      lines.push(
        `- \`${extension.personId}\` \`${extension.field}\`: ${extension.value} (${extension.evidence})`
      );
    }
    lines.push('');
  }

  lines.push('## Agent notes', '', narrative || 'No narrative returned.', '');
  return lines.filter((line) => line !== undefined).join('\n');
}

async function saveReport(date, markdown, json, overrideExisting = false) {
  if (!DOCS_BUCKET) throw new Error('DOCS_BUCKET is not configured');
  const markdownKey = `reports/tree-research-${date}.md`;
  const jsonKey = overrideExisting ? 'reports/tree-research-latest.json' : `reports/tree-research-${date}.json`;
  
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
  const knownIds = () => new Set(session.people.map((person) => person.id));

  const listPeople = tool({
    name: 'list_people',
    description:
      'List people already copied into the research document, with gaps the research should try to fill.',
    inputSchema: z.object({}),
    callback: async () => clip(session.people.map(famtreeStore.personSnapshot)),
  });

  const getPerson = tool({
    name: 'get_person',
    description: 'Read one person from the research document by id.',
    inputSchema: z.object({
      personId: z.string(),
    }),
    callback: async ({ personId }) => {
      const person = session.research.doc.tree.individuals.find((entry) => entry.id === personId);
      if (!person) return `Unknown person ${personId}`;
      return clip(famtreeStore.personSnapshot(person));
    },
  });

  const updatePerson = tool({
    name: 'update_person',
    description:
      'Update one or more fields on a person in the research document. ' +
      `Supported fields: ${famtreeStore.PERSON_FIELDS.join(', ')}. ` +
      'Only set a field when Findmypast evidence supports it.',
    inputSchema: z.object({
      personId: z.string(),
      given_name: z.string().optional(),
      surname: z.string().optional(),
      surname_at_birth: z.string().optional(),
      known_as: z.string().optional(),
      gender: z.string().optional(),
      date_of_birth: z.string().optional(),
      date_of_death: z.string().optional(),
      is_deceased: z.boolean().optional(),
      place_of_birth: z.string().optional(),
      place_of_death: z.string().optional(),
      notes: z.string().optional(),
      evidence: z.string().describe('Findmypast source or query result this update came from'),
    }),
    callback: async (input) => {
      const { personId, evidence, ...fields } = input;
      if (!knownIds().has(personId)) {
        return `Refused. ${personId} is not a person on the research document.`;
      }
      const before = session.research.doc.tree.individuals.find((entry) => entry.id === personId);
      session.research.doc.tree = famtreeStore.updatePerson(session.research.doc.tree, personId, fields);
      session.research.doc = await famtreeStore.saveDoc(session.source.userid, session.research.doc);
      const cleaned = {};
      for (const key of famtreeStore.PERSON_FIELDS) {
        if (key in fields) cleaned[key] = fields[key];
      }
      session.changes.push({
        personId,
        name: famtreeStore.personLabel(before),
        fields: cleaned,
        evidence,
      });
      const after = session.research.doc.tree.individuals.find((entry) => entry.id === personId);
      return clip({ saved: true, person: famtreeStore.personSnapshot(after), evidence });
    },
  });

  const appendNote = tool({
    name: 'append_note',
    description:
      'Append a research note to a person on the research document without replacing existing notes.',
    inputSchema: z.object({
      personId: z.string(),
      note: z.string(),
      evidence: z.string(),
    }),
    callback: async ({ personId, note, evidence }) => {
      if (!knownIds().has(personId)) {
        return `Refused. ${personId} is not a person on the research document.`;
      }
      const before = session.research.doc.tree.individuals.find((entry) => entry.id === personId);
      const text = `${note.trim()} [${evidence.trim()}]`;
      session.research.doc.tree = famtreeStore.appendNote(session.research.doc.tree, personId, text);
      session.research.doc = await famtreeStore.saveDoc(session.source.userid, session.research.doc);
      session.changes.push({
        personId,
        name: famtreeStore.personLabel(before),
        fields: { notes: text },
        evidence,
      });
      return clip({ saved: true, note: text });
    },
  });

  const recordExtension = tool({
    name: 'record_extension',
    description:
      'Record a useful attribute that the famtree person schema cannot store. ' +
      'It is kept in this run\'s research report only.',
    inputSchema: z.object({
      personId: z.string(),
      field: z.string().describe('Short field name, for example occupation or emigrationShip'),
      value: z.string(),
      evidence: z.string(),
    }),
    callback: async ({ personId, field, value, evidence }) => {
      if (!knownIds().has(personId)) {
        return `Refused. ${personId} is not a person on the research document.`;
      }
      const extension = {
        personId,
        field: field.trim().slice(0, 64),
        value: value.trim().slice(0, 500),
        evidence: evidence.trim().slice(0, 500),
      };
      session.extensions.push(extension);
      return clip({ recorded: true, extension });
    },
  });

  const tools = [listPeople, getPerson, updatePerson, appendNote, recordExtension];

  if (findmypast.hasAccessToken()) {
    tools.push(
      tool({
        name: 'graphql_query',
        description:
          'Run a read-only GraphQL query against Findmypast for evidence. Mutations are refused. ' +
          'Use this to search records or inspect results before updating the research document. ' +
          'Common mistakes: use personId (singular), not personIds or ids. Use proper GraphQL syntax.',
        inputSchema: z.object({
          query: z.string(),
          variables: z.record(z.string(), z.any()).optional(),
        }),
        callback: async ({ query, variables }) => {
          if (findmypast.isMutation(query)) {
            return 'Refused. graphql_query is read-only. Use update_person or append_note to write.';
          }
          
          // Validate for common mistakes
          const vars = variables || {};
          const varNames = Object.keys(vars);
          const warnings = [];
          
          if (varNames.includes('ids') || varNames.includes('personIds')) {
            warnings.push('Warning: You passed "ids" or "personIds" but most queries expect "personId" (singular).');
          }
          
          if (query.includes('$ids') || query.includes('$personIds')) {
            warnings.push('Warning: Query defines $ids or $personIds variable. Check if the schema expects singular "personId" instead.');
          }
          
          try {
            const body = await findmypast.graphql(query, vars);
            
            // Check for GraphQL errors in response
            if (body.errors && body.errors.length > 0) {
              const errorMessages = body.errors.map(e => e.message).join('; ');
              return {
                success: false,
                errors: body.errors,
                message: `GraphQL returned errors: ${errorMessages}`,
                warnings: warnings.length > 0 ? warnings : undefined,
                hint: 'Check the Findmypast GraphQL schema. Common issues: wrong variable names (use personId not ids), wrong query structure, or missing required fields.',
              };
            }
            
            return {
              success: true,
              data: body.data,
              warnings: warnings.length > 0 ? warnings : undefined,
            };
          } catch (err) {
            return {
              success: false,
              error: err.message,
              statusCode: err.statusCode,
              graphqlErrors: err.graphqlErrors,
              warnings: warnings.length > 0 ? warnings : undefined,
              hint: 'Common fixes: verify variable names match the schema (personId not ids), check query syntax, ensure all required arguments are provided.',
            };
          }
        },
      })
    );
  }

  return tools;
}

function buildPrompt(session) {
  const people = session.people.map(famtreeStore.personSnapshot);
  const fmp = findmypast.hasAccessToken()
    ? 'Use graphql_query against Findmypast to gather evidence before updating anyone.'
    : 'No Findmypast token is configured, so only record gaps and extensions; do not invent facts.';

  return `Research the famtree document "${session.source.name}" and add supported details to the research document "${session.research.name}" (${session.research.id}).

People on the research copy:
${clip(people, 20000)}

Rules:
1. Call list_people or get_person before updating anyone.
2. Prefer people with gaps. Only fill a field when evidence supports it.
3. ${fmp}
4. Use update_person for schema fields. Use append_note for narrative research notes. Use record_extension when the schema has no field.
5. Do not invent dates, places or relationships.
6. Stop after the clearest supported additions.
7. Finish with a short account of what you added and what you left out.`;
}

module.exports.treeResearchAgent = async (event, context, callback) => {
  const params = paramsFromEvent(event);
  findmypast.setAccessToken(params.token);

  if (!params.userid || !params.docId) {
    console.log('treeResearchAgent skipped: userid and docId are required event params');
    callback(null, {
      summary:
        'Pass {"userid":"<google-sub>","docId":"<family-tree-doc-id>","token":"<optional-fmp_access_token>"}.',
    });
    return;
  }

  const date = new Date().toISOString().slice(0, 10);
  const session = {
    source: null,
    research: null,
    people: [],
    changes: [],
    extensions: [],
    truncated: false,
  };

  try {
    const trees = await famtreeStore.listFamilyTrees(params.userid);
    if (!trees.length) {
      callback(null, {
        summary: `No family-tree documents found for userid ${params.userid}.`,
      });
      return;
    }

    session.source = famtreeStore.chooseSourceTree(trees, params.docId);
    const walked = famtreeStore.walkPeople(session.source.doc.tree);
    session.people = walked.people;
    session.truncated = walked.truncated;

    const research = famtreeStore.createResearchCopy(session.source.doc, date);
    session.research = {
      id: research.id,
      name: research.name,
      doc: await famtreeStore.saveDoc(session.source.userid, research.doc),
    };

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
        'You research a family tree stored in this API\'s document store. ' +
        'Read the source document and write only to the research document created for this run. ' +
        'Every update needs evidence. Attributes with no person field go in record_extension.',
    });

    const result = await agent.invoke(buildPrompt(session));
    const narrative = result && result.lastMessage ? String(result.lastMessage) : '';

    const markdown = renderReport({
      date,
      source: session.source,
      research: session.research,
      truncated: session.truncated,
      peopleCount: session.people.length,
      extensions: session.extensions,
    }, session.changes, narrative);

    const saved = await saveReport(date, markdown, {
      stage: STAGE,
      date,
      sourceUserId: session.source.userid,
      sourceDocId: session.source.id,
      researchDocId: session.research.id,
      changes: session.changes,
      extensions: session.extensions,
      narrative,
    });

    console.log('treeResearchAgent saved', saved.markdownKey, 'research', session.research.id);
    callback(null, {
      summary: narrative.slice(0, 2000),
      report: saved.markdownKey,
      researchDocId: session.research.id,
      sourceDocId: session.source.id,
    });
  } catch (err) {
    console.error(err);
    callback(err);
  } finally {
    findmypast.setAccessToken('');
  }
};

'use strict';

const GRAPHQL_URL =
  process.env.FINDMPAST_GRAPHQL_URL || 'https://www.findmypast.com/titan/marshal/graphql';
const SOURCE_TREE_ID = process.env.FINDMPAST_SOURCE_TREE_ID || '';

let accessToken = process.env.FINDMPAST_ACCESS_TOKEN || '';

function setAccessToken(token) {
  accessToken = typeof token === 'string' ? token.trim() : '';
}

function hasAccessToken() {
  return Boolean(accessToken);
}

const MAX_PEOPLE = 25;
const FULL_NAME_FACT_TYPE_ID = 100;

const PERSON_QUERY = `
  query fullProfilePersonNamesAndFacts($personId: ID!) {
    person(id: $personId) {
      id
      isLiving
      gender
      givenNames
      surnames
      birthDate
      birthPlace
      deathDate
      names { id givenNames surnames preferred }
      facts {
        id
        description
        preferred
        originalDate
        placeDetail
        factType { id description }
        place { id placeName }
      }
      families {
        id
        father { id }
        mother { id }
        children { id person { id } }
      }
    }
  }
`;

const TREES_QUERY = `
  query jigsawFamilyTreesV2($offset: Int, $limit: Int) {
    familyTreesV2 {
      totalCount
      list(offset: $offset, limit: $limit) {
        id
        title
        familyTreeRef
        personCount
        dateCreated
        rootPerson { id }
      }
    }
  }
`;

const FACT_TYPES_QUERY = `
  query factTypesAndSpouses($familyTreeId: ID!, $personId: ID!) {
    familyTree(id: $familyTreeId) {
      id
      factTypes {
        id
        description
        ownerTypeId
        shape {
          hasPlaceAndAddressFields
          hasDateField
          hasDescriptionField
        }
      }
    }
  }
`;

const HINTS_QUERY = `
  query personHints($familyTreeId: ID!, $personId: ID!, $offset: Int!, $limit: Int!) {
    familyTreeHintsV2(
      familyTreeId: $familyTreeId
      filters: { personIds: [$personId], hintStatusId: 0 }
    ) {
      list(offset: $offset, limit: $limit) {
        id
        personId
        matchGivenNames
        matchSurnames
        matchYear
        matchPlace
        sourceName
        sourceCategory
        sourceRef
        relevance
      }
    }
  }
`;

const CREATE_TREE_MUTATION = `
  mutation treeResearchCreateFamilyTree($familyTree: FamilyTreeInput!) {
    createFamilyTree(familyTree: $familyTree, isOnboarding: false, emitTreeAssistEvent: false) {
      familyTree {
        id
        familyTreeRef
        title
        people { id }
      }
    }
  }
`;

const CREATE_FACT_MUTATION = `
  mutation createPersonFact($personId: ID!, $fact: CreatePersonFactInput!) {
    createPersonFact(personId: $personId, fact: $fact) {
      fact { id }
    }
  }
`;

function isMutation(query) {
  return /^\s*mutation\b/i.test(String(query || ''));
}

function cookieHeader() {
  if (!accessToken) {
    throw new Error('FINDMPAST_ACCESS_TOKEN is not set');
  }
  if (/[;\r\n]/.test(accessToken)) {
    throw new Error('FINDMPAST_ACCESS_TOKEN contains characters that cannot go in a cookie');
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

function assertNoErrors(body, label) {
  if (body.errors && body.errors.length) {
    const message = body.errors.map((error) => error.message).join('; ');
    throw new Error(`${label}: ${message}`);
  }
  return body.data;
}

function preferredName(person) {
  const names = person.names || [];
  const preferred = names.find((name) => name.preferred) || names[0] || {};
  return {
    givenNames: preferred.givenNames || person.givenNames || '',
    surnames: preferred.surnames || person.surnames || '',
  };
}

function relationIds(person) {
  const ids = [];
  for (const family of person.families || []) {
    if (family.father && family.father.id) ids.push(family.father.id);
    if (family.mother && family.mother.id) ids.push(family.mother.id);
    for (const child of family.children || []) {
      const id = (child.person && child.person.id) || child.id;
      if (id && id !== family.id) ids.push(id);
    }
  }
  return ids;
}

function factSignature(fact) {
  return {
    typeId: fact.factType && fact.factType.id != null ? String(fact.factType.id) : '',
    type: (fact.factType && fact.factType.description) || '',
    date: fact.originalDate || '',
    place: (fact.place && fact.place.placeName) || '',
    description: fact.description || '',
    address: fact.placeDetail || '',
  };
}

function sameFact(left, right) {
  const a = factSignature(left);
  const b = factSignature(right);
  return a.typeId === b.typeId && a.date === b.date && a.place === b.place && a.description === b.description;
}

function copiedFactInput(fact, temporaryId) {
  if (!fact.factType || fact.factType.id == null) return null;
  const typeId = Number(fact.factType.id);
  if (!Number.isFinite(typeId) || (typeId >= 100 && typeId <= 199)) return null;

  const input = {
    temporaryId,
    factTypeId: typeId,
    sources: [],
  };
  if (fact.preferred != null) input.preferred = Boolean(fact.preferred);
  if (fact.place && fact.place.placeName) input.place = { placeName: fact.place.placeName };
  if (fact.originalDate) input.dateDetail = fact.originalDate;
  if (fact.description) input.description = fact.description;
  if (fact.placeDetail) input.address = fact.placeDetail;
  return input;
}

function buildPeopleInput(people) {
  let nextId = -1;
  return people.map((person) => {
    const personTempId = nextId;
    nextId -= 1;
    const name = preferredName(person);
    const facts = [];
    for (const fact of (person.facts || []).slice(0, 20)) {
      const input = copiedFactInput(fact, nextId);
      if (!input) continue;
      nextId -= 1;
      facts.push(input);
    }

    const input = {
      temporaryId: personTempId,
      names: [{
        temporaryId: nextId,
        givenNames: name.givenNames,
        surnames: name.surnames,
        sources: [],
        factTypeId: FULL_NAME_FACT_TYPE_ID,
      }],
      facts,
    };
    nextId -= 1;
    if (typeof person.isLiving === 'boolean') input.isLiving = person.isLiving;
    if (person.gender) input.gender = person.gender;
    return input;
  });
}

function buildTreeInput(title, people) {
  const peopleInput = buildPeopleInput(people);
  return {
    familyTree: {
      title,
      people: peopleInput,
      masterSources: [],
      sourceRepos: [],
      families: [],
      children: [],
      rootPerson: peopleInput[0] ? peopleInput[0].temporaryId : -1,
      memberPerson: null,
    },
  };
}

function diffPerson(source, research) {
  const sourceFacts = source.facts || [];
  const researchFacts = research.facts || [];
  const added = researchFacts.filter(
    (fact) => !sourceFacts.some((existing) => sameFact(existing, fact))
  );
  const missing = sourceFacts.filter(
    (fact) => !researchFacts.some((existing) => sameFact(existing, fact))
  );
  return {
    added: added.map(factSignature),
    missingFromResearchCopy: missing.map(factSignature),
  };
}

async function listTrees() {
  const data = assertNoErrors(
    await graphql(TREES_QUERY, { offset: 0, limit: 50 }),
    'list trees'
  );
  const connection = data.familyTreesV2 || {};
  return connection.list || [];
}

function chooseSourceTree(trees) {
  if (SOURCE_TREE_ID) {
    const match = trees.find((tree) => tree.id === SOURCE_TREE_ID);
    if (!match) {
      throw new Error(`FINDMPAST_SOURCE_TREE_ID ${SOURCE_TREE_ID} is not one of your trees`);
    }
    return match;
  }

  const candidates = trees.filter((tree) => !/^research\b/i.test(tree.title || ''));
  candidates.sort((a, b) => Number(b.personCount || 0) - Number(a.personCount || 0));
  if (!candidates.length) {
    throw new Error('No source tree found. Research copies are skipped when choosing automatically.');
  }
  return candidates[0];
}

async function readPerson(personId) {
  const data = assertNoErrors(await graphql(PERSON_QUERY, { personId }), `read person ${personId}`);
  if (!data.person) {
    throw new Error(`Person ${personId} was not returned`);
  }
  return data.person;
}

async function walkTree(rootPersonId) {
  const people = [];
  const seen = new Set();
  const queue = [rootPersonId];

  while (queue.length && people.length < MAX_PEOPLE) {
    const personId = queue.shift();
    if (!personId || seen.has(personId)) continue;
    seen.add(personId);
    let person;
    try {
      person = await readPerson(personId);
    } catch (err) {
      if (people.length === 0) throw err;
      continue;
    }
    people.push(person);
    for (const relatedId of relationIds(person)) {
      if (!seen.has(relatedId)) queue.push(relatedId);
    }
  }

  return { people, truncated: queue.some((id) => !seen.has(id)) };
}

function withoutGender(variables) {
  return {
    familyTree: {
      ...variables.familyTree,
      people: variables.familyTree.people.map((person) => {
        const { gender, ...rest } = person;
        return rest;
      }),
    },
  };
}

async function createResearchTree(title, people) {
  let variables = buildTreeInput(title, people);
  let body = await graphql(CREATE_TREE_MUTATION, variables);
  const message = (body.errors || []).map((error) => error.message).join('; ');
  if (body.errors && /gender/i.test(message)) {
    variables = withoutGender(variables);
    body = await graphql(CREATE_TREE_MUTATION, variables);
  }
  if (body.errors && people.length > 1) {
    body = await graphql(CREATE_TREE_MUTATION, withoutGender(buildTreeInput(title, [people[0]])));
    body.copiedRootOnly = true;
  }
  const data = assertNoErrors(body, 'create research tree');
  const created = data.createFamilyTree && data.createFamilyTree.familyTree;
  if (!created || !created.id) {
    throw new Error('createFamilyTree did not return a tree id');
  }
  return {
    tree: created,
    copiedRootOnly: Boolean(body.copiedRootOnly),
    requestedCount: body.copiedRootOnly ? 1 : people.length,
  };
}

async function factTypes(familyTreeId, personId) {
  const data = assertNoErrors(
    await graphql(FACT_TYPES_QUERY, { familyTreeId, personId }),
    'fact types'
  );
  return (data.familyTree && data.familyTree.factTypes) || [];
}

async function hintsForPerson(familyTreeId, personId) {
  const data = assertNoErrors(
    await graphql(HINTS_QUERY, { familyTreeId, personId, offset: 0, limit: 8 }),
    'hints'
  );
  const connection = data.familyTreeHintsV2 || {};
  return connection.list || [];
}

async function addPersonFact(personId, fact) {
  const input = {
    factTypeId: Number(fact.factTypeId),
    preferred: fact.preferred !== false,
    isPrivate: false,
  };
  if (!Number.isFinite(input.factTypeId)) {
    throw new Error('factTypeId must be a number from fact_types');
  }
  if (fact.placeName) input.place = { placeName: fact.placeName };
  if (fact.originalDate) input.originalDate = fact.originalDate;
  if (fact.description) input.description = fact.description;
  if (fact.address) input.address = fact.address;

  const data = assertNoErrors(
    await graphql(CREATE_FACT_MUTATION, { personId, fact: input }),
    'create person fact'
  );
  return data.createPersonFact;
}

module.exports = {
  GRAPHQL_URL,
  setAccessToken,
  hasAccessToken,
  MAX_PEOPLE,
  isMutation,
  graphql,
  preferredName,
  factSignature,
  sameFact,
  diffPerson,
  buildTreeInput,
  listTrees,
  chooseSourceTree,
  readPerson,
  walkTree,
  createResearchTree,
  factTypes,
  hintsForPerson,
  addPersonFact,
};

'use strict';

const crypto = require('crypto');
const docStore = require('../holidays/docs/docStore');

const TREE_DOC_TYPE = 'family-tree';
const LEGACY_TREE_ID = 'family-tree';
const MAX_PEOPLE = 25;
const PERSON_FIELDS = [
  'given_name',
  'surname',
  'surname_at_birth',
  'known_as',
  'gender',
  'date_of_birth',
  'date_of_death',
  'is_deceased',
  'place_of_birth',
  'place_of_death',
  'notes',
];

function isValidTree(tree) {
  return Boolean(
    tree &&
      typeof tree.tree === 'object' &&
      tree.tree !== null &&
      Array.isArray(tree.individuals) &&
      Array.isArray(tree.parent_relationships) &&
      Array.isArray(tree.partner_relationships) &&
      tree.individuals.every((person) => person && typeof person.id === 'string')
  );
}

function isFamilyTreeDoc(doc) {
  if (!doc || !isValidTree(doc.tree)) return false;
  return doc.type === TREE_DOC_TYPE || doc.id === LEGACY_TREE_ID;
}

function treeName(doc) {
  return (doc.tree && doc.tree.tree && doc.tree.tree.name && String(doc.tree.tree.name).trim()) ||
    (doc.name && String(doc.name).trim()) ||
    'Untitled tree';
}

function personCount(doc) {
  return (doc.tree && doc.tree.individuals && doc.tree.individuals.length) || 0;
}

function isResearchTitle(name) {
  return /^research\b/i.test(name || '');
}

function toRecord(doc, userid) {
  return {
    userid,
    id: doc.id,
    name: treeName(doc),
    personCount: personCount(doc),
    updatedAt: doc.updatedAt,
    doc,
  };
}

async function listFamilyTrees(userid) {
  if (!userid) return [];
  const docs = await docStore.listDocs(userid);
  return docs.filter(isFamilyTreeDoc).map((doc) => toRecord(doc, userid));
}

function chooseSourceTree(trees, preferredDocId) {
  if (preferredDocId) {
    const match = trees.find((tree) => tree.id === preferredDocId);
    if (!match) {
      throw new Error(`docId ${preferredDocId} is not one of the stored family trees`);
    }
    return match;
  }

  const candidates = trees.filter((tree) => !isResearchTitle(tree.name));
  candidates.sort((a, b) => Number(b.personCount || 0) - Number(a.personCount || 0));
  if (!candidates.length) {
    throw new Error('No source tree found. Research copies are skipped when choosing automatically.');
  }
  return candidates[0];
}

function parseIndividualIds(partnerRelationship) {
  try {
    const ids = JSON.parse(partnerRelationship.individual_ids);
    return Array.isArray(ids) ? ids : [];
  } catch (err) {
    return [];
  }
}

function buildFamilyIndex(tree) {
  const membersByRelationship = new Map(
    (tree.partner_relationships || []).map((relationship) => [
      relationship.id,
      parseIndividualIds(relationship),
    ])
  );
  const individualIds = new Set((tree.individuals || []).map((person) => person.id));
  const parentIdsByChild = new Map();

  for (const link of tree.parent_relationships || []) {
    const parentIds = parentIdsByChild.get(link.child_id) || [];
    for (const id of membersByRelationship.get(link.partner_relationship_id) || []) {
      if (id !== link.child_id && individualIds.has(id) && !parentIds.includes(id)) {
        parentIds.push(id);
      }
    }
    parentIdsByChild.set(link.child_id, parentIds);
  }

  const people = {};
  for (const individual of tree.individuals || []) {
    people[individual.id] = {
      ...individual,
      parentIds: parentIdsByChild.get(individual.id) || [],
    };
  }
  return people;
}

function defaultFocusId(tree) {
  const own = tree.individuals.find(
    (person) => person.user_id && tree.tree && person.user_id === tree.tree.user_id
  );
  const root = tree.individuals.find((person) => tree.tree && person.id === tree.tree.root_id);
  return (own || root || tree.individuals[0] || {}).id || null;
}

function personLabel(person) {
  return [person.given_name, person.surname].filter(Boolean).join(' ') || person.id;
}

function gapSummary(person) {
  const missing = [];
  if (!person.date_of_birth) missing.push('date_of_birth');
  if (!person.place_of_birth) missing.push('place_of_birth');
  if ((person.is_deceased || person.date_of_death) && !person.date_of_death) missing.push('date_of_death');
  if ((person.is_deceased || person.date_of_death) && !person.place_of_death) missing.push('place_of_death');
  if (!person.gender) missing.push('gender');
  return missing;
}

function walkPeople(tree, maxPeople = MAX_PEOPLE) {
  const people = buildFamilyIndex(tree);
  const focusId = defaultFocusId(tree);
  const ordered = [];
  const seen = new Set();
  const queue = focusId ? [focusId] : Object.keys(people);

  while (queue.length && ordered.length < maxPeople) {
    const id = queue.shift();
    if (!id || seen.has(id) || !people[id]) continue;
    seen.add(id);
    ordered.push(people[id]);
    const person = people[id];
    for (const parentId of person.parentIds || []) {
      if (!seen.has(parentId)) queue.push(parentId);
    }
    for (const other of Object.values(people)) {
      if (!seen.has(other.id) && (other.parentIds || []).includes(id)) {
        queue.push(other.id);
      }
    }
  }

  return {
    people: ordered,
    truncated: queue.some((id) => id && !seen.has(id) && people[id]),
  };
}

function timestamp(date = new Date()) {
  return date.toISOString().replace(/Z$/, '000Z');
}

function cleanFields(fields = {}) {
  const out = {};
  for (const key of PERSON_FIELDS) {
    if (!(key in fields)) continue;
    const value = fields[key];
    if (key === 'is_deceased') {
      out[key] = Boolean(value);
      continue;
    }
    out[key] = typeof value === 'string' ? value.trim() || null : value;
  }
  return out;
}

function cloneTree(tree) {
  return JSON.parse(JSON.stringify(tree));
}

function createResearchCopy(sourceDoc, date) {
  const now = timestamp();
  const researchId = `tree-research-${date.replace(/-/g, '')}-${crypto.randomUUID().slice(0, 8)}`;
  const tree = cloneTree(sourceDoc.tree);
  const name = `Research ${treeName(sourceDoc)} ${date}`;
  tree.tree = {
    ...tree.tree,
    uuid: crypto.randomUUID(),
    name,
    created_at: now,
    updated_at: now,
  };
  const doc = {
    id: researchId,
    type: TREE_DOC_TYPE,
    name,
    tree,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return { id: researchId, name, doc };
}

function updatePerson(tree, personId, fields) {
  const cleaned = cleanFields(fields);
  if (!Object.keys(cleaned).length) {
    throw new Error('No supported person fields to update');
  }
  const now = timestamp();
  let found = false;
  const individuals = tree.individuals.map((person) => {
    if (person.id !== personId) return person;
    found = true;
    const next = { ...person, ...cleaned, updated_at: now };
    if (cleaned.date_of_death && cleaned.is_deceased == null) next.is_deceased = true;
    return next;
  });
  if (!found) throw new Error(`Unknown person ${personId}`);
  return {
    ...tree,
    individuals,
    tree: { ...tree.tree, updated_at: now },
  };
}

function appendNote(tree, personId, note) {
  const text = String(note || '').trim();
  if (!text) throw new Error('note must not be empty');
  const person = (tree.individuals || []).find((entry) => entry.id === personId);
  if (!person) throw new Error(`Unknown person ${personId}`);
  const existing = person.notes ? `${person.notes}\n` : '';
  return updatePerson(tree, personId, { notes: `${existing}${text}` });
}

function personSnapshot(person) {
  return {
    id: person.id,
    name: personLabel(person),
    given_name: person.given_name || null,
    surname: person.surname || null,
    surname_at_birth: person.surname_at_birth || null,
    known_as: person.known_as || null,
    gender: person.gender || null,
    date_of_birth: person.date_of_birth || null,
    place_of_birth: person.place_of_birth || null,
    date_of_death: person.date_of_death || null,
    place_of_death: person.place_of_death || null,
    is_deceased: Boolean(person.is_deceased),
    notes: person.notes || null,
    gaps: gapSummary(person),
  };
}

async function saveDoc(userid, doc) {
  const next = {
    ...doc,
    updatedAt: new Date().toISOString(),
  };
  await docStore.putDoc(userid, doc.id, next);
  return next;
}

module.exports = {
  TREE_DOC_TYPE,
  MAX_PEOPLE,
  PERSON_FIELDS,
  isValidTree,
  isFamilyTreeDoc,
  treeName,
  listFamilyTrees,
  chooseSourceTree,
  walkPeople,
  personLabel,
  gapSummary,
  personSnapshot,
  createResearchCopy,
  updatePerson,
  appendNote,
  saveDoc,
  cloneTree,
};

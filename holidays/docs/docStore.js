'use strict';

const fs = require('fs').promises;
const path = require('path');
const AWS = require('aws-sdk'); // eslint-disable-line import/no-extraneous-dependencies

const BUCKET = process.env.DOCS_BUCKET;
const PREFIX = 'docs';
const LOCAL_ROOT = path.join(__dirname, '../../offline/docs');
const s3 = new AWS.S3();

function s3Key(userid, id) {
  return `${PREFIX}/${userid}/${id}.json`;
}

function localPath(userid, id) {
  return path.join(LOCAL_ROOT, userid, `${id}.json`);
}

function validateDocId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id);
}

async function getDoc(userid, id) {
  if (process.env.IS_OFFLINE) {
    try {
      const data = await fs.readFile(localPath(userid, id), 'utf8');
      return JSON.parse(data);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  try {
    const result = await s3
      .getObject({ Bucket: BUCKET, Key: s3Key(userid, id) })
      .promise();
    return JSON.parse(result.Body.toString());
  } catch (err) {
    if (err.code === 'NoSuchKey') {
      return null;
    }
    throw err;
  }
}

async function putDoc(userid, id, doc) {
  const body = JSON.stringify(doc, null, 2);

  if (process.env.IS_OFFLINE) {
    const filePath = localPath(userid, id);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body);
    return;
  }

  await s3
    .putObject({
      Bucket: BUCKET,
      Key: s3Key(userid, id),
      Body: body,
      ContentType: 'application/json',
    })
    .promise();
}

async function deleteDoc(userid, id) {
  if (process.env.IS_OFFLINE) {
    try {
      await fs.unlink(localPath(userid, id));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }
    return;
  }

  await s3
    .deleteObject({ Bucket: BUCKET, Key: s3Key(userid, id) })
    .promise();
}

async function listDocs(userid) {
  if (process.env.IS_OFFLINE) {
    const dir = path.join(LOCAL_ROOT, userid);
    try {
      const files = await fs.readdir(dir);
      const docs = await Promise.all(
        files
          .filter((file) => file.endsWith('.json'))
          .map(async (file) => {
            const data = await fs.readFile(path.join(dir, file), 'utf8');
            return JSON.parse(data);
          })
      );
      return docs;
    } catch (err) {
      if (err.code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  const result = await s3
    .listObjectsV2({
      Bucket: BUCKET,
      Prefix: `${PREFIX}/${userid}/`,
    })
    .promise();

  if (!result.Contents || result.Contents.length === 0) {
    return [];
  }

  const docs = await Promise.all(
    result.Contents.map(async (item) => {
      const object = await s3
        .getObject({ Bucket: BUCKET, Key: item.Key })
        .promise();
      return JSON.parse(object.Body.toString());
    })
  );

  return docs;
}

module.exports = {
  validateDocId,
  getDoc,
  putDoc,
  deleteDoc,
  listDocs,
};

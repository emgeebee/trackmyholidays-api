'use strict';

const fs = require('fs').promises;
const path = require('path');
const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');

const BUCKET = process.env.DOCS_BUCKET;
const PREFIX = 'docs';
const LOCAL_ROOT = path.join(__dirname, '../../offline/docs');
const s3 = new S3Client({});

function s3Key(userid, id) {
  return `${PREFIX}/${userid}/${id}.json`;
}

function localPath(userid, id) {
  return path.join(LOCAL_ROOT, userid, `${id}.json`);
}

function validateDocId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id);
}

async function streamToString(body) {
  if (!body) {
    return '';
  }
  if (typeof body.transformToString === 'function') {
    return body.transformToString();
  }

  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
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
    const result = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: s3Key(userid, id) })
    );
    return JSON.parse(await streamToString(result.Body));
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
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

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: s3Key(userid, id),
      Body: body,
      ContentType: 'application/json',
    })
  );
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

  await s3.send(
    new DeleteObjectCommand({ Bucket: BUCKET, Key: s3Key(userid, id) })
  );
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

  const result = await s3.send(
    new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: `${PREFIX}/${userid}/`,
    })
  );

  if (!result.Contents || result.Contents.length === 0) {
    return [];
  }

  const docs = await Promise.all(
    result.Contents.map(async (item) => {
      const object = await s3.send(
        new GetObjectCommand({ Bucket: BUCKET, Key: item.Key })
      );
      return JSON.parse(await streamToString(object.Body));
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

const { app } = require('@azure/functions');
const { BlockBlobClient } = require('@azure/storage-blob');
const { createHash } = require('node:crypto');
const { text } = require('node:stream/consumers');

function reply(status, jsonBody) {
  return {
    status,
    jsonBody,
    headers: { 'Cache-Control': 'no-store' }
  };
}

app.http('studyData', {
  route: 'study-data',
  methods: ['GET', 'PUT'],
  authLevel: 'anonymous',

  handler: async (request, context) => {
    const principalHeader = request.headers.get('x-ms-client-principal');
    if (!principalHeader) {
      return reply(401, { error: '请先登录 GitHub' });
    }

    let user;
    try {
      user = JSON.parse(
        Buffer.from(principalHeader, 'base64').toString('utf8')
      );
    } catch {
      return reply(401, { error: '无法识别登录身份' });
    }

    if (
      user?.identityProvider !== 'github' ||
      typeof user.userId !== 'string' ||
      !user.userId ||
      !Array.isArray(user.userRoles) ||
      !user.userRoles.includes('owner')
    ) {
      return reply(403, { error: '此账号没有 owner 角色' });
    }

    const connection = process.env.LINGUA_STORAGE_CONNECTION;
    if (!connection) {
      return reply(500, { error: 'Azure 尚未设置 LINGUA_STORAGE_CONNECTION' });
    }

    try {
      const fileId = createHash('sha256')
        .update(`github:${user.userId}`)
        .digest('hex');
      const blob = new BlockBlobClient(
        connection,
        'lingua-data',
        `${fileId}.json`
      );

      if (request.method === 'GET') {
        const download = await blob.download();
        const data = JSON.parse(await text(download.readableStreamBody));
        return reply(200, { ok: true, data, version: download.etag });
      }

      const raw = await request.text();
      if (Buffer.byteLength(raw, 'utf8') > 2 * 1024 * 1024) {
        return reply(413, { error: '记录超过 2 MB' });
      }

      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return reply(400, { error: '记录必须是有效的 JSON' });
      }

      const { data, version } = body || {};
      if (
        !Array.isArray(data?.grammar) ||
        !Array.isArray(data?.words) ||
        (version !== null && !/^"[^",\r\n]+"$/.test(
          typeof version === 'string' ? version : ''
        ))
      ) {
        return reply(400, { error: '学习记录或版本格式不正确' });
      }

      const result = await blob.uploadData(
        Buffer.from(JSON.stringify({
          grammar: data.grammar,
          words: data.words
        })),
        {
          blobHTTPHeaders: { blobContentType: 'application/json' },
          conditions: version === null
            ? { ifNoneMatch: '*' }
            : { ifMatch: version }
        }
      );

      return reply(200, { ok: true, version: result.etag });
    } catch (error) {
      if (request.method === 'GET' && error.code === 'BlobNotFound') {
        return reply(200, { ok: true, data: null, version: null });
      }
      if (error.statusCode === 412 || error.code === 'BlobAlreadyExists') {
        return reply(409, { error: '云端已有更新，请先读取云端记录' });
      }

      context.error('Blob operation failed', error.code || error.name);
      return reply(500, {
        error: '云存储连接失败，请检查环境变量和 lingua-data 容器'
      });
    }
  }
});

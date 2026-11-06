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

const languageCodes = new Set(['en', 'ja', 'zh-Hans']);
function translatorOwner(request) {
  try {
    const header = request.headers.get('x-ms-client-principal') || '';
    const user = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    return user?.identityProvider === 'github' &&
      Boolean(user.userId) && Array.isArray(user.userRoles) &&
      user.userRoles.includes('owner');
  } catch {
    return false;
  }
}

function translatorBlob(name) {
  return new BlockBlobClient(process.env.LINGUA_STORAGE_CONNECTION, 'lingua-data', name);
}

async function readTranslatorBlob(blob, fallback) {
  try {
    const result = await blob.download();
    return { value: JSON.parse(await text(result.readableStreamBody)), etag: result.etag };
  } catch (error) {
    if (error.code === 'BlobNotFound') return { value: fallback, etag: null };
    throw error;
  }
}

// A shared daily limit applies across visitors and function instances.
async function reserveVisitorCharacters(amount) {
  const day = new Date().toISOString().slice(0, 10);
  const blob = translatorBlob('translator-usage-' + day + '.json');
  for (let attempt = 0; attempt < 5; attempt++) {
    const { value, etag } = await readTranslatorBlob(blob, { count: 0 });
    if (value.count + amount > 20000) return false;
    try {
      await blob.uploadData(Buffer.from(JSON.stringify({ count: value.count + amount })), {
        conditions: etag ? { ifMatch: etag } : { ifNoneMatch: '*' }
      });
      return true;
    } catch (error) {
      if (error.statusCode !== 412 && error.code !== 'BlobAlreadyExists') throw error;
    }
  }
  return false;
}

app.http('translatorAccess', {
  route: 'translator-access',
  methods: ['GET', 'PUT'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const owner = translatorOwner(request);
    const configured = Boolean(process.env.LINGUA_TRANSLATOR_KEY);
    if (request.method === 'PUT' && !owner) return reply(403, { error: '仅管理员可以修改共享设置' });
    if (!configured) {
      return request.method === 'GET'
        ? reply(200, { owner, configured: false, shared: false })
        : reply(409, { error: '请先在 Azure 配置翻译密钥' });
    }
    try {
      const settings = translatorBlob('translator-access.json');
      if (request.method === 'PUT') {
        const body = await request.json().catch(() => null);
        if (typeof body?.shared !== 'boolean') return reply(400, { error: '共享设置无效' });
        await settings.uploadData(Buffer.from(JSON.stringify({ shared: body.shared })));
        return reply(200, { owner, configured, shared: body.shared });
      }
      const { value } = await readTranslatorBlob(settings, { shared: false });
      return reply(200, { owner, configured, shared: value.shared === true });
    } catch (error) {
      context.error('Translator settings failed', error.code || error.name);
      return reply(503, { error: '暂时无法读取翻译共享设置' });
    }
  }
});

app.http('translateText', {
  route: 'translate-text',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const key = process.env.LINGUA_TRANSLATOR_KEY;
    if (!key) return reply(503, { error: '云端翻译尚未配置' });

    const body = await request.json().catch(() => null);
    const { operation, source, target, input } = body || {};
    if (typeof input !== 'string' || !input.trim() || input.length > 5000 ||
        !['translate', 'detect'].includes(operation) ||
        (operation === 'translate' && (!languageCodes.has(source) || !languageCodes.has(target)))) {
      return reply(400, { error: '翻译请求无效' });
    }
    try {
      if (!translatorOwner(request)) {
        const { value } = await readTranslatorBlob(translatorBlob('translator-access.json'), { shared: false });
        if (value.shared !== true) return reply(403, { error: '翻译共享目前已关闭' });
        if (!await reserveVisitorCharacters(input.length)) {
          return reply(429, { error: '访客今日的共享翻译额度已用完' });
        }
      }
      const query = new URLSearchParams({ 'api-version': '3.0' });
      if (operation === 'translate') {
        query.set('from', source);
        query.set('to', target);
      }
      const headers = { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': key };
      if (process.env.LINGUA_TRANSLATOR_REGION) {
        headers['Ocp-Apim-Subscription-Region'] = process.env.LINGUA_TRANSLATOR_REGION;
      }
      const result = await fetch('https://api.cognitive.microsofttranslator.com/' + operation + '?' + query, {
        method: 'POST', headers, body: JSON.stringify([{ Text: input }]), signal: AbortSignal.timeout(12000)
      });
      if (!result.ok) return reply(result.status === 429 ? 429 : 502, { error: '翻译服务暂不可用，请稍后再试' });
      return reply(200, await result.json());
    } catch (error) {
      context.error('Translate request failed', error.code || error.name);
      return reply(503, { error: '翻译暂不可用，请稍后再试' });
    }
  }
});

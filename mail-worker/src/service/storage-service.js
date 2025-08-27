// src/storage.js
// 基于 aws4fetch 的 MinIO 客户端（兼容 Cloudflare Workers）

import { AwsClient } from 'aws4fetch';

// S3 key 编码：分段 encodeURIComponent，保留 '/'
function encodeS3Key(key) {
  return key.split('/').map(encodeURIComponent).join('/');
}

// SigV4（aws4fetch）
class MinIOClient {
  constructor(endpoint, accessKey, secretKey, bucketName, region = 'us-east-1') {
    this.endpoint = String(endpoint || '').replace(/\/+$/, '');
    this.bucketName = bucketName;
    this.region = region;
    this.awsClient = new AwsClient({
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
      service: 's3',
      region,
    });

    // 不打印任何密钥
    console.log('MinIO 初始化:', {
      endpoint: this.endpoint,
      bucket: this.bucketName,
      region: this.region,
    });
  }

  _url(key) {
    return `${this.endpoint}/${this.bucketName}/${encodeS3Key(key)}`;
  }

  _normalizeBody(content) {
    if (content instanceof Uint8Array) return content;
    if (content instanceof ArrayBuffer) return new Uint8Array(content);
    if (typeof content === 'string') return new TextEncoder().encode(content);
    // 允许 Blob / ReadableStream
    return content;
  }

  async putObject(key, content, contentType = 'application/octet-stream', extraHeaders = {}) {
    const body = this._normalizeBody(content);
    const url = this._url(key);

    const resp = await this.awsClient.fetch(url, {
      method: 'PUT',
      body,
      headers: { 'Content-Type': contentType, ...extraHeaders },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      const reqId = resp.headers.get('x-amz-request-id');
      const hint403 = '（可能：权限不足、时间漂移、区域不一致、或请求未到达 MinIO 被反代/WAF 拦截）';
      const hint400 = '（可能：签名/URL 编码/请求体格式问题）';
      const hint = resp.status === 403 ? hint403 : resp.status === 400 ? hint400 :
                   (text.includes('SignatureDoesNotMatch') ? '（签名不匹配：检查时间/区域/密钥）' : '');
      throw new Error(`MinIO PUT 失败：${resp.status} ${resp.statusText} ${hint}; reqId=${reqId}; body=${text.slice(0, 200)}`);
    }

    const ETag = resp.headers.get('ETag') || undefined;
    const size =
      (body && body.length !== undefined && body.length) ??
      (body && body.size   !== undefined && body.size) ??
      undefined;

    return { success: true, key, ETag, ...(size !== undefined ? { size } : {}) };
  }

  async headObject(key) {
    const resp = await this.awsClient.fetch(this._url(key), { method: 'HEAD' });
    if (resp.status === 404) return null;
    if (!resp.ok) {
      const reqId = resp.headers.get('x-amz-request-id');
      throw new Error(`MinIO HEAD 失败：${resp.status} ${resp.statusText}; reqId=${reqId}`);
    }
    return {
      ContentLength: Number(resp.headers.get('Content-Length') || 0),
      ContentType: resp.headers.get('Content-Type') || undefined,
      ETag: resp.headers.get('ETag') || undefined,
      LastModified: resp.headers.get('Last-Modified') || undefined,
    };
  }

  async getObject(key) {
    const resp = await this.awsClient.fetch(this._url(key), { method: 'GET' });
    if (!resp.ok) {
      const reqId = resp.headers.get('x-amz-request-id');
      throw new Error(`MinIO GET 失败：${resp.status} ${resp.statusText}; reqId=${reqId}`);
    }
    return {
      body: resp.body, // ReadableStream
      httpMetadata: {
        contentType: resp.headers.get('Content-Type') || 'application/octet-stream',
      },
    };
  }

  async deleteObject(key) {
    const resp = await this.awsClient.fetch(this._url(key), { method: 'DELETE' });
    if (!resp.ok) {
      const reqId = resp.headers.get('x-amz-request-id');
      throw new Error(`MinIO DELETE 失败：${resp.status} ${resp.statusText}; reqId=${reqId}`);
    }
    return { success: true };
  }
}

// 对外导出的存储服务：R2 / MinIO 二选一
const storageService = {
  _minio(c) {
    return new MinIOClient(
      c.env.MINIO_ENDPOINT,     // 形如 http(s)://host:port（不带桶/路径）
      c.env.MINIO_ACCESS_KEY,   // Secret
      c.env.MINIO_SECRET_KEY,   // Secret
      c.env.MINIO_BUCKET_NAME,  // 形如 attachment
      'us-east-1',              // 与签名配置一致；MinIO 通常可用默认
    );
  },

  // 上传
  async putObj(c, key, content, metadata) {
    const storage = c.env.STORAGE_TYPE || 'r2';

    // 为空判断：Uint8Array/ArrayBuffer/string/Blob
    const isEmpty =
      content == null ||
      (content.byteLength !== undefined && content.byteLength === 0) ||
      (content.length !== undefined && content.length === 0) ||
      (content.size !== undefined && content.size === 0); // Blob
    if (isEmpty) throw new Error(`附件内容为空，无法上传：${key}`);

    if (storage === 'minio') {
      return this._minio(c).putObject(
        key,
        content,
        metadata?.contentType || 'application/octet-stream',
        {
          ...(metadata?.cacheControl ? { 'Cache-Control': metadata.cacheControl } : {}),
          ...(metadata?.contentDisposition ? { 'Content-Disposition': metadata.contentDisposition } : {}),
          // 可加 x-amz-meta-* 自定义元数据
        },
      );
    }

    // R2 分支（仅在绑定了 r2 时可用）
    return c.env.r2.put(key, content, { httpMetadata: { ...(metadata || {}) } });
  },

  // 获取
  async getObj(c, key) {
    const storage = c.env.STORAGE_TYPE || 'r2';
    if (storage === 'minio') return this._minio(c).getObject(key);
    return c.env.r2.get(key);
  },

  // 删除
  async delete(c, key) {
    const storage = c.env.STORAGE_TYPE || 'r2';
    if (storage === 'minio') return this._minio(c).deleteObject(key);
    return c.env.r2.delete(key);
  },

  // 直链（私有桶会 403，生产建议用预签名 URL）
  getFileUrl(c, key) {
    const storage = c.env.STORAGE_TYPE || 'r2';
    if (storage === 'minio') {
      return `${c.env.MINIO_ENDPOINT}/${c.env.MINIO_BUCKET_NAME}/${encodeS3Key(key)}`;
    }
    const r2Domain = c.env.R2_DOMAIN;
    return r2Domain ? `${r2Domain}/${key}` : null;
  },

  // 存在性检查
  async checkFileExists(c, key) {
    const storage = c.env.STORAGE_TYPE || 'r2';
    if (storage === 'minio') return this._minio(c).headObject(key);
    try {
      const head = await c.env.r2.head(key);
      return head || null;
    } catch {
      return null;
    }
  },
};

export default storageService;
export { MinIOClient, encodeS3Key };

// 简化的MinIO HTTP客户端，专门用于Cloudflare Workers环境
class MinIOClient {
    constructor(endpoint, accessKey, secretKey, bucketName) {
        this.endpoint = endpoint;
        this.accessKey = accessKey;
        this.secretKey = secretKey;
        this.bucketName = bucketName;
    }

    // 生成AWS4签名
    async createAWSSignature(method, path, headers, body = '') {
        // 在Cloudflare Workers中使用crypto
        const service = 's3';
        const region = 'us-east-1'; // MinIO默认区域
        const algorithm = 'AWS4-HMAC-SHA256';
        const date = new Date();
        const dateStamp = date.toISOString().slice(0, 10).replace(/-/g, '');
        const amzDate = date.toISOString().slice(0, -5).replace(/[:-]/g, '') + 'Z';
        
        // 标准化头信息
        const canonicalHeaders = Object.keys(headers)
            .map(key => `${key.toLowerCase()}:${headers[key]}\n`)
            .sort()
            .join('');
            
        const signedHeaders = Object.keys(headers)
            .map(key => key.toLowerCase())
            .sort()
            .join(';');
        
        // 计算payload hash
        const encoder = new TextEncoder();
        const data = typeof body === 'string' ? encoder.encode(body) : body;
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const payloadHash = Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
        
        // 构建标准请求
        const canonicalRequest = [
            method,
            path,
            '', // query string
            canonicalHeaders,
            signedHeaders,
            payloadHash
        ].join('\n');
        
        // 创建签名字符串
        const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
        const requestHashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(canonicalRequest));
        const requestHash = Array.from(new Uint8Array(requestHashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
            
        const stringToSign = [
            algorithm,
            amzDate,
            credentialScope,
            requestHash
        ].join('\n');
        
        // 计算签名
        const getSignatureKey = async (key, dateStamp, regionName, serviceName) => {
            const kDate = await this.hmacSha256('AWS4' + key, dateStamp);
            const kRegion = await this.hmacSha256(kDate, regionName);
            const kService = await this.hmacSha256(kRegion, serviceName);
            const kSigning = await this.hmacSha256(kService, 'aws4_request');
            return kSigning;
        };
        
        const signingKey = await getSignatureKey(this.secretKey, dateStamp, region, service);
        const signature = await this.hmacSha256(signingKey, stringToSign);
        const signatureHex = Array.from(new Uint8Array(signature))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
        
        // 构建Authorization头
        const authorization = `${algorithm} Credential=${this.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signatureHex}`;
        
        return {
            'Authorization': authorization,
            'X-Amz-Date': amzDate,
            'X-Amz-Content-Sha256': payloadHash
        };
    }
    
    // HMAC-SHA256辅助函数
    async hmacSha256(key, data) {
        const encoder = new TextEncoder();
        const keyBuffer = typeof key === 'string' ? encoder.encode(key) : key;
        const dataBuffer = typeof data === 'string' ? encoder.encode(data) : data;
        
        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            keyBuffer,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        
        return await crypto.subtle.sign('HMAC', cryptoKey, dataBuffer);
    }

    // 使用原生HTTP PUT上传文件
    async putObject(key, content, contentType = 'application/octet-stream') {
        const url = `${this.endpoint}/${this.bucketName}/${key}`;
        const path = `/${this.bucketName}/${key}`;
        
        console.log(`MinIO直接HTTP上传: ${url}`);
        console.log(`内容大小: ${content.byteLength || content.length} bytes`);
        
        // 准备头信息
        const headers = {
            'Content-Type': contentType,
            'Content-Length': (content.byteLength || content.length).toString(),
            'Host': url.split('/')[2] // 从 URL 中提取 host
        };
        
        // 生成AWS4签名
        const authHeaders = await this.createAWSSignature('PUT', path, headers, content);
        
        // 合并头信息
        const finalHeaders = {
            ...headers,
            ...authHeaders,
            'Cache-Control': 'no-cache'
        };
        
        try {
            const response = await fetch(url, {
                method: 'PUT',
                headers: finalHeaders,
                body: content
            });

            console.log(`MinIO HTTP响应状态: ${response.status}`);
            console.log(`响应头:`, Object.fromEntries(response.headers.entries()));
            
            if (response.ok || response.status === 200) {
                const etag = response.headers.get('ETag') || response.headers.get('etag');
                console.log(`MinIO HTTP上传成功: ${key}, ETag: ${etag}`);
                return { ETag: etag, success: true, status: response.status };
            } else {
                const errorText = await response.text().catch(() => 'No response text');
                console.error(`MinIO HTTP上传失败: ${response.status} - ${errorText}`);
                
                // 即使返回错误状态码，也检查是否实际上传成功
                if (response.status >= 200 && response.status < 300) {
                    console.log('状态码显示成功，忽略错误文本');
                    return { ETag: 'http-success', success: true, status: response.status };
                }
                
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
        } catch (error) {
            console.error(`MinIO HTTP请求失败:`, error);
            throw error;
        }
    }

    // 检查文件是否存在
    async headObject(key) {
        const url = `${this.endpoint}/${this.bucketName}/${key}`;
        
        try {
            const response = await fetch(url, {
                method: 'HEAD',
                headers: {
                    'Cache-Control': 'no-cache'
                }
            });

            console.log(`MinIO HEAD响应状态: ${response.status}`);

            if (response.ok || response.status === 200) {
                return {
                    ContentLength: response.headers.get('Content-Length'),
                    ContentType: response.headers.get('Content-Type'),
                    ETag: response.headers.get('ETag') || response.headers.get('etag')
                };
            } else if (response.status === 404) {
                return null;
            } else {
                const errorText = await response.text().catch(() => 'No response text');
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
        } catch (error) {
            console.error(`MinIO HEAD请求失败:`, error);
            throw error;
        }
    }

    // 获取对象
    async getObject(key) {
        const url = `${this.endpoint}/${this.bucketName}/${key}`;
        
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Cache-Control': 'no-cache'
                }
            });

            if (response.ok) {
                return {
                    body: response.body,
                    httpMetadata: {
                        contentType: response.headers.get('Content-Type'),
                        contentDisposition: response.headers.get('Content-Disposition'),
                    }
                };
            } else {
                const errorText = await response.text().catch(() => 'No response text');
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
        } catch (error) {
            console.error(`MinIO GET请求失败:`, error);
            throw error;
        }
    }

    // 删除对象
    async deleteObject(key) {
        const url = `${this.endpoint}/${this.bucketName}/${key}`;
        
        try {
            const response = await fetch(url, {
                method: 'DELETE',
                headers: {
                    'Cache-Control': 'no-cache'
                }
            });

            if (response.ok || response.status === 204) {
                console.log(`MinIO HTTP删除成功: ${key}`);
                return { success: true };
            } else {
                const errorText = await response.text().catch(() => 'No response text');
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
        } catch (error) {
            console.error(`MinIO DELETE请求失败:`, error);
            throw error;
        }
    }
}

const storageService = {
    
    // 上传对象
    async putObj(c, key, content, metadata) {
        const storageType = c.env.STORAGE_TYPE || 'r2';
        
        // 验证内容不为空
        if (!content || (content.byteLength !== undefined && content.byteLength === 0) || 
            (content.length !== undefined && content.length === 0)) {
            console.error(`附件上传失败：内容为空, key: ${key}`);
            throw new Error(`附件内容为空，无法上传`);
        }
        
        if (storageType === 'minio') {
            console.log(`使用MinIO HTTP客户端上传: ${key}, 大小: ${content.byteLength || content.length}`);
            
            // 使用原生HTTP方法上传到MinIO
            const minioClient = new MinIOClient(
                c.env.MINIO_ENDPOINT,
                c.env.MINIO_ACCESS_KEY,
                c.env.MINIO_SECRET_KEY,
                c.env.MINIO_BUCKET_NAME
            );
            
            const result = await minioClient.putObject(
                key, 
                content, 
                metadata?.contentType || 'application/octet-stream'
            );
            
            console.log(`MinIO HTTP上传成功: ${key}`);
            return result;
        } else {
            try {
                // 保持原有 R2 逻辑
                console.log(`开始上传到R2: ${key}, 大小: ${content.byteLength || content.length}`);
                const result = await c.env.r2.put(key, content, {
                    httpMetadata: {...metadata}
                });
                console.log(`R2上传成功: ${key}`);
                return result;
            } catch (error) {
                console.error(`R2上传失败: ${key}`, error);
                const errorMessage = error.message || error.toString() || 'R2上传失败';
                throw new Error(`R2上传失败: ${errorMessage}`);
            }
        }
    },

    // 获取对象
    async getObj(c, key) {
        const storageType = c.env.STORAGE_TYPE || 'r2';
        
        if (storageType === 'minio') {
            const minioClient = new MinIOClient(
                c.env.MINIO_ENDPOINT,
                c.env.MINIO_ACCESS_KEY,
                c.env.MINIO_SECRET_KEY,
                c.env.MINIO_BUCKET_NAME
            );
            
            return await minioClient.getObject(key);
        } else {
            try {
                // 保持原有 R2 逻辑
                return await c.env.r2.get(key);
            } catch (error) {
                console.error(`R2获取文件失败: ${key}`, error);
                const errorMessage = error.message || error.toString() || 'R2获取文件失败';
                throw new Error(`R2获取文件失败: ${errorMessage}`);
            }
        }
    },

    // 删除对象
    async delete(c, key) {
        const storageType = c.env.STORAGE_TYPE || 'r2';
        
        if (storageType === 'minio') {
            const minioClient = new MinIOClient(
                c.env.MINIO_ENDPOINT,
                c.env.MINIO_ACCESS_KEY,
                c.env.MINIO_SECRET_KEY,
                c.env.MINIO_BUCKET_NAME
            );
            
            return await minioClient.deleteObject(key);
        } else {
            try {
                // 保持原有 R2 逻辑
                const result = await c.env.r2.delete(key);
                console.log(`R2删除成功: ${key}`);
                return result;
            } catch (error) {
                console.error(`R2删除失败: ${key}`, error);
                const errorMessage = error.message || error.toString() || 'R2删除失败';
                throw new Error(`R2删除失败: ${errorMessage}`);
            }
        }
    },

    // 生成文件访问 URL
    getFileUrl(c, key) {
        const storageType = c.env.STORAGE_TYPE || 'r2';
        
        if (storageType === 'minio') {
            // MinIO 的访问 URL 格式
            const endpoint = c.env.MINIO_ENDPOINT;
            const bucket = c.env.MINIO_BUCKET_NAME;
            return `${endpoint}/${bucket}/${key}`;
        } else {
            // R2 的访问 URL 格式（需要配置自定义域名）
            const r2Domain = c.env.R2_DOMAIN;
            return r2Domain ? `${r2Domain}/${key}` : null;
        }
    },

    // 检查文件是否存在（用于验证上传状态）
    async checkFileExists(c, key) {
        const storageType = c.env.STORAGE_TYPE || 'r2';
        
        if (storageType === 'minio') {
            const minioClient = new MinIOClient(
                c.env.MINIO_ENDPOINT,
                c.env.MINIO_ACCESS_KEY,
                c.env.MINIO_SECRET_KEY,
                c.env.MINIO_BUCKET_NAME
            );
            
            return await minioClient.headObject(key);
        } else {
            try {
                const result = await c.env.r2.head(key);
                if (result) {
                    console.log(`R2文件存在验证成功: ${key}`);
                    return result;
                }
                return null;
            } catch (error) {
                console.error(`R2文件检查错误: ${key}`, error);
                return null;
            }
        }
    }

};

export default storageService;
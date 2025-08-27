// 基于Fetch API的MinIO客户端实现，兼容Cloudflare Workers

// AWS4签名算法实现（使用Web Crypto API）
class AwsV4Signer {
    constructor(accessKey, secretKey, region = 'us-east-1', service = 's3') {
        this.accessKey = accessKey;
        this.secretKey = secretKey;
        this.region = region;
        this.service = service;
    }

    // 计算SHA256哈希
    async sha256(message) {
        const msgUint8 = new TextEncoder().encode(message);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
        return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // 计算HMAC-SHA256
    async hmacSha256(key, message) {
        const keyBuffer = key instanceof Uint8Array ? key : new TextEncoder().encode(key);
        const messageBuffer = new TextEncoder().encode(message);
        
        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            keyBuffer,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        
        const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageBuffer);
        return new Uint8Array(signature);
    }

    // 生成AWS4签名
    async sign(method, url, headers = {}, payload = '') {
        const urlObj = new URL(url);
        const host = urlObj.host;
        const path = urlObj.pathname || '/';
        const query = urlObj.search.slice(1); // 移除开头的?

        // 时间戳 - 使用UTC时间
        const now = new Date();
        const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, '');
        const dateStamp = amzDate.slice(0, 8);

        // 添加必需的头部
        const allHeaders = {
            'host': host,
            'x-amz-date': amzDate,
            ...headers
        };

        // 如果有payload，计算其哈希
        const payloadHash = await this.sha256(payload);
        allHeaders['x-amz-content-sha256'] = payloadHash;

        // 标准化头部
        const canonicalHeaders = Object.keys(allHeaders)
            .map(key => key.toLowerCase().trim())
            .sort()
            .map(key => {
                const originalKey = Object.keys(allHeaders).find(k => k.toLowerCase().trim() === key);
                const value = allHeaders[originalKey];
                return `${key}:${value.toString().trim()}\n`;
            })
            .join('');
        
        const signedHeaders = Object.keys(allHeaders)
            .map(key => key.toLowerCase().trim())
            .sort()
            .join(';');

        // 构建规范请求
        const canonicalRequest = [
            method.toUpperCase(),
            path,
            query,
            canonicalHeaders,
            signedHeaders,
            payloadHash
        ].join('\n');

        // 构建字符串以供签名
        const algorithm = 'AWS4-HMAC-SHA256';
        const credentialScope = `${dateStamp}/${this.region}/${this.service}/aws4_request`;
        const stringToSign = [
            algorithm,
            amzDate,
            credentialScope,
            await this.sha256(canonicalRequest)
        ].join('\n');

        // 计算签名
        const kDate = await this.hmacSha256(`AWS4${this.secretKey}`, dateStamp);
        const kRegion = await this.hmacSha256(kDate, this.region);
        const kService = await this.hmacSha256(kRegion, this.service);
        const kSigning = await this.hmacSha256(kService, 'aws4_request');
        const signature = await this.hmacSha256(kSigning, stringToSign);

        // 生成签名字符串
        const signatureHex = Array.from(signature).map(b => b.toString(16).padStart(2, '0')).join('');
        const authorization = `${algorithm} Credential=${this.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signatureHex}`;

        return {
            'Authorization': authorization,
            'X-Amz-Date': amzDate,
            'X-Amz-Content-Sha256': payloadHash
        };
    }
}

// MinIO客户端实现类
class MinIOClient {
    constructor(endpoint, accessKey, secretKey, bucketName) {
        this.endpoint = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
        this.accessKey = accessKey;
        this.secretKey = secretKey;
        this.bucketName = bucketName;
        this.signer = new AwsV4Signer(accessKey, secretKey);
        
        console.log('MinIO客户端配置:', {
            endpoint: this.endpoint,
            accessKey: this.accessKey,
            bucketName: this.bucketName
        });
    }

    // 使用Fetch API上传文件
    async putObject(key, content, contentType = 'application/octet-stream') {
        try {
            console.log(`MinIO上传开始: ${key}, 大小: ${content.byteLength || content.length} bytes`);
            
            // 构建URL
            const url = `${this.endpoint}/${this.bucketName}/${key}`;
            
            // 准备内容
            let body;
            if (content instanceof ArrayBuffer) {
                body = new Uint8Array(content);
            } else if (content instanceof Uint8Array) {
                body = content;
            } else if (typeof content === 'string') {
                body = new TextEncoder().encode(content);
            } else {
                throw new Error('不支持的内容类型');
            }
            
            // 基础头部 - 只包含签名所需的头部
            const headers = {
                'content-type': contentType,
                'content-length': body.length.toString()
            };
            
            // 计算签名
            const authHeaders = await this.signer.sign('PUT', url, headers, new TextDecoder().decode(body));
            
            // 合并所有头部 - 使用签名返回的头部名称
            const finalHeaders = {
                'Content-Type': contentType,
                'Content-Length': body.length.toString(),
                ...authHeaders
            };
            
            // 发送请求
            console.log('发送MinIO上传请求:', { url, headers: finalHeaders });
            const response = await fetch(url, {
                method: 'PUT',
                headers: finalHeaders,
                body: body
            });
            
            console.log(`MinIO响应状态: ${response.status}`);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('MinIO上传失败响应:', {
                    status: response.status,
                    statusText: response.statusText,
                    headers: Object.fromEntries(response.headers.entries()),
                    body: errorText
                });
                throw new Error(`MinIO上传失败: ${response.status} ${response.statusText} - ${errorText}`);
            }
            
            const etag = response.headers.get('ETag') || 'unknown';
            console.log(`MinIO上传成功: ${key}, ETag: ${etag}`);
            
            return {
                ETag: etag,
                success: true,
                key: key,
                size: body.length
            };
            
        } catch (error) {
            console.error(`MinIO上传失败: ${key}`, {
                message: error.message,
                stack: error.stack
            });
            throw new Error(`MinIO上传失败: ${error.message}`);
        }
    }

    // 检查文件是否存在
    async headObject(key) {
        try {
            const url = `${this.endpoint}/${this.bucketName}/${key}`;
            
            // 空头部，让签名方法添加必需的头部
            const headers = {};
            
            const authHeaders = await this.signer.sign('HEAD', url, headers, '');
            const finalHeaders = { ...authHeaders };
            
            const response = await fetch(url, {
                method: 'HEAD',
                headers: finalHeaders
            });
            
            if (response.status === 404) {
                return null;
            }
            
            if (!response.ok) {
                throw new Error(`MinIO HEAD请求失败: ${response.status} ${response.statusText}`);
            }
            
            console.log(`MinIO文件检查成功: ${key}`);
            return {
                ContentLength: parseInt(response.headers.get('Content-Length') || '0'),
                ContentType: response.headers.get('Content-Type'),
                ETag: response.headers.get('ETag'),
                LastModified: response.headers.get('Last-Modified')
            };
        } catch (error) {
            console.error(`MinIO文件检查失败: ${key}`, error);
            throw error;
        }
    }

    // 获取对象
    async getObject(key) {
        try {
            const url = `${this.endpoint}/${this.bucketName}/${key}`;
            
            // 空头部，让签名方法添加必需的头部
            const headers = {};
            
            const authHeaders = await this.signer.sign('GET', url, headers, '');
            const finalHeaders = { ...authHeaders };
            
            const response = await fetch(url, {
                method: 'GET',
                headers: finalHeaders
            });
            
            if (!response.ok) {
                throw new Error(`MinIO GET请求失败: ${response.status} ${response.statusText}`);
            }
            
            console.log(`MinIO获取文件成功: ${key}`);
            return {
                body: response.body,
                httpMetadata: {
                    contentType: response.headers.get('Content-Type') || 'application/octet-stream'
                }
            };
        } catch (error) {
            console.error(`MinIO获取文件失败: ${key}`, error);
            throw error;
        }
    }

    // 删除对象
    async deleteObject(key) {
        try {
            const url = `${this.endpoint}/${this.bucketName}/${key}`;
            
            // 空头部，让签名方法添加必需的头部
            const headers = {};
            
            const authHeaders = await this.signer.sign('DELETE', url, headers, '');
            const finalHeaders = { ...authHeaders };
            
            const response = await fetch(url, {
                method: 'DELETE',
                headers: finalHeaders
            });
            
            if (!response.ok) {
                throw new Error(`MinIO DELETE请求失败: ${response.status} ${response.statusText}`);
            }
            
            console.log(`MinIO删除成功: ${key}`);
            return { success: true };
        } catch (error) {
            console.error(`MinIO删除失败: ${key}`, error);
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
            console.log(`使用自定义MinIO客户端上传: ${key}, 大小: ${content.byteLength || content.length}`);
            
            // 使用自定义MinIO客户端上传
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
            
            console.log(`自定义MinIO客户端上传成功: ${key}`);
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
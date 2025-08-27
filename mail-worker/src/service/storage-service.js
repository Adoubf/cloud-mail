// 基于Fetch API的MinIO客户端实现，兼容Cloudflare Workers
import { AwsClient } from 'aws4fetch';

// MinIO客户端实现类
class MinIOClient {
    constructor(endpoint, accessKey, secretKey, bucketName) {
        this.endpoint = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
        this.accessKey = accessKey;
        this.secretKey = secretKey;
        this.bucketName = bucketName;
        
        // 创建aws4fetch客户端
        this.awsClient = new AwsClient({
            accessKeyId: accessKey,
            secretAccessKey: secretKey,
            region: 'us-east-1', // MinIO默认区域
            service: 's3'
        });
        
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
            
            // 使用aws4fetch发送签名请求
            console.log('发送MinIO上传请求:', { url });
            const response = await this.awsClient.fetch(url, {
                method: 'PUT',
                headers: {
                    'Content-Type': contentType,
                    'Content-Length': body.length.toString()
                },
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
                
                // 如果AWS4签名失败，尝试其他认证方式
                if (response.status === 403) {
                    console.log('尝试简单认证方式...');
                    
                    // 尝试1: Basic认证
                    try {
                        const basicAuth = btoa(`${this.accessKey}:${this.secretKey}`);
                        const basicResponse = await fetch(url, {
                            method: 'PUT',
                            headers: {
                                'Authorization': `Basic ${basicAuth}`,
                                'Content-Type': contentType,
                                'Content-Length': body.length.toString()
                            },
                            body: body
                        });
                        
                        if (basicResponse.ok) {
                            const etag = basicResponse.headers.get('ETag') || 'unknown';
                            console.log(`MinIO上传成功（Basic认证）: ${key}, ETag: ${etag}`);
                            return {
                                ETag: etag,
                                success: true,
                                key: key,
                                size: body.length
                            };
                        }
                    } catch (basicError) {
                        console.log('Basic认证失败:', basicError.message);
                    }
                    
                    // 尝试2: 无认证（公开存储桶）
                    try {
                        const noAuthResponse = await fetch(url, {
                            method: 'PUT',
                            headers: {
                                'Content-Type': contentType,
                                'Content-Length': body.length.toString()
                            },
                            body: body
                        });
                        
                        if (noAuthResponse.ok) {
                            const etag = noAuthResponse.headers.get('ETag') || 'unknown';
                            console.log(`MinIO上传成功（无认证）: ${key}, ETag: ${etag}`);
                            return {
                                ETag: etag,
                                success: true,
                                key: key,
                                size: body.length
                            };
                        }
                    } catch (noAuthError) {
                        console.log('无认证上传失败:', noAuthError.message);
                    }
                }
                
                throw new Error(`MinIO上传失败: ${response.status} ${response.statusText} - ${errorText}`);
            }
            
            const etag = response.headers.get('ETag') || 'unknown';
            console.log(`MinIO上传成功（AWS4签名）: ${key}, ETag: ${etag}`);
            
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
            
            // 使用aws4fetch发送HEAD请求
            const response = await this.awsClient.fetch(url, {
                method: 'HEAD'
            });
            
            if (response.status === 404) {
                return null;
            }
            
            if (!response.ok) {
                console.log(`AWS4签名HEAD请求失败: ${response.status}，尝试其他方式`);
                // 如果认证失败，尝试不带认证
                if (response.status === 403) {
                    const noAuthResponse = await fetch(url, { method: 'HEAD' });
                    if (noAuthResponse.ok) {
                        console.log(`MinIO文件检查成功（无认证）: ${key}`);
                        return {
                            ContentLength: parseInt(noAuthResponse.headers.get('Content-Length') || '0'),
                            ContentType: noAuthResponse.headers.get('Content-Type'),
                            ETag: noAuthResponse.headers.get('ETag'),
                            LastModified: noAuthResponse.headers.get('Last-Modified')
                        };
                    }
                }
                throw new Error(`MinIO HEAD请求失败: ${response.status} ${response.statusText}`);
            }
            
            console.log(`MinIO文件检查成功（AWS4签名）: ${key}`);
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
            
            // 使用aws4fetch发送GET请求
            let response = await this.awsClient.fetch(url, {
                method: 'GET'
            });
            
            // 如果认证失败，尝试不带认证
            if (!response.ok && response.status === 403) {
                console.log(`AWS4签名GET请求失败，尝试无认证访问`);
                response = await fetch(url, { method: 'GET' });
            }
            
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
            
            // 使用aws4fetch发送DELETE请求
            let response = await this.awsClient.fetch(url, {
                method: 'DELETE'
            });
            
            // 如果认证失败，尝试不带认证
            if (!response.ok && response.status === 403) {
                console.log(`AWS4签名DELETE请求失败，尝试无认证访问`);
                response = await fetch(url, { method: 'DELETE' });
            }
            
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
            console.log(`使用aws4fetch MinIO客户端上传: ${key}, 大小: ${content.byteLength || content.length}`);
            
            // 使用aws4fetch MinIO客户端上传
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
            
            console.log(`aws4fetch MinIO客户端上传成功: ${key}`);
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
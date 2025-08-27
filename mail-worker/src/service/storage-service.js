// 使用MinIO官方SDK，适用于Cloudflare Workers环境
import * as Minio from 'minio';

// MinIO客户端封装类
class MinIOClient {
    constructor(endpoint, accessKey, secretKey, bucketName) {
        // 解析endpoint获取host和port
        const url = new URL(endpoint);
        
        this.minioClient = new Minio.Client({
            endPoint: url.hostname,
            port: url.port ? parseInt(url.port) : (url.protocol === 'https:' ? 443 : 80),
            useSSL: url.protocol === 'https:',
            accessKey: accessKey,
            secretKey: secretKey
        });
        
        this.bucketName = bucketName;
        this.endpoint = endpoint;
        
        console.log('MinIO客户端配置:', {
            endPoint: url.hostname,
            port: url.port ? parseInt(url.port) : (url.protocol === 'https:' ? 443 : 80),
            useSSL: url.protocol === 'https:',
            accessKey: accessKey,
            bucketName: bucketName
        });
    }

    // 使用官方SDK上传文件
    async putObject(key, content, contentType = 'application/octet-stream') {
        try {
            console.log(`MinIO SDK上传开始: ${key}, 大小: ${content.byteLength || content.length} bytes`);
            
            // 确保content是Buffer或Stream
            let buffer;
            if (content instanceof ArrayBuffer) {
                buffer = Buffer.from(content);
            } else if (content instanceof Uint8Array) {
                buffer = Buffer.from(content);
            } else if (Buffer.isBuffer(content)) {
                buffer = content;
            } else if (typeof content === 'string') {
                buffer = Buffer.from(content, 'utf8');
            } else {
                throw new Error('不支持的内容类型');
            }
            
            // 设置元数据
            const metaData = {
                'Content-Type': contentType
            };
            
            // 使用MinIO SDK上传
            const result = await this.minioClient.putObject(
                this.bucketName,
                key,
                buffer,
                metaData
            );
            
            console.log(`MinIO SDK上传成功: ${key}, ETag: ${result.etag}`);
            
            return {
                ETag: result.etag,
                success: true,
                key: key,
                size: buffer.length
            };
            
        } catch (error) {
            console.error(`MinIO SDK上传失败: ${key}`, {
                message: error.message,
                code: error.code,
                statusCode: error.statusCode,
                stack: error.stack
            });
            // 提供更详细的错误信息
            const errorMessage = error.message || error.toString() || 'MinIO上传失败';
            throw new Error(`MinIO SDK上传失败: ${errorMessage}`);
        }
    }

    // 检查文件是否存在
    async headObject(key) {
        try {
            const stat = await this.minioClient.statObject(this.bucketName, key);
            console.log(`MinIO SDK文件检查成功: ${key}`);
            return {
                ContentLength: stat.size,
                ContentType: stat.metaData['content-type'],
                ETag: stat.etag,
                LastModified: stat.lastModified
            };
        } catch (error) {
            if (error.code === 'NotFound' || error.statusCode === 404) {
                return null;
            }
            console.error(`MinIO SDK文件检查失败: ${key}`, error);
            throw error;
        }
    }

    // 获取对象
    async getObject(key) {
        try {
            const stream = await this.minioClient.getObject(this.bucketName, key);
            console.log(`MinIO SDK获取文件成功: ${key}`);
            return {
                body: stream,
                httpMetadata: {
                    contentType: 'application/octet-stream' // MinIO SDK不直接返回metadata，需要单独获取
                }
            };
        } catch (error) {
            console.error(`MinIO SDK获取文件失败: ${key}`, error);
            throw error;
        }
    }

    // 删除对象
    async deleteObject(key) {
        try {
            await this.minioClient.removeObject(this.bucketName, key);
            console.log(`MinIO SDK删除成功: ${key}`);
            return { success: true };
        } catch (error) {
            console.error(`MinIO SDK删除失败: ${key}`, error);
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
            console.log(`使用MinIO SDK上传: ${key}, 大小: ${content.byteLength || content.length}`);
            
            // 使用MinIO官方SDK上传
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
            
            console.log(`MinIO SDK上传成功: ${key}`);
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
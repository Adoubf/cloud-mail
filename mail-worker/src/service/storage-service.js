import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const storageService = {
    
    // 初始化存储客户端
    getClient(c) {
        const storageType = c.env.STORAGE_TYPE || 'r2'; // 默认使用 R2
        
        if (storageType === 'minio') {
            return new S3Client({
                region: 'us-east-1', // MinIO 可以使用任意region
                endpoint: c.env.MINIO_ENDPOINT, // MinIO 服务地址
                credentials: {
                    accessKeyId: c.env.MINIO_ACCESS_KEY,
                    secretAccessKey: c.env.MINIO_SECRET_KEY,
                },
                forcePathStyle: true, // MinIO 需要路径风格
            });
        } else {
            // 保持原有 R2 逻辑
            return c.env.r2;
        }
    },

    // 上传对象
    async putObj(c, key, content, metadata) {
        const storageType = c.env.STORAGE_TYPE || 'r2';
        
        if (storageType === 'minio') {
            const client = this.getClient(c);
            const command = new PutObjectCommand({
                Bucket: c.env.MINIO_BUCKET_NAME,
                Key: key,
                Body: content,
                ContentType: metadata?.contentType,
                ContentDisposition: metadata?.contentDisposition,
            });
            await client.send(command);
        } else {
            // 保持原有 R2 逻辑
            await c.env.r2.put(key, content, {
                httpMetadata: {...metadata}
            });
        }
    },

    // 获取对象
    async getObj(c, key) {
        const storageType = c.env.STORAGE_TYPE || 'r2';
        
        if (storageType === 'minio') {
            const client = this.getClient(c);
            const command = new GetObjectCommand({
                Bucket: c.env.MINIO_BUCKET_NAME,
                Key: key,
            });
            const response = await client.send(command);
            
            return {
                body: response.Body,
                httpMetadata: {
                    contentType: response.ContentType,
                    contentDisposition: response.ContentDisposition,
                }
            };
        } else {
            // 保持原有 R2 逻辑
            return await c.env.r2.get(key);
        }
    },

    // 删除对象
    async delete(c, key) {
        const storageType = c.env.STORAGE_TYPE || 'r2';
        
        if (storageType === 'minio') {
            const client = this.getClient(c);
            const command = new DeleteObjectCommand({
                Bucket: c.env.MINIO_BUCKET_NAME,
                Key: key,
            });
            await client.send(command);
        } else {
            // 保持原有 R2 逻辑
            await c.env.r2.delete(key);
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
    }

};

export default storageService;
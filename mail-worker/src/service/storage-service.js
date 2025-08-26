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
        
        // 验证内容不为空
        if (!content || (content.byteLength !== undefined && content.byteLength === 0) || 
            (content.length !== undefined && content.length === 0)) {
            console.error(`附件上传失败：内容为空, key: ${key}`);
            throw new Error(`附件内容为空，无法上传`);
        }
        
        if (storageType === 'minio') {
            try {
                const client = this.getClient(c);
                const command = new PutObjectCommand({
                    Bucket: c.env.MINIO_BUCKET_NAME,
                    Key: key,
                    Body: content,
                    ContentType: metadata?.contentType,
                    ContentDisposition: metadata?.contentDisposition,
                });
                
                console.log(`开始上传到MinIO: ${key}, 大小: ${content.byteLength || content.length}`);
                const result = await client.send(command);
                console.log(`MinIO上传成功: ${key}, ETag: ${result.ETag}`);
                
                return result;
            } catch (error) {
                console.error(`MinIO上传失败: ${key}`, error);
                // 确保错误信息是字符串格式
                const errorMessage = error.message || error.toString() || 'MinIO上传失败';
                throw new Error(`MinIO上传失败: ${errorMessage}`);
            }
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
            try {
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
            } catch (error) {
                console.error(`MinIO获取文件失败: ${key}`, error);
                const errorMessage = error.message || error.toString() || 'MinIO获取文件失败';
                throw new Error(`MinIO获取文件失败: ${errorMessage}`);
            }
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
            try {
                const client = this.getClient(c);
                const command = new DeleteObjectCommand({
                    Bucket: c.env.MINIO_BUCKET_NAME,
                    Key: key,
                });
                const result = await client.send(command);
                console.log(`MinIO删除成功: ${key}`);
                return result;
            } catch (error) {
                console.error(`MinIO删除失败: ${key}`, error);
                const errorMessage = error.message || error.toString() || 'MinIO删除失败';
                throw new Error(`MinIO删除失败: ${errorMessage}`);
            }
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
    }

};

export default storageService;
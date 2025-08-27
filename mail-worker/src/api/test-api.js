import app from '../hono/hono';
import result from '../model/result';
import storageService from '../service/storage-service';

app.get('/test/hello', async (c) => {
	return c.json(result.ok('hello world'))
});

// 环境变量检测接口
app.get('/test/env', async (c) => {
	// 收集环境变量信息（注意：敏感信息只显示是否存在）
	const envInfo = {
		// MinIO配置
		STORAGE_TYPE: c.env.STORAGE_TYPE,
		MINIO_ENDPOINT: c.env.MINIO_ENDPOINT,
		MINIO_ACCESS_KEY: c.env.MINIO_ACCESS_KEY,
		MINIO_SECRET_KEY: c.env.MINIO_SECRET_KEY ? '***已设置***' : undefined,
		MINIO_BUCKET_NAME: c.env.MINIO_BUCKET_NAME,
		
		// 其他重要配置
		admin: c.env.admin,
		domain: c.env.domain,
		jwt_secret: c.env.jwt_secret ? '***已设置***' : undefined,
		
		// 资源绑定检查
		db: c.env.db ? '已绑定' : undefined,
		kv: c.env.kv ? '已绑定' : undefined,
		r2: c.env.r2 ? '已绑定' : undefined,
		
		// 其他环境信息
		orm_log: c.env.orm_log,
		timestamp: new Date().toISOString()
	};
	
	return c.json(result.ok(envInfo));
});

// MinIO上传测试接口
app.post('/test/minio-upload', async (c) => {
	try {
		const { filename, content, contentType } = await c.req.json();
		
		if (!filename || !content) {
			return c.json(result.fail('filename 和 content 参数必填'));
		}
		
		// 生成唯一的文件key
		const key = `test/${Date.now()}-${filename}`;
		
		// 将Base64内容转换为ArrayBuffer
		let buffer;
		try {
			// 解码Base64内容
			const binaryString = atob(content);
			buffer = new Uint8Array(binaryString.length);
			for (let i = 0; i < binaryString.length; i++) {
				buffer[i] = binaryString.charCodeAt(i);
			}
		} catch (decodeError) {
			return c.json(result.fail('Base64解码失败: ' + decodeError.message));
		}
		
		console.log(`开始MinIO测试上传: ${key}, 大小: ${buffer.length} bytes`);
		
		// 尝试上传到存储服务
		const uploadResult = await storageService.putObj(c, key, buffer, {
			contentType: contentType || 'application/octet-stream'
		});
		
		console.log(`MinIO测试上传成功: ${key}`);
		
		return c.json(result.ok({
			key: key,
			size: buffer.length,
			uploadResult: uploadResult,
			message: 'MinIO上传测试成功'
		}));
		
	} catch (error) {
		console.error('MinIO上传测试失败:', error);
		return c.json(result.fail(`MinIO上传测试失败: ${error.message}`));
	}
});
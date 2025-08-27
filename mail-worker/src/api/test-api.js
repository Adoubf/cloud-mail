import app from '../hono/hono';
import result from '../model/result';

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
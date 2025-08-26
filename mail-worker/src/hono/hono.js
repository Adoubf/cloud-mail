import { Hono } from 'hono';
const app = new Hono();

import result from '../model/result';
import { cors } from 'hono/cors';

app.use('*', cors());

app.onError((err, c) => {
	let errorMessage = '服务器内部错误';
	let errorCode = 500;
	
	if (err.name === 'BizError') {
		console.log('BizError:', err.message);
		errorMessage = err.message || '业务错误';
		errorCode = err.code || 500;
	} else {
		console.error('系统错误:', err);
		// 确保错误信息是安全的字符串
		if (err.message) {
			// 清理可能导致JSON解析错误的字符
			errorMessage = String(err.message)
				.replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // 移除控制字符
				.replace(/[\\"\']/g, '') // 移除可能影响JSON的字符
				.substring(0, 200); // 限制长度
		}
		errorCode = err.code || err.status || 500;
	}
	
	// 确保返回标准的JSON格式
	return c.json(result.fail(errorMessage, errorCode));
});

export default app;



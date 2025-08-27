#!/usr/bin/env node

/**
 * MinIO AWS4签名算法调试工具
 * 用于逐步调试AWS4签名生成过程
 */

const API_BASE_URL = 'https://mail.coralera.org';

async function debugMinIOSignature() {
    console.log('🔍 MinIO AWS4签名调试测试');
    console.log('=' .repeat(60));
    
    try {
        // 获取MinIO配置
        console.log('📋 步骤1: 获取MinIO配置');
        const envResponse = await fetch(`${API_BASE_URL}/api/test/env`);
        const envResult = await envResponse.json();
        
        if (!envResponse.ok || envResult.code !== 200) {
            throw new Error(`获取配置失败: ${envResult.message}`);
        }
        
        const config = envResult.data;
        console.log('✅ MinIO配置:');
        console.log(`- 端点: ${config.MINIO_ENDPOINT}`);
        console.log(`- Access Key: ${config.MINIO_ACCESS_KEY}`);
        console.log(`- 存储桶: ${config.MINIO_BUCKET_NAME}`);
        
        // 测试基本连通性
        console.log('\n📋 步骤2: 测试基本连通性');
        
        // 测试1: 不带认证的请求（应该返回403）
        console.log('🔍 测试1: 不带认证的PUT请求');
        const testKey = `debug-test-${Date.now()}.txt`;
        const testUrl = `${config.MINIO_ENDPOINT}/${config.MINIO_BUCKET_NAME}/${testKey}`;
        const testContent = 'Hello MinIO!';
        
        console.log(`- URL: ${testUrl}`);
        console.log(`- 内容: ${testContent}`);
        
        const noAuthResponse = await fetch(testUrl, {
            method: 'PUT',
            headers: {
                'Content-Type': 'text/plain',
                'Content-Length': testContent.length.toString()
            },
            body: testContent
        });
        
        console.log(`- 响应状态: ${noAuthResponse.status}`);
        console.log(`- 响应头: ${JSON.stringify(Object.fromEntries(noAuthResponse.headers.entries()), null, 2)}`);
        
        if (noAuthResponse.status !== 403) {
            const responseText = await noAuthResponse.text();
            console.log(`- 响应内容: ${responseText}`);
        }
        
        // 测试2: 检查存储桶是否存在
        console.log('\n🔍 测试2: 检查存储桶列表（不带认证）');
        const bucketListUrl = `${config.MINIO_ENDPOINT}/`;
        const bucketResponse = await fetch(bucketListUrl);
        
        console.log(`- 存储桶列表URL: ${bucketListUrl}`);
        console.log(`- 响应状态: ${bucketResponse.status}`);
        
        // 测试3: 尝试简单认证
        console.log('\n🔍 测试3: 尝试Basic认证');
        const basicAuth = btoa(`${config.MINIO_ACCESS_KEY}:${config.MINIO_SECRET_KEY}`);
        const basicAuthResponse = await fetch(testUrl, {
            method: 'PUT',
            headers: {
                'Authorization': `Basic ${basicAuth}`,
                'Content-Type': 'text/plain',
                'Content-Length': testContent.length.toString()
            },
            body: testContent
        });
        
        console.log(`- Basic认证响应状态: ${basicAuthResponse.status}`);
        if (basicAuthResponse.status !== 403 && basicAuthResponse.status !== 200) {
            const responseText = await basicAuthResponse.text();
            console.log(`- Basic认证响应内容: ${responseText.substring(0, 500)}`);
        }
        
        // 测试4: 检查MinIO版本和支持的认证方式
        console.log('\n🔍 测试4: 检查MinIO服务器信息');
        
        // 尝试获取服务器信息
        const serverInfoUrls = [
            `${config.MINIO_ENDPOINT}/minio/health/ready`,
            `${config.MINIO_ENDPOINT}/minio/version`,
            `${config.MINIO_ENDPOINT}/minio/info`
        ];
        
        for (const infoUrl of serverInfoUrls) {
            try {
                console.log(`- 检查: ${infoUrl}`);
                const infoResponse = await fetch(infoUrl);
                console.log(`  状态: ${infoResponse.status}`);
                if (infoResponse.status === 200) {
                    const infoText = await infoResponse.text();
                    console.log(`  内容: ${infoText.substring(0, 200)}`);
                }
            } catch (error) {
                console.log(`  错误: ${error.message}`);
            }
        }
        
        console.log('\n📊 调试总结:');
        console.log('1. 如果不带认证返回403，说明MinIO服务运行正常');
        console.log('2. 如果Basic认证也失败，可能需要AWS4签名');
        console.log('3. 如果所有认证都失败，检查Access Key/Secret Key');
        console.log('4. 错误1003通常表示签名格式问题');
        
        // 建议下一步测试
        console.log('\n🔧 建议的修复方向:');
        console.log('1. 检查MinIO是否支持AWS4签名');
        console.log('2. 验证时间同步（AWS4签名对时间敏感）');
        console.log('3. 检查URL路径编码');
        console.log('4. 验证区域设置（默认us-east-1）');
        console.log('5. 尝试使用MinIO原生认证方式');
        
    } catch (error) {
        console.error('❌ 调试过程失败:', error.message);
        console.log('\n🔧 故障排查建议:');
        console.log('1. 检查网络连接');
        console.log('2. 确认MinIO服务状态');
        console.log('3. 验证环境变量配置');
    }
}

// 执行调试
if (require.main === module) {
    debugMinIOSignature();
}

module.exports = { debugMinIOSignature };
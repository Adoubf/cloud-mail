#!/usr/bin/env node

/**
 * MinIO直接上传测试脚本
 * 通过专门的测试接口获取MinIO上传的详细错误信息
 */

const API_BASE_URL = 'https://mail.coralera.org';

async function testMinIODirectUpload() {
    console.log('🔍 MinIO直接上传测试开始');
    console.log('=' .repeat(60));
    
    try {
        // 创建测试文件
        const testContent = JSON.stringify({
            test: 'MinIO直接上传测试',
            timestamp: new Date().toISOString(),
            purpose: '获取MinIO上传的详细错误信息'
        }, null, 2);
        
        const base64Content = Buffer.from(testContent, 'utf8').toString('base64');
        
        console.log('📎 测试文件信息:');
        console.log(`- 内容: ${testContent}`);
        console.log(`- 大小: ${testContent.length} bytes`);
        console.log(`- Base64大小: ${base64Content.length} bytes`);
        
        // 调用MinIO测试接口
        console.log('\n📤 调用MinIO测试接口...');
        const response = await fetch(`${API_BASE_URL}/api/test/minio-upload`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                filename: `direct-test-${Date.now()}.json`,
                content: base64Content,
                contentType: 'application/json'
            })
        });
        
        const result = await response.json();
        
        console.log(`响应状态: ${response.status}`);
        console.log('响应内容:', JSON.stringify(result, null, 2));
        
        if (response.ok && result.code === 200) {
            console.log('\n✅ MinIO直接上传测试成功！');
            console.log('📋 上传结果:');
            console.log(`- 文件Key: ${result.data.key}`);
            console.log(`- 文件大小: ${result.data.size} bytes`);
            console.log(`- 上传结果: ${JSON.stringify(result.data.uploadResult)}`);
        } else {
            console.log('\n❌ MinIO直接上传测试失败');
            console.log(`错误信息: ${result.message || '未知错误'}`);
            
            // 提供详细的故障排查建议
            console.log('\n🔧 MinIO故障排查建议:');
            console.log('1. 检查Cloudflare Workers控制台日志');
            console.log('2. 验证MinIO服务是否运行在 http://103.74.192.34:20075');
            console.log('3. 确认存储桶 "attachment" 是否存在');
            console.log('4. 验证Access Key和Secret Key是否正确');
            console.log('5. 检查AWS4签名算法实现');
            console.log('6. 验证网络连接和防火墙设置');
        }
        
    } catch (error) {
        console.error('❌ 测试过程失败:', error.message);
        
        if (error.message.includes('fetch')) {
            console.log('\n🌐 网络连接问题:');
            console.log('1. 检查网络连接');
            console.log('2. 验证API地址是否正确');
            console.log('3. 确认Cloudflare Workers服务正常');
        }
    }
}

// 执行测试
if (require.main === module) {
    testMinIODirectUpload();
}

module.exports = { testMinIODirectUpload };
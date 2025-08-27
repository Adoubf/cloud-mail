#!/usr/bin/env node

/**
 * MinIO连接调试测试脚本
 * 用于诊断CF Workers中MinIO上传失败的具体原因
 */

const crypto = require('crypto');
const API_BASE_URL = 'https://mail.coralera.org';

async function debugMinIOConnection() {
    console.log('🔍 MinIO连接调试测试开始');
    console.log('=' .repeat(60));
    
    try {
        // 1. 获取环境变量配置
        console.log('📋 步骤1: 获取MinIO配置');
        const envResponse = await fetch(`${API_BASE_URL}/api/test/env`);
        const envResult = await envResponse.json();
        
        if (!envResponse.ok) {
            throw new Error(`获取环境变量失败: ${envResponse.status}`);
        }
        
        const env = envResult.data;
        console.log('✅ MinIO配置:');
        console.log(`- STORAGE_TYPE: ${env.STORAGE_TYPE}`);
        console.log(`- MINIO_ENDPOINT: ${env.MINIO_ENDPOINT}`);
        console.log(`- MINIO_ACCESS_KEY: ${env.MINIO_ACCESS_KEY}`);
        console.log(`- MINIO_SECRET_KEY: ${env.MINIO_SECRET_KEY ? '已设置' : '未设置'}`);
        console.log(`- MINIO_BUCKET_NAME: ${env.MINIO_BUCKET_NAME}`);
        
        // 2. 测试MinIO健康状态
        console.log('\n📋 步骤2: 测试MinIO健康状态');
        try {
            const healthResponse = await fetch(`${env.MINIO_ENDPOINT}/minio/health/live`, {
                method: 'GET',
                headers: {
                    'User-Agent': 'CloudMail-DebugTest/1.0'
                }
            });
            
            console.log(`✅ MinIO健康检查: ${healthResponse.status}`);
            if (healthResponse.status === 200) {
                console.log('✅ MinIO服务正常运行');
            } else {
                console.log(`⚠️  MinIO服务状态异常: ${healthResponse.status}`);
            }
        } catch (error) {
            console.log(`❌ MinIO健康检查失败: ${error.message}`);
        }
        
        // 3. 测试存储桶访问
        console.log('\n📋 步骤3: 测试存储桶访问');
        try {
            const bucketUrl = `${env.MINIO_ENDPOINT}/${env.MINIO_BUCKET_NAME}/`;
            const bucketResponse = await fetch(bucketUrl, {
                method: 'GET',
                headers: {
                    'User-Agent': 'CloudMail-DebugTest/1.0'
                }
            });
            
            console.log(`存储桶访问状态: ${bucketResponse.status}`);
            if (bucketResponse.status === 403) {
                console.log('✅ 存储桶需要认证（正常）');
            } else if (bucketResponse.status === 200) {
                console.log('⚠️  存储桶可公开访问');
            } else if (bucketResponse.status === 404) {
                console.log('❌ 存储桶不存在');
            } else {
                console.log(`❌ 存储桶访问异常: ${bucketResponse.status}`);
            }
        } catch (error) {
            console.log(`❌ 存储桶访问测试失败: ${error.message}`);
        }
        
        // 4. 创建测试文件上传请求
        console.log('\n📋 步骤4: 创建MinIO上传测试');
        
        // 创建一个小的测试文件
        const testContent = JSON.stringify({
            test: 'MinIO连接测试',
            timestamp: new Date().toISOString(),
            source: 'debug-test-script'
        }, null, 2);
        
        const testFilename = `debug-test-${Date.now()}.json`;
        const base64Content = Buffer.from(testContent, 'utf8').toString('base64');
        
        const testAttachment = {
            filename: testFilename,
            content: base64Content,
            contentType: 'application/json',
            size: testContent.length
        };
        
        console.log('📎 测试文件信息:');
        console.log(`- 文件名: ${testFilename}`);
        console.log(`- 大小: ${testContent.length} bytes`);
        console.log(`- 类型: application/json`);
        
        // 5. 通过API进行上传测试
        console.log('\n📋 步骤5: 通过邮件API进行上传测试');
        
        // 首先登录 - 使用与cf-worker-test.js相同的方式
        const loginData = {
            email: 'admin@coralera.org',
            password: 'Mosary200064@.'    // 管理员密码（已验证正确）
        };
        
        console.log('发送登录请求到:', `${API_BASE_URL}/api/login`);
        
        const loginResponse = await fetch(`${API_BASE_URL}/api/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(loginData)
        });
        
        if (!loginResponse.ok) {
            throw new Error(`登录失败: ${loginResponse.status}`);
        }
        
        const loginResult = await loginResponse.json();
        if (loginResult.code !== 200) {
            throw new Error(`登录失败: ${loginResult.message}`);
        }
        const token = loginResult.data.token;
        console.log('✅ 登录成功');
        
        // 发送带附件的测试邮件
        const emailData = {
            accountId: 1, // 默认使用第一个账户
            receiveEmail: ['mosaryalex@gmail.com'],
            subject: 'MinIO调试测试邮件 - ' + new Date().toLocaleString(),
            content: '<h2>MinIO连接调试测试</h2><p>这封邮件用于测试MinIO附件上传功能</p>',
            text: 'MinIO连接调试测试邮件',
            sendType: 'send',
            manyType: 'one',
            attachments: [testAttachment]
        };
        
        console.log('📤 发送测试邮件...');
        const emailResponse = await fetch(`${API_BASE_URL}/api/email/send`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token
            },
            body: JSON.stringify(emailData)
        });
        
        console.log(`邮件发送响应状态: ${emailResponse.status}`);
        
        if (emailResponse.ok) {
            const emailResult = await emailResponse.json();
            console.log('✅ 邮件发送成功');
            console.log('📋 邮件处理结果:');
            console.log(`- 邮件ID: ${emailResult.data[0]?.emailId}`);
            console.log(`- 附件数量: ${emailResult.data[0]?.attList?.length || 0}`);
            
            if (emailResult.data[0]?.attList?.length > 0) {
                console.log('✅ MinIO附件上传成功！');
                emailResult.data[0].attList.forEach((att, index) => {
                    console.log(`  ${index + 1}. ${att.filename} (${att.size} bytes)`);
                });
            } else {
                console.log('❌ MinIO附件上传失败 - attList为空');
                console.log('⚠️  说明: 邮件发送成功但附件没有存储到MinIO');
            }
        } else {
            const errorResult = await emailResponse.json().catch(() => ({ message: '无法解析错误响应' }));
            console.log('❌ 邮件发送失败:');
            console.log(`- 状态码: ${emailResponse.status}`);
            console.log(`- 错误信息: ${errorResult.message || '未知错误'}`);
        }
        
        console.log('\n📊 调试总结:');
        console.log('1. 检查CF Workers控制台日志，查看详细错误信息');
        console.log('2. 验证MinIO认证凭据是否正确');
        console.log('3. 确认网络连接和防火墙设置');
        console.log('4. 检查AWS4签名算法实现');
        
    } catch (error) {
        console.error('❌ 调试测试失败:', error.message);
        console.log('\n🔧 可能的解决方案:');
        console.log('1. 检查MinIO服务是否正常运行');
        console.log('2. 验证网络连接');
        console.log('3. 确认认证信息正确');
        console.log('4. 查看CF Workers日志获取详细错误');
    }
}

// 执行调试测试
if (require.main === module) {
    debugMinIOConnection();
}

module.exports = { debugMinIOConnection };
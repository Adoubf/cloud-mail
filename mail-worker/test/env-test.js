#!/usr/bin/env node

/**
 * Cloudflare Workers 环境变量测试脚本
 * 验证MinIO相关环境变量是否正确设置
 */

const API_BASE_URL = 'https://mail.coralera.org';

async function testEnvironmentVariables() {
    console.log('🔍 开始检测Cloudflare Workers环境变量');
    console.log('=' .repeat(60));
    
    try {
        // 创建一个专门的测试接口来检查环境变量
        const response = await fetch(`${API_BASE_URL}/api/test/env`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            }
        });

        const result = await response.json();
        
        console.log('环境变量检测结果:');
        console.log('HTTP状态:', response.status);
        console.log('响应内容:', JSON.stringify(result, null, 2));
        
        if (response.ok && result.data) {
            console.log('\n✅ 环境变量配置检查:');
            
            const env = result.data;
            
            // 检查MinIO相关环境变量
            console.log('- STORAGE_TYPE:', env.STORAGE_TYPE || '❌ 未设置');
            console.log('- MINIO_ENDPOINT:', env.MINIO_ENDPOINT || '❌ 未设置');
            console.log('- MINIO_ACCESS_KEY:', env.MINIO_ACCESS_KEY || '❌ 未设置');
            console.log('- MINIO_SECRET_KEY:', env.MINIO_SECRET_KEY ? '✅ 已设置' : '❌ 未设置');
            console.log('- MINIO_BUCKET_NAME:', env.MINIO_BUCKET_NAME || '❌ 未设置');
            
            // 检查其他重要环境变量
            console.log('\n🔧 其他环境变量:');
            console.log('- admin:', env.admin || '❌ 未设置');
            console.log('- domain:', Array.isArray(env.domain) ? `✅ ${env.domain.length}个域名` : (env.domain || '❌ 未设置'));
            console.log('- jwt_secret:', env.jwt_secret ? '✅ 已设置' : '❌ 未设置');
            
            // 检查资源绑定
            console.log('\n💾 资源绑定检查:');
            console.log('- D1 数据库:', env.db ? '✅ 已绑定' : '❌ 未绑定');
            console.log('- KV 存储:', env.kv ? '✅ 已绑定' : '❌ 未绑定');
            console.log('- R2 存储:', env.r2 ? '✅ 已绑定' : '❌ 未绑定');
            
            // MinIO配置完整性检查
            const minioConfigured = env.STORAGE_TYPE === 'minio' && 
                                   env.MINIO_ENDPOINT && 
                                   env.MINIO_ACCESS_KEY && 
                                   env.MINIO_SECRET_KEY && 
                                   env.MINIO_BUCKET_NAME;
            
            console.log('\n🎯 MinIO配置状态:', minioConfigured ? '✅ 完整配置' : '❌ 配置不完整');
            
            if (!minioConfigured) {
                console.log('\n⚠️  MinIO配置问题诊断:');
                if (env.STORAGE_TYPE !== 'minio') {
                    console.log('- STORAGE_TYPE应设置为 "minio"');
                }
                if (!env.MINIO_ENDPOINT) {
                    console.log('- MINIO_ENDPOINT应设置为 "http://103.74.192.34:20075"');
                }
                if (!env.MINIO_ACCESS_KEY) {
                    console.log('- MINIO_ACCESS_KEY应设置为 "minio"');
                }
                if (!env.MINIO_SECRET_KEY) {
                    console.log('- MINIO_SECRET_KEY应设置为 "Mosary200064@."');
                }
                if (!env.MINIO_BUCKET_NAME) {
                    console.log('- MINIO_BUCKET_NAME应设置为 "attachment"');
                }
            }
            
        } else {
            console.log('❌ 无法获取环境变量信息');
            if (response.status === 404) {
                console.log('提示: 测试接口可能不存在，需要先添加环境变量测试接口');
            }
        }
        
    } catch (error) {
        console.error('❌ 环境变量检测失败:', error.message);
        console.log('\n🔧 可能的解决方案:');
        console.log('1. 确认Cloudflare Workers正在运行');
        console.log('2. 检查网络连接');
        console.log('3. 验证API地址是否正确');
        console.log('4. 添加环境变量测试接口');
    }
}

// 执行测试
if (require.main === module) {
    testEnvironmentVariables();
}
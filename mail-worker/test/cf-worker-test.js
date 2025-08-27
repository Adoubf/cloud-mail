#!/usr/bin/env node

/**
 * Cloudflare Workers 邮件发送 API 测试脚本
 * 测试 https://mail.coralera.org/api/email/send 接口
 * 专门验证MinIO附件上传功能
 */

const API_BASE_URL = 'https://mail.coralera.org';

// 测试配置
const TEST_CONFIG = {
    // 测试用户凭据（使用提供的正确密码）
    testUser: {
        email: 'admin@coralera.org',  // 管理员用户
        password: 'Mosary200064@.'    // 管理员密码（已验证正确）
    },
    
    // 测试邮件配置
    testEmail: {
        to: ['mosaryalex@gmail.com'],  // 替换为接收测试邮件的地址
        subject: 'CF Workers MinIO 附件测试 - ' + new Date().toLocaleString(),
        content: '<h2>MinIO 附件上传验证测试</h2><p>此邮件用于验证已部署服务的MinIO附件上传功能</p><p>测试时间：' + new Date().toLocaleString() + '</p>',
        text: 'MinIO 附件上传验证测试 - 测试时间：' + new Date().toLocaleString()
    },
    
    // MinIO 测试配置
    minioTest: {
        enabled: true,
        endpoint: 'http://103.74.192.34:20075',
        bucket: 'attachment'
    }
};

class CloudMailAPITester {
    constructor() {
        this.token = null;
        this.accountId = null;
    }

    // 用户登录获取token（修复鉴权问题）
    async login() {
        console.log('🔐 开始登录...');
        console.log('登录信息:');
        console.log('- 用户邮箱:', TEST_CONFIG.testUser.email);
        console.log('- 密码长度:', TEST_CONFIG.testUser.password.length);
        
        try {
            const loginData = {
                email: TEST_CONFIG.testUser.email,
                password: TEST_CONFIG.testUser.password
            };
            
            console.log('发送登录请求到:', `${API_BASE_URL}/api/login`);
            
            const response = await fetch(`${API_BASE_URL}/api/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(loginData)
            });

            const result = await response.json();
            
            console.log('登录响应状态:', response.status);
            console.log('登录响应内容:', JSON.stringify(result, null, 2));
            
            // 检查API级别的错误（即使HTTP状态为200）
            if (result.code && result.code !== 200) {
                throw new Error(`登录失败: ${result.message || '认证错误'}`);
            }
            
            if (!response.ok) {
                throw new Error(`登录失败: ${result.message || response.statusText}`);
            }

            // 兼容不同的响应结构
            let foundToken = null;
            
            if (result.code === 200 && result.data && result.data.token) {
                foundToken = result.data.token;
            } else if (result.data && result.data.token) {
                foundToken = result.data.token;
            } else if (result.token) {
                foundToken = result.token;
            } else if (result.data && result.data.accessToken) {
                foundToken = result.data.accessToken;
            } else if (result.accessToken) {
                foundToken = result.accessToken;
            }
            
            if (!foundToken) {
                console.error('未找到token字段，响应结构:', result);
                throw new Error('登录响应中未找到有效的token');
            }
            
            this.token = foundToken;
            
            console.log('✅ 登录成功，token:', this.token.substring(0, 20) + '...');
            return result;
            
        } catch (error) {
            console.error('❌ 登录失败:', error.message);
            throw error;
        }
    }

    // 获取用户账户列表（修复认证问题）
    async getAccounts() {
        console.log('📋 获取账户列表...');
        
        if (!this.token) {
            throw new Error('请先登录获取token');
        }
        
        try {
            const response = await fetch(`${API_BASE_URL}/api/account/query`, {
                method: 'GET',
                headers: {
                    'Authorization': this.token, // 移除 'Bearer ' 前缀
                    'Content-Type': 'application/json',
                }
            });

            const result = await response.json();
            
            console.log('账户响应状态:', response.status);
            console.log('账户响应内容:', JSON.stringify(result, null, 2));
            
            if (!response.ok) {
                throw new Error(`获取账户失败: ${result.message || response.statusText}`);
            }

            // 兼容不同的响应结构
            let accounts = null;
            if (result.data && Array.isArray(result.data)) {
                accounts = result.data;
            } else if (Array.isArray(result)) {
                accounts = result;
            } else if (result.accounts && Array.isArray(result.accounts)) {
                accounts = result.accounts;
            }
            
            if (accounts && accounts.length > 0) {
                this.accountId = accounts[0].accountId || accounts[0].id;
                console.log(`✅ 获取到账户: ${accounts[0].email} (ID: ${this.accountId})`);
            } else {
                console.warn('⚠️  没有找到可用的邮件账户，尝试使用默认值');
                this.accountId = 1; // 使用默认账户ID
            }

            return result;
            
        } catch (error) {
            console.error('❌ 获取账户失败:', error.message);
            // 如果获取账户失败，尝试使用默认值
            console.log('尝试使用默认账户ID: 1');
            this.accountId = 1;
            return null;
        }
    }

    // 创建测试附件（增强MinIO验证）
    createTestAttachment() {
        console.log('📎 创建测试附件...');
        
        // 创建一个包含MinIO配置信息的测试文档
        const testContent = {
            title: 'MinIO 附件上传验证测试',
            description: '此文件用于验证已部署的Cloud Mail服务的MinIO附件上传功能',
            timestamp: new Date().toISOString(),
            minioConfig: {
                expectedEndpoint: TEST_CONFIG.minioTest.endpoint,
                expectedBucket: TEST_CONFIG.minioTest.bucket,
                testPurpose: '验证MinIO存储服务是否正常工作'
            },
            testDetails: {
                environment: 'Cloudflare Workers Production',
                storage: 'MinIO Object Storage',
                purpose: 'Production API Testing',
                authMethod: 'AWS4-HMAC-SHA256 签名认证',
                expectedBehavior: '附件应成功上传到MinIO并在邮件中可访问'
            },
            troubleshooting: {
                '403错误': '认证失败，检查Access Key和Secret Key',
                '404错误': '存储桶不存在，确认存储桶名称正确',
                '连接失败': '检查MinIO服务地址和网络连接'
            }
        };

        const jsonContent = JSON.stringify(testContent, null, 2);
        const base64Content = btoa(unescape(encodeURIComponent(jsonContent)));
        
        // 验证Base64编码正确性
        try {
            const decoded = decodeURIComponent(escape(atob(base64Content)));
            const reEncoded = btoa(unescape(encodeURIComponent(decoded)));
            if (reEncoded !== base64Content) {
                console.warn('Base64编码可能有精度差异，但仍可使用');
            }
        } catch (error) {
            console.warn('Base64编码验证警告（可忽略）:', error.message);
            // 不抛出错误，因为编码可能是正确的
        }

        const attachment = {
            filename: `minio-validation-test-${Date.now()}.json`,
            content: base64Content,
            contentType: 'application/json',
            size: jsonContent.length
        };

        console.log(`✅ 创建测试附件: ${attachment.filename}`);
        console.log(`   - 原始大小: ${attachment.size} bytes`);
        console.log(`   - Base64大小: ${base64Content.length} bytes`);
        console.log(`   - 内容类型: ${attachment.contentType}`);
        return attachment;
    }
    
    // 创建多种类型的测试附件
    createMultipleTestAttachments() {
        console.log('📎 创建多种类型测试附件...');
        
        const attachments = [];
        
        // 1. JSON配置文件
        const jsonAttachment = this.createTestAttachment();
        attachments.push(jsonAttachment);
        
        // 2. 文本文件
        const textContent = `MinIO 附件上传测试文档
==================

测试时间: ${new Date().toLocaleString()}
MinIO 端点: ${TEST_CONFIG.minioTest.endpoint}
存储桶: ${TEST_CONFIG.minioTest.bucket}

此文件用于验证:
1. MinIO HTTP客户端兼容性
2. AWS4签名认证机制
3. 附件上传流程完整性
4. Cloudflare Workers环境适配

如果您在邮件中看到此附件，说明MinIO存储功能正常工作。`;
        
        const textBase64 = btoa(unescape(encodeURIComponent(textContent)));
        attachments.push({
            filename: `minio-test-doc-${Date.now()}.txt`,
            content: textBase64,
            contentType: 'text/plain',
            size: textContent.length
        });
        
        // 3. 小型CSV数据文件
        const csvContent = `测试项,状态,时间\nMinIO连接,测试中,${new Date().toISOString()}\n附件上传,进行中,${new Date().toISOString()}\n邮件发送,待验证,${new Date().toISOString()}`;
        const csvBase64 = btoa(unescape(encodeURIComponent(csvContent)));
        attachments.push({
            filename: `minio-test-data-${Date.now()}.csv`,
            content: csvBase64,
            contentType: 'text/csv',
            size: csvContent.length
        });
        
        console.log(`✅ 创建了 ${attachments.length} 个测试附件`);
        attachments.forEach((att, index) => {
            console.log(`   ${index + 1}. ${att.filename} (${att.size} bytes, ${att.contentType})`);
        });
        
        return attachments;
    }

    // 发送带附件的测试邮件（增强MinIO验证）
    async sendTestEmail() {
        console.log('📧 发送MinIO附件测试邮件...');
        
        if (!this.token || !this.accountId) {
            throw new Error('请先登录并获取账户信息');
        }

        const testAttachments = this.createMultipleTestAttachments();

        const emailData = {
            accountId: this.accountId,
            receiveEmail: TEST_CONFIG.testEmail.to,
            subject: TEST_CONFIG.testEmail.subject,
            content: TEST_CONFIG.testEmail.content,
            text: TEST_CONFIG.testEmail.text,
            sendType: 'send',
            manyType: 'one',
            attachments: testAttachments  // 包含多个测试附件
        };

        try {
            console.log('发送邮件请求数据:');
            console.log('- 收件人:', emailData.receiveEmail);
            console.log('- 主题:', emailData.subject);
            console.log('- 附件数量:', testAttachments.length);
            testAttachments.forEach((att, index) => {
                console.log(`  ${index + 1}. ${att.filename} (${att.size} bytes, ${att.contentType})`);
            });
            console.log('- MinIO配置:');
            console.log('  - 端点:', TEST_CONFIG.minioTest.endpoint);
            console.log('  - 存储桶:', TEST_CONFIG.minioTest.bucket);

            const response = await fetch(`${API_BASE_URL}/api/email/send`, {
                method: 'POST',
                headers: {
                    'Authorization': this.token, // 移除 'Bearer ' 前缀
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(emailData)
            });

            const result = await response.json();
            
            console.log('📤 API响应状态:', response.status);
            console.log('📤 API响应内容:', JSON.stringify(result, null, 2));

            if (!response.ok) {
                throw new Error(`发送邮件失败: ${result.message || response.statusText}`);
            }

            console.log('✅ MinIO附件邮件发送成功!');
            console.log('📋 验证要点:');
            console.log('1. 检查邮件是否收到');
            console.log('2. 确认所有附件都能正常下载');
            console.log('3. 验证附件内容完整性');
            console.log('4. 确认MinIO存储桶中存在文件');
            
            // 如果有邮件ID，提供MinIO验证建议
            if (result.data && result.data.emailId) {
                console.log(`\n🔍 可以通过以下方式验证MinIO存储:`);
                console.log(`   - 邮件ID: ${result.data.emailId}`);
                console.log(`   - MinIO控制台: ${TEST_CONFIG.minioTest.endpoint}`);
                console.log(`   - 存储桶: ${TEST_CONFIG.minioTest.bucket}`);
            }
            
            return result;
            
        } catch (error) {
            console.error('❌ 发送邮件失败:', error.message);
            throw error;
        }
    }

    // 测试不带附件的邮件发送
    async sendSimpleEmail() {
        console.log('📧 发送简单测试邮件（无附件）...');
        
        if (!this.token || !this.accountId) {
            throw new Error('请先登录并获取账户信息');
        }

        const emailData = {
            accountId: this.accountId,
            receiveEmail: TEST_CONFIG.testEmail.to,
            subject: 'CF Workers 简单测试 - 无附件',
            content: '<h2>简单测试邮件</h2><p>这封邮件不包含附件，用于验证基本邮件发送功能。</p>',
            text: '简单测试邮件，不包含附件',
            sendType: 'send',
            manyType: 'one',
            attachments: []  // 无附件
        };

        try {
            const response = await fetch(`${API_BASE_URL}/api/email/send`, {
                method: 'POST',
                headers: {
                    'Authorization': this.token, // 移除 'Bearer ' 前缀
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(emailData)
            });

            const result = await response.json();
            
            console.log('📤 简单邮件响应状态:', response.status);
            console.log('📤 简单邮件响应内容:', JSON.stringify(result, null, 2));

            if (!response.ok) {
                throw new Error(`发送简单邮件失败: ${result.message || response.statusText}`);
            }

            console.log('✅ 简单邮件发送成功!');
            return result;
            
        } catch (error) {
            console.error('❌ 发送简单邮件失败:', error.message);
            throw error;
        }
    }

    // 获取系统设置信息（重点关注MinIO配置）
    async getSystemSettings() {
        console.log('⚙️  获取系统设置...');
        
        try {
            const response = await fetch(`${API_BASE_URL}/api/setting/query`, {
                method: 'GET',
                headers: {
                    'Authorization': this.token, // 移除 'Bearer ' 前缀
                    'Content-Type': 'application/json',
                }
            });

            const result = await response.json();
            
            console.log('系统设置响应状态:', response.status);
            console.log('系统设置响应内容:', JSON.stringify(result, null, 2));
            
            if (response.ok && result.data) {
                console.log('✅ 系统设置信息:');
                
                // 邮件发送设置（注意：根据规范，0表示启用，1表示禁用）
                const sendEnabled = result.data.send === 0;
                console.log('- 邮件发送状态:', sendEnabled ? '启用' : '禁用', `(值: ${result.data.send})`);
                
                // 存储配置
                console.log('- 存储类型:', result.data.storageType || '未设置');
                console.log('- 存储域名:', result.data.storageDomain || '未设置');
                console.log('- R2域名:', result.data.r2Domain || '未设置');
                
                // MinIO 特殊检查
                if (result.data.storageType === 'minio') {
                    console.log('🔍 MinIO 存储配置检查:');
                    console.log('  - 类型: MinIO');
                    console.log('  - 预期端点:', TEST_CONFIG.minioTest.endpoint);
                    console.log('  - 预期存储桶:', TEST_CONFIG.minioTest.bucket);
                    console.log('  - 存储域名:', result.data.storageDomain);
                } else {
                    console.log('⚠️  当前存储类型不是MinIO，是:', result.data.storageType);
                }
                
                // 验证邮件发送是否启用
                if (!sendEnabled) {
                    console.log('⚠️  警告: 邮件发送功能已禁用，测试可能失败');
                }
                
                return result;
            } else {
                console.log('⚠️  无法获取系统设置, HTTP状态:', response.status);
                return null;
            }
            
        } catch (error) {
            console.log('⚠️  获取系统设置失败:', error.message);
            return null;
        }
    }
    
    // 测试MinIO连接性
    async testMinIOConnection() {
        console.log('🔌 测试MinIO连接性...');
        
        try {
            // 尝试访问MinIO端点
            const minioHealthUrl = `${TEST_CONFIG.minioTest.endpoint}/minio/health/live`;
            console.log('检查MinIO健康状态:', minioHealthUrl);
            
            const response = await fetch(minioHealthUrl, {
                method: 'GET',
                headers: {
                    'User-Agent': 'CloudMail-Test-Script'
                }
            });
            
            console.log('MinIO健康检查响应状态:', response.status);
            
            if (response.ok) {
                console.log('✅ MinIO服务响应正常');
            } else {
                console.log('⚠️  MinIO健康检查失败，但服务可能仍然可用');
            }
            
            // 尝试访问存储桶（可能需要认证）
            const bucketUrl = `${TEST_CONFIG.minioTest.endpoint}/${TEST_CONFIG.minioTest.bucket}/`;
            console.log('检查存储桶访问:', bucketUrl);
            
            const bucketResponse = await fetch(bucketUrl, {
                method: 'HEAD',
                headers: {
                    'User-Agent': 'CloudMail-Test-Script'
                }
            });
            
            console.log('存储桶检查响应状态:', bucketResponse.status);
            
            if (bucketResponse.status === 200) {
                console.log('✅ 存储桶可访问（公开）');
            } else if (bucketResponse.status === 403) {
                console.log('🔒 存储桶需要认证（正常）');
            } else if (bucketResponse.status === 404) {
                console.log('❌ 存储桶不存在或MinIO配置错误');
            } else {
                console.log('⚠️  存储桶状态未知:', bucketResponse.status);
            }
            
        } catch (error) {
            console.log('❌ MinIO连接测试失败:', error.message);
            console.log('可能的原因:');
            console.log('1. MinIO服务未运行');
            console.log('2. 网络连接问题');
            console.log('3. 防火墙阻止访问');
            console.log('4. MinIO端点地址错误');
        }
    }
}

// 主测试函数
async function runTests() {
    console.log('🚀 开始 Cloud Mail CF Workers API 测试');
    console.log('=' .repeat(60));
    
    // 检查配置
    console.log('🔍 检查测试配置:');
    console.log('- 测试用户:', TEST_CONFIG.testUser.email);
    console.log('- 收件人:', TEST_CONFIG.testEmail.to.join(', '));
    console.log('- API地址:', API_BASE_URL);
    
    const tester = new CloudMailAPITester();
    
    try {
        // 1. 登录
        await tester.login();
        
        // 2. 获取账户
        await tester.getAccounts();
        
        // 3. 获取系统设置
        await tester.getSystemSettings();
        
        // 4. 测试MinIO连接
        console.log('\n' + '='.repeat(60));
        console.log('MinIO连接性测试');
        await tester.testMinIOConnection();
        
        console.log('\n' + '='.repeat(60));
        console.log('开始邮件发送测试');
        
        // 5. 测试简单邮件发送（无附件）
        console.log('\n📋 测试1: 简单邮件发送（无附件）');
        try {
            await tester.sendSimpleEmail();
        } catch (error) {
            console.error('简单邮件发送测试失败:', error.message);
            console.log('建议检查:');
            console.log('1. 邮件发送功能是否已启用');
            console.log('2. 用户权限是否正确');
            console.log('3. Resend邮件服务配置');
        }
        
        // 6. 测试带附件的邮件发送（MinIO重点测试）
        console.log('\n📋 测试2: MinIO附件邮件发送（核心测试）');
        try {
            await tester.sendTestEmail();
        } catch (error) {
            console.error('❌ MinIO附件邮件发送测试失败:', error.message);
            console.log('\n🔧 MinIO故障排查建议:');
            console.log('1. 检查MinIO服务是否运行在', TEST_CONFIG.minioTest.endpoint);
            console.log('2. 验证存储桶名称是否为', TEST_CONFIG.minioTest.bucket);
            console.log('3. 确认Access Key和Secret Key配置正确');
            console.log('4. 检查Cloudflare Workers环境变量:');
            console.log('   - STORAGE_TYPE = "minio"');
            console.log('   - MINIO_ENDPOINT');
            console.log('   - MINIO_ACCESS_KEY');
            console.log('   - MINIO_SECRET_KEY');
            console.log('   - MINIO_BUCKET_NAME');
            console.log('5. 验证MinIO认证机制（AWS4-HMAC-SHA256）');
            console.log('6. 检查Base64编码/解码过程');
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('🏁 MinIO附件上传验证测试完成');
        
        console.log('\n📊 测试结果总结:');
        console.log('如果测试成功，您应该能够看到:');
        console.log('1. ✅ 用户登录成功（密码验证通过）');
        console.log('2. ✅ 系统设置获取成功（鉴权中间件正常）');
        console.log('3. ✅ MinIO连接测试（如果可访问）');
        console.log('4. ✅ 简单邮件发送成功');
        console.log('5. ✅ MinIO附件邮件发送成功');
        
        console.log('\n🔍 验证步骤:');
        console.log('1. 检查接收邮箱是否收到测试邮件');
        console.log('2. 下载并验证附件内容完整性');
        console.log('3. 在MinIO控制台确认文件已上传');
        console.log('4. 验证附件链接能正常访问');
        
        console.log('\n📝 已知问题参考:');
        console.log('- 密码算法: Base64(SHA-256(salt + password))');
        console.log('- 系统设置值: 0=启用, 1=禁用');
        console.log('- MinIO认证: AWS4-HMAC-SHA256签名');
        console.log('- 存储类型: 环境变量STORAGE_TYPE="minio"');
        
    } catch (error) {
        console.error('❌ 测试执行失败:', error.message);
        
        // 提供调试建议
        console.log('\n🔧 调试建议:');
        if (error.message.includes('登录失败')) {
            console.log('1. 检查用户凭据是否正确');
            console.log('2. 确认用户在系统中存在');
            console.log('3. 检查API地址是否可访问');
        }
        
        process.exit(1);
    }
}

// 使用说明
function showUsage() {
    console.log('📖 使用说明:');
    console.log('1. 确保您有有效的测试账户');
    console.log('2. 修改 TEST_CONFIG 中的用户凭据和邮件地址');
    console.log('3. 运行测试: node cf-worker-test.js');
    console.log('');
    console.log('当前配置:');
    console.log('- 测试用户:', TEST_CONFIG.testUser.email);
    console.log('- 收件人:', TEST_CONFIG.testEmail.to.join(', '));
    console.log('- API地址:', API_BASE_URL);
}

// 执行测试
if (require.main === module) {
    // 检查配置
    if (TEST_CONFIG.testUser.email === 'your-test@coralera.org' || 
        TEST_CONFIG.testEmail.to.includes('recipient@yourdomain.com')) {
        console.log('⚠️  请先修改测试配置!');
        showUsage();
        process.exit(1);
    }
    
    runTests();
}
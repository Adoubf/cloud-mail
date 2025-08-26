#!/usr/bin/env node

/**
 * Cloudflare Workers 邮件发送 API 测试脚本
 * 测试 https://mail.coralera.org/api/email/send 接口
 */

const API_BASE_URL = 'https://mail.coralera.org';

// 测试配置
const TEST_CONFIG = {
    // 测试用户凭据（需要先在系统中创建用户）
    testUser: {
        email: 'test@coralera.org',  // 替换为您的测试邮箱
        password: 'test123456'       // 替换为您的测试密码
    },
    
    // 测试邮件配置
    testEmail: {
        to: ['recipient@example.com'],  // 替换为接收测试邮件的地址
        subject: 'CF Workers MinIO 附件测试',
        content: '<h2>这是一个测试邮件</h2><p>用于验证MinIO附件上传功能</p>',
        text: '这是一个测试邮件，用于验证MinIO附件上传功能'
    }
};

class CloudMailAPITester {
    constructor() {
        this.token = null;
        this.accountId = null;
    }

    // 用户登录获取token
    async login() {
        console.log('🔐 开始登录...');
        
        try {
            const response = await fetch(`${API_BASE_URL}/api/user/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    email: TEST_CONFIG.testUser.email,
                    password: TEST_CONFIG.testUser.password
                })
            });

            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(`登录失败: ${result.message || response.statusText}`);
            }

            this.token = result.data.token;
            console.log('✅ 登录成功');
            return result;
            
        } catch (error) {
            console.error('❌ 登录失败:', error.message);
            throw error;
        }
    }

    // 获取用户账户列表
    async getAccounts() {
        console.log('📋 获取账户列表...');
        
        try {
            const response = await fetch(`${API_BASE_URL}/api/account/query`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json',
                }
            });

            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(`获取账户失败: ${result.message || response.statusText}`);
            }

            if (result.data && result.data.length > 0) {
                this.accountId = result.data[0].accountId;
                console.log(`✅ 获取到账户: ${result.data[0].email} (ID: ${this.accountId})`);
            } else {
                throw new Error('没有找到可用的邮件账户');
            }

            return result;
            
        } catch (error) {
            console.error('❌ 获取账户失败:', error.message);
            throw error;
        }
    }

    // 创建测试附件
    createTestAttachment() {
        console.log('📎 创建测试附件...');
        
        // 创建一个简单的测试文档内容
        const testContent = {
            title: 'MinIO 测试文档',
            content: '这是一个用于测试MinIO上传功能的文档文件。',
            timestamp: new Date().toISOString(),
            testData: {
                environment: 'Cloudflare Workers',
                storage: 'MinIO',
                purpose: 'API Testing'
            }
        };

        const jsonContent = JSON.stringify(testContent, null, 2);
        const base64Content = btoa(unescape(encodeURIComponent(jsonContent)));

        const attachment = {
            filename: `minio-test-${Date.now()}.json`,
            content: base64Content,
            contentType: 'application/json',
            size: jsonContent.length
        };

        console.log(`✅ 创建测试附件: ${attachment.filename} (${attachment.size} bytes)`);
        return attachment;
    }

    // 发送带附件的测试邮件
    async sendTestEmail() {
        console.log('📧 发送测试邮件...');
        
        if (!this.token || !this.accountId) {
            throw new Error('请先登录并获取账户信息');
        }

        const testAttachment = this.createTestAttachment();

        const emailData = {
            accountId: this.accountId,
            receiveEmail: TEST_CONFIG.testEmail.to,
            subject: TEST_CONFIG.testEmail.subject,
            content: TEST_CONFIG.testEmail.content,
            text: TEST_CONFIG.testEmail.text,
            sendType: 'send',
            manyType: 'one',
            attachments: [testAttachment]  // 包含测试附件
        };

        try {
            console.log('发送邮件请求数据:');
            console.log('- 收件人:', emailData.receiveEmail);
            console.log('- 主题:', emailData.subject);
            console.log('- 附件:', testAttachment.filename);
            console.log('- 附件大小:', testAttachment.size, 'bytes');

            const response = await fetch(`${API_BASE_URL}/api/email/send`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
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

            console.log('✅ 邮件发送成功!');
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
                    'Authorization': `Bearer ${this.token}`,
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

    // 获取系统设置信息
    async getSystemSettings() {
        console.log('⚙️  获取系统设置...');
        
        try {
            const response = await fetch(`${API_BASE_URL}/api/setting/query`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json',
                }
            });

            const result = await response.json();
            
            if (response.ok && result.data) {
                console.log('✅ 系统设置信息:');
                console.log('- 邮件发送状态:', result.data.send === 1 ? '启用' : '禁用');
                console.log('- 存储类型:', result.data.storageType || '未设置');
                console.log('- MinIO配置:', result.data.minioConfig ? '已配置' : '未配置');
                return result;
            } else {
                console.log('⚠️  无法获取系统设置');
                return null;
            }
            
        } catch (error) {
            console.log('⚠️  获取系统设置失败:', error.message);
            return null;
        }
    }
}

// 主测试函数
async function runTests() {
    console.log('🚀 开始 Cloud Mail CF Workers API 测试');
    console.log('=' .repeat(60));
    
    const tester = new CloudMailAPITester();
    
    try {
        // 1. 登录
        await tester.login();
        
        // 2. 获取账户
        await tester.getAccounts();
        
        // 3. 获取系统设置
        await tester.getSystemSettings();
        
        console.log('\n' + '='.repeat(60));
        console.log('开始邮件发送测试');
        
        // 4. 测试简单邮件发送（无附件）
        console.log('\n📋 测试1: 简单邮件发送（无附件）');
        try {
            await tester.sendSimpleEmail();
        } catch (error) {
            console.error('简单邮件发送测试失败:', error.message);
        }
        
        // 5. 测试带附件的邮件发送
        console.log('\n📋 测试2: 带附件邮件发送（MinIO测试）');
        try {
            await tester.sendTestEmail();
        } catch (error) {
            console.error('附件邮件发送测试失败:', error.message);
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('🏁 测试完成');
        
    } catch (error) {
        console.error('❌ 测试执行失败:', error.message);
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
    if (TEST_CONFIG.testUser.email === 'test@coralera.org' || 
        TEST_CONFIG.testEmail.to.includes('recipient@example.com')) {
        console.log('⚠️  请先修改测试配置!');
        showUsage();
        process.exit(1);
    }
    
    runTests();
}
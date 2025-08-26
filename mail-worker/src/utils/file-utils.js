const fileUtils = {
	getExtFileName(filename) {
		const index = filename.lastIndexOf('.');
		return index !== -1 ? filename.slice(index) : '';
	},

	async getBuffHash(buff) {
		const hashBuffer = await crypto.subtle.digest('SHA-256', buff);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
	},

	base64ToUint8Array(base64) {
		if (!base64) {
			throw new Error('Base64 字符串为空');
		}
		
		// 验证 base64 格式
		if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
			throw new Error('Base64 字符串格式无效');
		}
		
		try {
			const binaryStr = atob(base64);
			const len = binaryStr.length;
			
			if (len === 0) {
				throw new Error('Base64 解码后内容为空');
			}
			
			const bytes = new Uint8Array(len);
			for (let i = 0; i < len; i++) {
				bytes[i] = binaryStr.charCodeAt(i);
			}
			
			console.log(`Base64 转换成功，原始长度: ${base64.length}, 输出长度: ${bytes.length}`);
			return bytes;
		} catch (error) {
			console.error('Base64 转换失败:', error);
			if (error.name === 'InvalidCharacterError') {
				throw new Error('Base64 字符串包含无效字符');
			}
			throw new Error(`Base64 转换失败: ${error.message}`);
		}
	},

	/**
	 * 将 Base64 数据转换为 File 对象（自动识别 MIME 类型和文件扩展名）
	 * @param {string} base64Data 带有 data: 前缀的 base64 数据
	 * @param {string} [customFilename] 可选，传入自定义文件名（不含扩展名）
	 * @returns {File} File 对象
	 */
	base64ToFile(base64Data, customFilename) {
		const match = base64Data.match(/^data:(image|jpeg|video)\/([a-zA-Z0-9.+-]+);base64,/);
		if (!match) {
			throw new Error('Invalid base64 data format');
		}

		const type = match[1]; // image 或 video
		const ext = match[2];  // jpg, png, mp4 等
		const mimeType = `${type}/${ext}`;
		const cleanBase64 = base64Data.replace(/^data:(image|jpeg|video)\/[a-zA-Z0-9.+-]+;base64,/, '');

		const byteCharacters = atob(cleanBase64);
		const byteArrays = [];

		for (let offset = 0; offset < byteCharacters.length; offset += 1024) {
			const slice = byteCharacters.slice(offset, offset + 1024);
			const byteNumbers = new Array(slice.length);
			for (let i = 0; i < slice.length; i++) {
				byteNumbers[i] = slice.charCodeAt(i);
			}
			byteArrays.push(new Uint8Array(byteNumbers));
		}

		const blob = new Blob(byteArrays, { type: mimeType });

		const filename = `${customFilename || `${type}_${Date.now()}`}.${ext}`;
		return new File([blob], filename, { type: mimeType });
	}
};


export default fileUtils;


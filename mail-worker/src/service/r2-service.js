import storageService from './storage-service.js';

const r2Service = {
	async putObj(c, key, content, metadata) {
		return await storageService.putObj(c, key, content, metadata);
	},

	async getObj(c, key) {
		return await storageService.getObj(c, key);
	},

	async delete(c, key) {
		return await storageService.delete(c, key);
	},

	// 新增：获取文件访问 URL
	getFileUrl(c, key) {
		return storageService.getFileUrl(c, key);
	}

};
export default r2Service;

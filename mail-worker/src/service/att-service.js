import orm from '../entity/orm';
import { att } from '../entity/att';
import { and, eq, isNull, inArray, notInArray } from 'drizzle-orm';
import r2Service from './r2-service';
import constant from '../const/constant';
import fileUtils from '../utils/file-utils';
import { attConst } from '../const/entity-const';
import { parseHTML } from 'linkedom';

const attService = {

	async addAtt(c, attachments) {

		for (let attachment of attachments) {
			await r2Service.putObj(c, attachment.key, attachment.content, {
				contentType: attachment.mimeType,
				contentDisposition: `attachment; filename="${attachment.filename}"`
			});
		}

		await orm(c).insert(att).values(attachments).run();
	},

	list(c, params, userId) {
		const { emailId } = params;

		return orm(c).select().from(att).where(
			and(
				eq(att.emailId, emailId),
				eq(att.userId, userId),
				eq(att.type, attConst.type.ATT),
				isNull(att.contentId)
			)
		).all();
	},

	async toImageUrlHtml(c, content, r2Domain) {

		const { document } = parseHTML(content);

		const images = Array.from(document.querySelectorAll('img'));

		const attDataList = [];

		for (const img of images) {

			const src = img.getAttribute('src');
			if (src && src.startsWith('data:image')) {
				const file = fileUtils.base64ToFile(src);
				const buff = await file.arrayBuffer();
				const key = constant.ATTACHMENT_PREFIX + await fileUtils.getBuffHash(buff) + fileUtils.getExtFileName(file.name);
				img.setAttribute('src', r2Domain + '/' + key);

				const attData = {};
				attData.key = key;
				attData.filename = file.name;
				attData.mimeType = file.type;
				attData.size = file.size;
				attData.buff = buff;

				attDataList.push(attData);
			}

			const hasInlineWidth = img.hasAttribute('width');
			const style = img.getAttribute('style') || '';
			const hasStyleWidth = /(^|\s)width\s*:\s*[^;]+/.test(style);

			if (!hasInlineWidth && !hasStyleWidth) {
				const newStyle = (style ? style.trim().replace(/;$/, '') + '; ' : '') + 'max-width: 100%;';
				img.setAttribute('style', newStyle);
			}
		}
		return { attDataList, html: document.toString() };
	},

	async saveSendAtt(c, attList, userId, accountId, emailId) {

		const attDataList = [];

		// 验证附件列表
		if (!attList || attList.length === 0) {
			console.log('没有附件需要上传');
			return;
		}

		for (let att of attList) {
			// 验证附件基本信息
			if (!att.content) {
				throw new Error(`附件 ${att.filename} 内容为空`);
			}

			// 转换 base64 到 Uint8Array
			try {
				att.buff = fileUtils.base64ToUint8Array(att.content);
				console.log(`附件 ${att.filename} 转换成功，大小: ${att.buff.length}`);
			} catch (error) {
				console.error(`附件 ${att.filename} base64转换失败:`, error);
				throw new Error(`附件 ${att.filename} 格式错误，无法解析`);
			}

			// 验证转换后的内容
			if (!att.buff || att.buff.length === 0) {
				throw new Error(`附件 ${att.filename} 转换后内容为空`);
			}

			// 生成文件key
			try {
				att.key = constant.ATTACHMENT_PREFIX + await fileUtils.getBuffHash(att.buff) + fileUtils.getExtFileName(att.filename);
			} catch (error) {
				console.error(`附件 ${att.filename} 生成hash失败:`, error);
				throw new Error(`附件 ${att.filename} 处理失败`);
			}

			const attData = { userId, accountId, emailId };
			attData.key = att.key;
			attData.size = att.buff.length;
			attData.filename = att.filename;
			attData.mimeType = att.type;
			attData.type = attConst.type.ATT;
			attDataList.push(attData);
		}

		console.log(`开始上传 ${attDataList.length} 个附件到存储`);

		// 先上传文件到存储，再保存数据库记录
		for (let att of attList) {
			try {
				await r2Service.putObj(c, att.key, att.buff, {
					contentType: att.type,
					contentDisposition: `attachment; filename="${att.filename}"`
				});
				console.log(`附件上传成功: ${att.filename} -> ${att.key}`);
			} catch (error) {
				console.error(`附件上传失败: ${att.filename}`, error);
				// 清理已上传的文件
				await this.cleanupFailedUploads(c, attList.slice(0, attList.indexOf(att)));
				throw new Error(`附件上传失败: ${att.filename} - ${error.message}`);
			}
		}

		// 所有文件上传成功后，保存数据库记录
		try {
			await orm(c).insert(att).values(attDataList).run();
			console.log(`附件数据库记录保存成功: ${attDataList.length} 条记录`);
		} catch (error) {
			console.error('附件数据库记录保存失败:', error);
			// 删除已上传的文件
			await this.cleanupFailedUploads(c, attList);
			throw new Error(`附件数据库保存失败: ${error.message}`);
		}

	},

	async saveArticleAtt(c, attDataList, userId, accountId, emailId) {

		for (let attData of attDataList) {
			attData.userId = userId;
			attData.emailId = emailId;
			attData.accountId = accountId;
			attData.type = attConst.type.EMBED;
			await r2Service.putObj(c, attData.key, attData.buff, {
				contentType: attData.mimeType
			});
		}

		await orm(c).insert(att).values(attDataList).run();

	},

	async removeByUserIds(c, userIds) {
		await this.removeAttByField(c, att.userId, userIds);
	},

	async removeByEmailIds(c, emailIds) {
		await this.removeAttByField(c, att.emailId, emailIds);
	},

	async removeByAccountIds(c, accountIds) {
		await this.removeAttByField(c, att.accountId, accountIds);
	},

	async removeAttByField(c, fieldName, fieldValues) {

		const condition = inArray(fieldName, fieldValues);
		const attList = await orm(c).select().from(att).where(condition).limit(99);

		if (attList.length === 0) {
			return;
		}

		const attIds = attList.map(attRow => attRow.attId);
		const keys = attList.map(attRow => attRow.key);
		await orm(c).delete(att).where(inArray(att.attId, attIds)).run();

		const existAttRows = await orm(c).select().from(att).where(inArray(att.key, keys)).all();
		const existKeys = existAttRows.map(attRow => attRow.key);
		const delKeyList = keys.filter(key => !existKeys.includes(key));
		if (delKeyList.length > 0) {
			// 支持R2和MinIO存储的删除
			const storageType = c.env.STORAGE_TYPE || 'r2';
			if (storageType === 'minio') {
				// MinIO 存储下逐个删除文件
				for (const key of delKeyList) {
					await r2Service.delete(c, key);
				}
			} else {
				// R2 存储支持批量删除
				await c.env.r2.delete(delKeyList);
			}
		}

		if (attList.length >= 99) {
			await this.removeAttByField(c, fieldName, fieldValues);
		}
	},

	// 清理失败的上传文件
	async cleanupFailedUploads(c, attList) {
		if (!attList || attList.length === 0) return;
		
		console.log(`开始清理 ${attList.length} 个失败的上传文件`);
		for (let att of attList) {
			if (att.key) {
				try {
					await r2Service.delete(c, att.key);
					console.log(`清理成功: ${att.key}`);
				} catch (error) {
					console.error(`清理失败: ${att.key}`, error);
				}
			}
		}
	},

	selectByEmailIds(c, emailIds) {
		return orm(c).select().from(att).where(
			and(
				inArray(att.emailId,emailIds),
				eq(att.type, attConst.type.ATT)
			))
			.all();
	}
};

export default attService;

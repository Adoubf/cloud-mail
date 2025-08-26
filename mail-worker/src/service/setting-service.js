import KvConst from '../const/kv-const';
import setting from '../entity/setting';
import orm from '../entity/orm';
import { verifyRecordType } from '../const/entity-const';
import fileUtils from '../utils/file-utils';
import r2Service from './r2-service';
import emailService from './email-service';
import accountService from './account-service';
import userService from './user-service';
import constant from '../const/constant';
import BizError from '../error/biz-error';
import { t } from '../i18n/i18n'
import verifyRecordService from './verify-record-service';

const settingService = {

	async refresh(c) {
		const settingRow = await orm(c).select().from(setting).get();
		settingRow.resendTokens = JSON.parse(settingRow.resendTokens);
		await c.env.kv.put(KvConst.SETTING, JSON.stringify(settingRow));
	},

	async query(c) {
		let settingData = await c.env.kv.get(KvConst.SETTING, { type: 'json' });
		
		// 如果 KV 中没有数据，先从数据库中获取
		if (!settingData) {
			try {
				const settingRow = await orm(c).select().from(setting).get();
				if (settingRow) {
					settingRow.resendTokens = JSON.parse(settingRow.resendTokens || '{}');
					await c.env.kv.put(KvConst.SETTING, JSON.stringify(settingRow));
					settingData = settingRow;
				}
			} catch (error) {
				console.warn('数据库可能尚未初始化:', error.message);
				// 返回默认配置
				settingData = {
					register: 0,
					receive: 0,
					title: 'Cloud Mail',
					manyEmail: 1,
					addEmail: 0,
					autoRefreshTime: 0,
					addEmailVerify: 1,
					registerVerify: 1,
					resendTokens: {}
				};
			}
		}
		
		let domainList = c.env.domain;
		if (typeof domainList === 'string') {
			try {
				domainList = JSON.parse(domainList)
			} catch (error) {
				throw new BizError(t('notJsonDomain'));
			}
		}
		domainList = domainList.map(item => '@' + item);
		settingData.domainList = domainList;
		return settingData;
	},

	async get(c) {

		const [settingRow, recordList] = await Promise.all([
			await this.query(c),
			verifyRecordService.selectListByIP(c)
		]);

		settingRow.secretKey = settingRow.secretKey ? `${settingRow.secretKey.slice(0, 12)}******` : null;
		Object.keys(settingRow.resendTokens).forEach(key => {
			settingRow.resendTokens[key] = `${settingRow.resendTokens[key].slice(0, 12)}******`;
		});

		let regVerifyOpen = false
		let addVerifyOpen = false

		recordList.forEach(row => {
			if (row.type === verifyRecordType.REG) {
				regVerifyOpen = row.count >= settingRow.regVerifyCount
			}
			if (row.type === verifyRecordType.ADD) {
				addVerifyOpen = row.count >= settingRow.addVerifyCount
			}
		})

		settingRow.regVerifyOpen = regVerifyOpen
		settingRow.addVerifyOpen = addVerifyOpen

		return settingRow;
	},

	async set(c, params) {
		const settingData = await this.query(c);
		let resendTokens = { ...settingData.resendTokens, ...params.resendTokens };
		Object.keys(resendTokens).forEach(domain => {
			if (!resendTokens[domain]) delete resendTokens[domain];
		});
		params.resendTokens = JSON.stringify(resendTokens);
		await orm(c).update(setting).set({ ...params }).returning().get();
		await this.refresh(c);
	},

	async setBackground(c, params) {

		const settingRow = await this.query(c);

		let { background } = params

		if (background && !background.startsWith('http')) {

			// 检查存储配置 - 支持R2和MinIO
			const storageType = c.env.STORAGE_TYPE || 'r2';
			const hasStorage = storageType === 'minio' ? 
				(c.env.MINIO_ENDPOINT && c.env.MINIO_ACCESS_KEY && c.env.MINIO_SECRET_KEY && c.env.MINIO_BUCKET_NAME) :
				c.env.r2;

			if (!hasStorage) {
				throw new BizError(t('noOsUpBack'));
			}

			if (!settingRow.r2Domain) {
				throw new BizError(t('noOsDomainUpBack'));
			}

			const file = fileUtils.base64ToFile(background)

			const arrayBuffer = await file.arrayBuffer();
			background = constant.BACKGROUND_PREFIX + await fileUtils.getBuffHash(arrayBuffer) + fileUtils.getExtFileName(file.name);


			await r2Service.putObj(c, background, arrayBuffer, {
				contentType: file.type
			});

		}

		if (settingRow.background) {
			try {
				await r2Service.delete(c, settingRow.background);
			} catch (e) {
				console.error(e)
			}
		}

		await orm(c).update(setting).set({ background }).run();
		await this.refresh(c);
		return background;
	},

	async physicsDeleteAll(c) {
		await emailService.physicsDeleteAll(c);
		await accountService.physicsDeleteAll(c);
		await userService.physicsDeleteAll(c);
	},

	async websiteConfig(c) {

		const settingRow = await this.get(c)

		// 获取存储域名信息
		const storageType = c.env.STORAGE_TYPE || 'r2';
		let storageDomain = settingRow.r2Domain; // 默认使用 R2 域名
		
		if (storageType === 'minio') {
			// 如果使用 MinIO，使用 MinIO 的访问域名
			const endpoint = c.env.MINIO_ENDPOINT;
			const bucket = c.env.MINIO_BUCKET_NAME;
			storageDomain = endpoint && bucket ? `${endpoint}/${bucket}` : null;
		}

		return {
			register: settingRow.register,
			title: settingRow.title,
			manyEmail: settingRow.manyEmail,
			addEmail: settingRow.addEmail,
			autoRefreshTime: settingRow.autoRefreshTime,
			addEmailVerify: settingRow.addEmailVerify,
			registerVerify: settingRow.registerVerify,
			send: settingRow.send,
			r2Domain: settingRow.r2Domain,
			storageDomain: storageDomain, // 新增：存储域名
			storageType: storageType, // 新增：存储类型
			siteKey: settingRow.siteKey,
			background: settingRow.background,
			loginOpacity: settingRow.loginOpacity,
			domainList: settingRow.domainList,
			regKey: settingRow.regKey,
			regVerifyOpen: settingRow.regVerifyOpen,
			addVerifyOpen: settingRow.addVerifyOpen,
			noticeTitle: settingRow.noticeTitle,
			noticeContent: settingRow.noticeContent,
			noticeType: settingRow.noticeType,
			noticeDuration: settingRow.noticeDuration,
			noticePosition: settingRow.noticePosition,
			noticeWidth: settingRow.noticeWidth,
			noticeOffset: settingRow.noticeOffset,
			notice: settingRow.notice,
			loginDomain: settingRow.loginDomain
		};
	}
};

export default settingService;

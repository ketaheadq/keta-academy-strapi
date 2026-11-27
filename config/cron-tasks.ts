import type { Core } from "@strapi/strapi";
import { retentionDays, UIDS } from "../src/deneme/config";

export default {
	/**
	 * Every night at 03:30: delete report requests and exam results older than the retention period
	 * (DENEME_RETENTION_DAYS, default 365, minimum 90 so report links stay open at least 90 days).
	 */
	denemeVerisiTemizligi: {
		task: async ({ strapi }: { strapi: Core.Strapi }) => {
			const before = new Date(Date.now() - retentionDays() * 24 * 60 * 60 * 1000);
			const talepler = await strapi.db
				.query(UIDS.talep)
				.deleteMany({ where: { createdAt: { $lt: before } } });
			const sonuclar = await strapi.db
				.query(UIDS.sonuc)
				.deleteMany({ where: { createdAt: { $lt: before } } });
			strapi.log.info(
				`[deneme] Retention cleanup: ${talepler.count} requests and ${sonuclar.count} results older than ${before.toISOString()} deleted`,
			);
		},
		options: { rule: "30 3 * * *", tz: "Europe/Istanbul" },
	},
};

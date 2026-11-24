import type { Core } from "@strapi/strapi";
import { UIDS } from "./config";
import { sendReport } from "./report";

/**
 * Sends the report when the teacher ticks "Hoca onayı" and saves the request in the panel.
 * Also retries a failed SMS ("Hata") on the next approved save.
 */
export function sendReportOnApproval(strapi: Core.Strapi) {
	strapi.documents.use(async (context, next) => {
		const result = await next();
		if (context.uid !== UIDS.talep || context.action !== "update") return result;
		const documentId = (context.params as { documentId?: string })?.documentId;
		if (!documentId) return result;
		const talep = await strapi.db.query(UIDS.talep).findOne({ where: { documentId } });
		if (
			talep?.hocaOnayi &&
			talep.raporIzni &&
			talep.raporVerisi &&
			(talep.gonderimDurumu === "Onay_bekliyor" || talep.gonderimDurumu === "Hata")
		) {
			await sendReport(strapi, talep.id);
		}
		return result;
	});
}

/** Data for the admin home widget: latest requests (call list) and lessons without a topic. */
export function registerPanelRoute(strapi: Core.Strapi) {
	strapi.server.routes({
		type: "admin",
		routes: [
			{
				method: "GET",
				// The admin API has no prefix of its own; "/admin/…" matches Strapi's admin endpoints.
				path: "/admin/deneme-panel",
				handler: async (ctx) => {
					const talepler = await strapi.db.query(UIDS.talep).findMany({
						orderBy: { createdAt: "desc" },
						limit: 15,
						select: [
							"documentId",
							"adSoyad",
							"telefon",
							"yakinlik",
							"durum",
							"gonderimDurumu",
							"denemeBaslik",
							"net",
							"zayifKonular",
							"raporLinki",
							"aramaIzni",
							"kaynak",
							"createdAt",
						],
					});
					const aranacak = await strapi.db.query(UIDS.talep).count({ where: { durum: "Aranacak" } });
					const onayBekleyen = await strapi.db.query(UIDS.talep).count({
						where: { gonderimDurumu: { $in: ["Onay_bekliyor", "Hata"] } },
					});

					const tagged = await strapi.db.query(UIDS.konu).findMany({
						populate: { dersVideolari: { select: ["documentId"] } },
					});
					const taggedIds = new Set(tagged.flatMap((k) => (k.dersVideolari ?? []).map((l: { documentId: string }) => l.documentId)));
					const lessons = await strapi.db.query(UIDS.lesson).findMany({
						where: { publishedAt: { $notNull: true } },
						select: ["documentId", "title"],
						orderBy: { title: "asc" },
						limit: 2000,
					});
					const konusuz = lessons.filter((l) => !taggedIds.has(l.documentId));

					ctx.body = {
						data: {
							talepler,
							aranacak,
							onayBekleyen,
							konusuzVideolar: konusuz.slice(0, 50),
							konusuzVideoSayisi: konusuz.length,
						},
					};
				},
				config: { policies: ["admin::isAuthenticatedAdmin"] },
				info: { type: "admin" },
			},
		],
	});
}

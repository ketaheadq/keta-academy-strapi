import type { Core } from "@strapi/strapi";
import { UIDS } from "./config";

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
							"raporAcilmaSayisi",
							"denemeBaslik",
							"net",
							"zayifKonular",
							"raporLinki",
							"aramaIzni",
							"kaynak",
							"createdAt",
						],
					});
					const aranacak = await strapi.db
						.query(UIDS.talep)
						.count({ where: { durum: "Aranacak" } });
					const yorumsuz = await strapi.db.query(UIDS.talep).count({
						where: { yapayZekaHatasi: { $notNull: true }, hocaNotu: { $null: true } },
					});

					const tagged = await strapi.db.query(UIDS.konu).findMany({
						populate: { dersVideolari: { select: ["documentId"] } },
					});
					const taggedIds = new Set(
						tagged.flatMap((k) =>
							(k.dersVideolari ?? []).map((l: { documentId: string }) => l.documentId),
						),
					);
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
							yorumsuz,
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

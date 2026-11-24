import { MAX_REQUESTS_PER_PHONE_PER_DAY, SOLVED_COUNTER_THRESHOLD, UIDS, whatsappNumber } from "../../../deneme/config";
import { normalizeMobile } from "../../../deneme/phone";
import { createRequest, newKey, type ReportData } from "../../../deneme/report";
import { LETTERS, parseAnswers, type QuestionForScoring, scoreExam } from "../../../deneme/scoring";

/**
 * Public mock-exam endpoints. The answer key and solutions never leave the server:
 * questions are sent without them, and scoring happens here.
 */

// biome-ignore lint/suspicious/noExplicitAny: Strapi's populate typing doesn't cover components in components
const QUESTION_POPULATE: any = {
	sorular: {
		populate: { gorsel: true, secenekler: { populate: { gorsel: true } }, konu: true },
	},
};

// biome-ignore lint/suspicious/noExplicitAny: see above
const LIST_POPULATE: any = {
	sinif: { fields: ["title", "slug"] },
	ders: { fields: ["title", "slug"] },
	konular: { fields: ["ad", "slug"] },
	sorular: { fields: ["dogruSecenek"] },
	SEO: { populate: { metaImage: true } },
};

type Media = { url: string; alternativeText?: string | null; width?: number; height?: number } | null | undefined;
const media = (m: Media) => (m?.url ? { url: m.url, alt: m.alternativeText ?? "", width: m.width, height: m.height } : null);

async function solvedCounts() {
	const rows = await strapi.db.query(UIDS.sonuc).findMany({ populate: { deneme: { select: ["documentId"] } }, select: ["id"] });
	const counts = new Map<string, number>();
	for (const row of rows) {
		const id = row.deneme?.documentId;
		if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
	}
	return counts;
}

// biome-ignore lint/suspicious/noExplicitAny: Strapi document shape
function summary(deneme: any, counts: Map<string, number>) {
	const solved = counts.get(deneme.documentId) ?? 0;
	return {
		documentId: deneme.documentId,
		baslik: deneme.baslik,
		slug: deneme.slug,
		aciklama: deneme.aciklama ?? "",
		sinavTuru: deneme.sinavTuru,
		sinif: deneme.sinif ? { title: deneme.sinif.title, slug: deneme.sinif.slug } : null,
		ders: deneme.ders ? { title: deneme.ders.title, slug: deneme.ders.slug } : null,
		konular: (deneme.konular ?? []).map((k: { ad: string; slug: string }) => ({ ad: k.ad, slug: k.slug })),
		sureDakika: deneme.sureDakika,
		soruSayisi: deneme.sorular?.length ?? 0,
		oneCikan: Boolean(deneme.oneCikan),
		// Shown only once real numbers are meaningful (plan: "eşiği geçince").
		cozenSayisi: solved >= SOLVED_COUNTER_THRESHOLD ? solved : null,
		SEO: deneme.SEO
			? {
					metaTitle: deneme.SEO.metaTitle,
					metaDescription: deneme.SEO.metaDescription,
					keywords: deneme.SEO.keywords ?? null,
					metaImage: media(deneme.SEO.metaImage),
				}
			: null,
		publishedAt: deneme.publishedAt,
	};
}

const bad = (ctx, message: string) => ctx.badRequest(message);

export default {
	async list(ctx) {
		const [denemeler, counts] = await Promise.all([
			strapi.documents(UIDS.deneme).findMany({ status: "published", populate: LIST_POPULATE, limit: 200 }),
			solvedCounts(),
		]);
		const data = denemeler
			.map((d) => summary(d, counts))
			.sort((a, b) => Number(b.oneCikan) - Number(a.oneCikan) || String(b.publishedAt).localeCompare(String(a.publishedAt)));
		ctx.body = { data };
	},

	async detail(ctx) {
		const deneme = await strapi.documents(UIDS.deneme).findFirst({
			filters: { slug: ctx.params.slug },
			status: "published",
			populate: { ...LIST_POPULATE, ...QUESTION_POPULATE },
		});
		if (!deneme) return ctx.notFound();
		ctx.body = {
			data: {
				...summary(deneme, await solvedCounts()),
				// biome-ignore lint/suspicious/noExplicitAny: component shape
				sorular: ((deneme as any).sorular ?? []).map((soru: any, index: number) => ({
					no: index + 1,
					metin: soru.metin,
					gorsel: media(soru.gorsel),
					// biome-ignore lint/suspicious/noExplicitAny: component shape
					secenekler: (soru.secenekler ?? []).slice(0, LETTERS.length).map((s: any, i: number) => ({
						harf: LETTERS[i],
						metin: s.metin ?? "",
						gorsel: media(s.gorsel),
					})),
				})),
			},
		};
	},

	/** Scores a finished exam. No sign-up: the result is tied to an anonymous session id. */
	async submit(ctx) {
		const deneme = await strapi.documents(UIDS.deneme).findFirst({
			filters: { slug: ctx.params.slug },
			status: "published",
			populate: QUESTION_POPULATE,
		});
		if (!deneme) return ctx.notFound();
		// biome-ignore lint/suspicious/noExplicitAny: populated component
		const questions = ((deneme as any).sorular ?? []) as QuestionForScoring[];
		const body = ctx.request.body ?? {};
		const answers = parseAnswers(body.cevaplar, questions.length);
		if (!answers) return bad(ctx, "cevaplar geçersiz");
		const oturumId = typeof body.oturumId === "string" ? body.oturumId.slice(0, 64) : null;
		const sureSaniye = Number.isInteger(body.sureSaniye) && body.sureSaniye >= 0 ? body.sureSaniye : null;
		const kaynak = typeof body.kaynak === "string" ? body.kaynak.slice(0, 100) : "dogrudan";
		const utm = body.utm && typeof body.utm === "object" && !Array.isArray(body.utm) ? body.utm : null;

		const score = scoreExam(questions, answers);
		const sonucAnahtari = newKey();
		await strapi.db.query(UIDS.sonuc).create({
			data: {
				deneme: deneme.id,
				denemeBaslik: deneme.baslik,
				cevaplar: answers,
				dogru: score.dogru,
				yanlis: score.yanlis,
				bos: score.bos,
				net: score.net,
				konuOranlari: score.konular,
				kaynak,
				utm,
				oturumId,
				sureSaniye,
				sonucAnahtari,
			},
		});
		ctx.body = {
			data: {
				sonucAnahtari,
				dogru: score.dogru,
				yanlis: score.yanlis,
				bos: score.bos,
				net: score.net,
				soruSayisi: score.soruSayisi,
				// Names only: the per-topic percentages are in the report (locked until a number is given).
				konular: score.konular.filter((k) => k.slug !== "diger").map((k) => k.ad),
			},
		};
	},

	/** Unlocks the detailed report: phone + name + relation, separate report and call consents. */
	async requestReport(ctx) {
		const body = ctx.request.body ?? {};
		const sonuc =
			typeof body.sonucAnahtari === "string"
				? await strapi.db.query(UIDS.sonuc).findOne({ where: { sonucAnahtari: body.sonucAnahtari } })
				: null;
		if (!sonuc) return ctx.notFound("Sonuç bulunamadı");
		return handleNewRequest(ctx, sonuc, body);
	},

	/** Public report page data, by its unguessable key. */
	async report(ctx) {
		const talep = await strapi.db.query(UIDS.talep).findOne({ where: { raporAnahtari: ctx.params.key } });
		if (!talep) return ctx.notFound();
		const data = talep.raporVerisi as ReportData | null;
		if (!data) {
			ctx.body = { data: { hazir: false } };
			return;
		}
		if (ctx.query.onizleme !== "1") {
			await strapi.db.query(UIDS.talep).update({
				where: { id: talep.id },
				data: { raporAcilmaSayisi: (talep.raporAcilmaSayisi ?? 0) + 1, ilkAcilma: talep.ilkAcilma ?? new Date() },
			});
		}
		ctx.body = {
			data: {
				hazir: true,
				ad: String(talep.adSoyad).trim().split(/\s+/)[0],
				yakinlik: talep.yakinlik,
				...data,
				hocaYorumu: talep.raporMetni || null,
				aramaIzni: Boolean(talep.aramaIzni) && talep.yakinlik !== "Ogrenci",
				whatsappNumarasi: whatsappNumber() || null,
				veliNumarasiIstenir: talep.yakinlik === "Ogrenci",
			},
		};
	},

	/** A student who left their own number adds a parent's number from the report page. */
	async addParent(ctx) {
		const talep = await strapi.db.query(UIDS.talep).findOne({
			where: { raporAnahtari: ctx.params.key },
			populate: { sinavSonucu: true },
		});
		if (!talep?.sinavSonucu) return ctx.notFound();
		return handleNewRequest(ctx, talep.sinavSonucu, { ...(ctx.request.body ?? {}), yakinlik: "Veli" });
	},

	/** For lesson pages: lesson documentId → a published exam covering one of its topics. */
	async lessonExams(ctx) {
		const ids = String(ctx.query.dersler ?? "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean)
			.slice(0, 200);
		if (!ids.length) {
			ctx.body = { data: {} };
			return;
		}
		const konular = await strapi.db.query(UIDS.konu).findMany({
			where: { dersVideolari: { documentId: { $in: ids } } },
			populate: { dersVideolari: { select: ["documentId"] } },
		});
		const denemeler = konular.length
			? await strapi.documents(UIDS.deneme).findMany({
					status: "published",
					filters: { konular: { slug: { $in: konular.map((k) => k.slug) } } },
					populate: { konular: { fields: ["slug"] } },
					fields: ["baslik", "slug"],
				})
			: [];
		const map: Record<string, { baslik: string; slug: string }> = {};
		for (const konu of konular) {
			// biome-ignore lint/suspicious/noExplicitAny: populated relation
			const deneme = denemeler.find((d: any) => (d.konular ?? []).some((k: { slug: string }) => k.slug === konu.slug));
			if (!deneme) continue;
			for (const lesson of konu.dersVideolari ?? []) {
				if (ids.includes(lesson.documentId) && !map[lesson.documentId]) {
					map[lesson.documentId] = { baslik: deneme.baslik, slug: deneme.slug };
				}
			}
		}
		ctx.body = { data: map };
	},
};

// biome-ignore lint/suspicious/noExplicitAny: koa context
async function handleNewRequest(ctx: any, sonuc: { documentId: string; denemeBaslik: string; net: unknown }, body: any) {
	const adSoyad = typeof body.adSoyad === "string" ? body.adSoyad.trim().replace(/\s+/g, " ") : "";
	if (adSoyad.length < 3 || adSoyad.length > 100 || !adSoyad.includes(" ")) {
		return bad(ctx, "Ad ve soyad girin");
	}
	const telefon = normalizeMobile(body.telefon);
	if (!telefon) return bad(ctx, "Geçerli bir cep telefonu numarası girin (05xx xxx xx xx)");
	if (!["Veli", "Ogrenci", "Diger"].includes(body.yakinlik)) return bad(ctx, "Yakınlık seçin");
	if (body.raporIzni !== true) return bad(ctx, "Raporun gönderilmesi için onay gerekli");

	const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
	const recent = await strapi.db.query(UIDS.talep).count({ where: { telefon, createdAt: { $gte: since } } });
	if (recent >= MAX_REQUESTS_PER_PHONE_PER_DAY) {
		return ctx.tooManyRequests("Bu numara için bugün yeterince rapor istendi, yarın tekrar deneyin.");
	}

	const result = await createRequest(strapi, sonuc, {
		adSoyad,
		telefon,
		yakinlik: body.yakinlik,
		aramaIzni: body.aramaIzni === true,
		kaynak: typeof body.kaynak === "string" ? body.kaynak.slice(0, 100) : "dogrudan",
	});
	ctx.body = { data: { telefon: result.telefon } };
}


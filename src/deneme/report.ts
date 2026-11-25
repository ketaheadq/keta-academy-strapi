import { randomBytes } from "node:crypto";
import type { Core } from "@strapi/strapi";
import { type CommentInput, type ReportComment, writeComment } from "./ai";
import { RANK_THRESHOLD, siteUrl, UIDS, VIDEOS_PER_TOPIC, WEAK_TOPIC_COUNT } from "./config";
import { sendTeacherEmail } from "./notify";
import { maskMobile } from "./phone";
import { LETTERS, type TopicStat, weakestTopics } from "./scoring";
import { blocksToText } from "./text";

export const newKey = () => randomBytes(24).toString("base64url");

type Video = { baslik: string; url: string };

/** One wrong or blank question, with everything the PDF shows about it. */
export type QuestionReview = {
	no: number;
	konu: string;
	konuSlug: string;
	durum: "yanlis" | "bos";
	soru: string;
	gorselUrl: string | null;
	secenekler: { harf: string; metin: string; gorselUrl: string | null }[];
	ogrenciCevabi: string | null;
	dogruCevap: string;
	cozum: string;
	video: Video | null;
};

export type ReportData = {
	deneme: { baslik: string; slug: string; sinavTuru: string };
	dogru: number;
	yanlis: number;
	bos: number;
	net: number;
	soruSayisi: number;
	konular: TopicStat[];
	zayifKonular: { ad: string; slug: string; oran: number; videolar: Video[] }[];
	sorular: QuestionReview[];
	siralama: { yuzde: number; katilimci: number } | null;
};

/** Strapi local uploads are relative ("/uploads/…"); make them absolute so the PDF can fetch them. */
function absoluteMedia(strapi: Core.Strapi, media: { url?: string } | null | undefined) {
	if (!media?.url) return null;
	if (/^https?:\/\//.test(media.url)) return media.url;
	const base = String(strapi.config.get("server.url") || "http://localhost:1337").replace(/\/$/, "");
	return `${base}${media.url}`;
}

/** Wrong and blank questions of a result, with solution and the student's answer. */
// biome-ignore lint/suspicious/noExplicitAny: populated components
function reviewQuestions(strapi: Core.Strapi, sorular: any[], cevaplar: Record<string, string | null>) {
	const reviews: Omit<QuestionReview, "video">[] = [];
	sorular.forEach((soru, index) => {
		const optionCount = Math.max(2, soru.secenekler?.length ?? 4);
		const answer = cevaplar?.[index] ?? null;
		const valid = answer && LETTERS.indexOf(answer as (typeof LETTERS)[number]) < optionCount ? answer : null;
		if (valid === soru.dogruSecenek) return;
		reviews.push({
			no: index + 1,
			konu: soru.konu?.ad ?? "Diğer",
			konuSlug: soru.konu?.slug ?? "diger",
			durum: valid ? "yanlis" : "bos",
			soru: blocksToText(soru.metin),
			gorselUrl: absoluteMedia(strapi, soru.gorsel),
			// biome-ignore lint/suspicious/noExplicitAny: component
			secenekler: (soru.secenekler ?? []).slice(0, LETTERS.length).map((s: any, i: number) => ({
				harf: LETTERS[i],
				metin: s.metin ?? "",
				gorselUrl: absoluteMedia(strapi, s.gorsel),
			})),
			ogrenciCevabi: valid,
			dogruCevap: soru.dogruSecenek,
			cozum: blocksToText(soru.cozum),
		});
	});
	return reviews;
}

/**
 * Whether the AI has enough to write a question-specific hint. It reads text only, so a question
 * that lives in an image, or whose answers are images, gets no hint unless the teacher wrote a
 * solution for it.
 */
function hasHintContext(q: Omit<QuestionReview, "video">) {
	if (q.cozum.trim().length >= 20) return true;
	const answerTexts = [q.dogruCevap, q.ogrenciCevabi]
		.filter(Boolean)
		.map((harf) => q.secenekler.find((o) => o.harf === harf)?.metin.trim() ?? "");
	return !q.gorselUrl && q.soru.trim().length >= 40 && answerTexts.every(Boolean);
}

const turkishLower = (s: string) => s.toLocaleLowerCase("tr-TR");
const STOP_WORDS = new Set(["ve", "ile", "ile", "için", "veya", "ya", "da", "de"]);

/**
 * Fallback for lessons without a topic: a lesson matches when its title contains a word stem
 * from the topic name (first 6 letters of each word of 4+ letters, e.g. "Denklem" → "denkle").
 */
function titleMatches(topicName: string, title: string) {
	const lowerTitle = turkishLower(title);
	return turkishLower(topicName)
		.split(/[^a-zçğıöşü]+/i)
		.filter((word) => word.length >= 4 && !STOP_WORDS.has(word))
		.some((word) => lowerTitle.includes(word.slice(0, 6)));
}

/** Course page URL of each published lesson: /kurslar/<course>?ders_ismi=<lesson>. */
async function lessonUrls(strapi: Core.Strapi, lessonDocumentIds: string[]) {
	if (!lessonDocumentIds.length) return new Map<string, Video>();
	const links = await strapi.db.query(UIDS.courseLesson).findMany({
		where: {
			lesson: { documentId: { $in: lessonDocumentIds }, publishedAt: { $notNull: true } },
			course: { publishedAt: { $notNull: true } },
		},
		populate: { lesson: { select: ["documentId", "slug", "title"] }, course: { select: ["slug"] } },
	});
	const urls = new Map<string, Video>();
	for (const link of links) {
		if (!link.lesson || !link.course || urls.has(link.lesson.documentId)) continue;
		urls.set(link.lesson.documentId, {
			baslik: link.lesson.title,
			url: `${siteUrl()}/kurslar/${link.course.slug}?ders_ismi=${encodeURIComponent(link.lesson.slug)}`,
		});
	}
	return urls;
}

/** Videos for each weak topic: lessons tagged with the topic, else lessons whose title names it. */
async function videosForTopics(strapi: Core.Strapi, topics: TopicStat[]) {
	const result = new Map<string, Video[]>();
	if (!topics.length) return result;

	const konular = await strapi.db.query(UIDS.konu).findMany({
		where: { slug: { $in: topics.map((t) => t.slug) } },
		populate: { dersVideolari: { select: ["documentId"], where: { publishedAt: { $notNull: true } } } },
	});
	const tagged = new Map<string, string[]>(
		konular.map((k) => [k.slug, [...new Set<string>((k.dersVideolari ?? []).map((l: { documentId: string }) => l.documentId))]]),
	);

	let allLessons: { documentId: string; title: string }[] | null = null;
	const candidates = new Map<string, string[]>();
	for (const topic of topics) {
		let ids = tagged.get(topic.slug) ?? [];
		if (!ids.length) {
			allLessons ??= await strapi.db.query(UIDS.lesson).findMany({
				where: { publishedAt: { $notNull: true } },
				select: ["documentId", "title"],
				limit: 2000,
			});
			ids = [...new Set(allLessons.filter((l) => titleMatches(topic.ad, l.title)).map((l) => l.documentId))];
		}
		candidates.set(topic.slug, ids);
	}

	const urls = await lessonUrls(strapi, [...new Set([...candidates.values()].flat())]);
	for (const [slug, ids] of candidates) {
		result.set(slug, ids.flatMap((id) => (urls.has(id) ? [urls.get(id) as Video] : [])).slice(0, VIDEOS_PER_TOPIC));
	}
	return result;
}

/** "Katılımcıların %X'inden daha iyi": share of results for the same exam with a lower net. */
async function rank(strapi: Core.Strapi, denemeDocumentId: string, net: number) {
	const results = await strapi.db.query(UIDS.sonuc).findMany({
		where: { deneme: { documentId: denemeDocumentId } },
		select: ["net"],
	});
	if (results.length < RANK_THRESHOLD) return null;
	const below = results.filter((r) => Number(r.net) < net).length;
	return { yuzde: Math.round((below / results.length) * 100), katilimci: results.length };
}

/** Builds the report data, writes the AI comment and decides whether it can be sent right away. */
export async function prepareReport(strapi: Core.Strapi, talepId: number) {
	const talep = await strapi.db.query(UIDS.talep).findOne({
		where: { id: talepId },
		populate: { sinavSonucu: { populate: { deneme: { select: ["documentId", "baslik", "slug", "sinavTuru"] } } } },
	});
	const sonuc = talep?.sinavSonucu;
	if (!talep || !sonuc) return;

	// Another request for the same result (e.g. the parent's number) reuses its report.
	const sibling = await strapi.db.query(UIDS.talep).findOne({
		where: { sinavSonucu: { id: sonuc.id }, id: { $ne: talep.id }, raporVerisi: { $notNull: true } },
		orderBy: { id: "asc" },
	});

	let data: ReportData;
	let yorum: ReportComment | null = null;
	let aiLabel: string | null = null;
	let aiError: string | null = null;

	if (sibling?.raporVerisi) {
		data = sibling.raporVerisi;
		yorum = sibling.yapayZekaYorumu ?? null;
		aiLabel = sibling.yapayZeka ?? null;
		aiError = yorum ? null : "Aynı sonucun diğer talebinde yorum yok";
	} else {
		const konular: TopicStat[] = sonuc.konuOranlari ?? [];
		const weak = weakestTopics(konular, WEAK_TOPIC_COUNT);
		const deneme = sonuc.deneme ?? { documentId: "", baslik: sonuc.denemeBaslik, slug: "", sinavTuru: "" };
		const published = deneme.documentId
			? await strapi.documents(UIDS.deneme).findOne({
					documentId: deneme.documentId,
					status: "published",
					populate: {
						sorular: { populate: { gorsel: true, secenekler: { populate: { gorsel: true } }, konu: true } },
						// biome-ignore lint/suspicious/noExplicitAny: populate typing doesn't cover nested components
					} as any,
				})
			: null;
		// biome-ignore lint/suspicious/noExplicitAny: populated component
		const reviews = reviewQuestions(strapi, ((published as any)?.sorular ?? []) as any[], sonuc.cevaplar ?? {});

		// Videos for the weak topics and for every topic with a wrong/blank question.
		const topicsNeedingVideos = new Map<string, TopicStat>(weak.map((t) => [t.slug, t]));
		for (const r of reviews) {
			if (r.konuSlug !== "diger" && !topicsNeedingVideos.has(r.konuSlug)) {
				topicsNeedingVideos.set(r.konuSlug, { slug: r.konuSlug, ad: r.konu, toplam: 0, dogru: 0, oran: 0 });
			}
		}
		const videos = await videosForTopics(strapi, [...topicsNeedingVideos.values()]);

		data = {
			deneme: { baslik: deneme.baslik, slug: deneme.slug, sinavTuru: deneme.sinavTuru },
			dogru: sonuc.dogru,
			yanlis: sonuc.yanlis,
			bos: sonuc.bos,
			net: Number(sonuc.net),
			soruSayisi: sonuc.dogru + sonuc.yanlis + sonuc.bos,
			konular,
			zayifKonular: weak.map((t) => ({ ad: t.ad, slug: t.slug, oran: t.oran, videolar: videos.get(t.slug) ?? [] })),
			sorular: reviews.map((r) => ({ ...r, video: videos.get(r.konuSlug)?.[0] ?? null })),
			siralama: deneme.documentId ? await rank(strapi, deneme.documentId, Number(sonuc.net)) : null,
		};

		// The AI gets exam data only: no links (the template adds them), no name or phone.
		const input: CommentInput = {
			denemeBaslik: data.deneme.baslik,
			sinavTuru: data.deneme.sinavTuru,
			dogru: data.dogru,
			yanlis: data.yanlis,
			bos: data.bos,
			net: data.net,
			soruSayisi: data.soruSayisi,
			konular: data.konular.map(({ ad, oran, dogru, toplam }) => ({ ad, oran, dogru, toplam })),
			zayifKonular: data.zayifKonular.map(({ ad, oran }) => ({ ad, oran })),
			// Only questions the AI can actually reason about get a hint: it sees text, not images,
			// so a question needs the teacher's solution or a self-contained text with text answers.
			sorular: data.sorular.filter(hasHintContext).map((q) => ({
				no: q.no,
				konu: q.konu,
				durum: q.durum,
				soru: q.soru.slice(0, 600),
				ogrenciCevabi: q.ogrenciCevabi
					? `${q.ogrenciCevabi}) ${q.secenekler.find((o) => o.harf === q.ogrenciCevabi)?.metin ?? ""}`
					: null,
				dogruCevap: `${q.dogruCevap}) ${q.secenekler.find((o) => o.harf === q.dogruCevap)?.metin ?? ""}`,
				cozum: q.cozum.slice(0, 1200),
			})),
		};
		try {
			const result = await writeComment(input);
			yorum = result.yorum;
			aiLabel = `${result.provider}/${result.model}`;
		} catch (error) {
			aiError = (error as Error).message;
			strapi.log.error(`[deneme] AI comment failed for request #${talep.id}: ${aiError}`);
		}
	}

	await strapi.db.query(UIDS.talep).update({
		where: { id: talep.id },
		data: {
			raporVerisi: data,
			yapayZekaYorumu: yorum,
			yapayZeka: aiLabel,
			yapayZekaHatasi: aiError,
			zayifKonular: data.zayifKonular.map((t) => `${t.ad} (%${t.oran})`).join(", "),
		},
	});

	await notifyTeacher(strapi, talep.id);
}

async function notifyTeacher(strapi: Core.Strapi, talepId: number) {
	const talep = await strapi.db.query(UIDS.talep).findOne({ where: { id: talepId } });
	if (!talep) return;
	const lines = [
		`Ad soyad: ${talep.adSoyad} (${talep.yakinlik})`,
		`Telefon: 0${talep.telefon}`,
		`Deneme: ${talep.denemeBaslik} — net ${talep.net}`,
		`En zayıf konular: ${talep.zayifKonular || "—"}`,
		`Kaynak: ${talep.kaynak || "doğrudan"}`,
		`Arama izni: ${talep.aramaIzni ? "var" : "YOK (aranmayacak)"}`,
		`Durum: ${talep.durum}`,
		talep.yapayZekaHatasi
			? `\nYapay zeka yorumu yazılamadı (${talep.yapayZekaHatasi}). Rapor yorumsuz açılıyor; panelden 'Hoca notu' ekleyebilirsiniz.`
			: "",
		"",
		`Rapor: ${talep.raporLinki}?onizleme=1`,
	];
	try {
		await sendTeacherEmail(`Yeni rapor talebi: ${talep.adSoyad} – ${talep.denemeBaslik}`, lines.join("\n"));
		if (talep.bildirimHatasi) {
			await strapi.db.query(UIDS.talep).update({ where: { id: talepId }, data: { bildirimHatasi: null } });
		}
	} catch (error) {
		const message = (error as Error).message;
		strapi.log.error(`[deneme] Teacher e-mail failed for request #${talepId}: ${message}`);
		await strapi.db.query(UIDS.talep).update({ where: { id: talepId }, data: { bildirimHatasi: message } });
	}
}

export type NewRequest = {
	adSoyad: string;
	telefon: string;
	yakinlik: "Veli" | "Ogrenci" | "Diger";
	aramaIzni: boolean;
	kaynak: string;
};

/**
 * Creates a report request for an exam result and prepares the report in the background.
 * Students' own numbers are never called (they are minors): the request is marked "Uygun değil".
 */
export async function createRequest(
	strapi: Core.Strapi,
	sonuc: { documentId: string; denemeBaslik: string; net: unknown },
	input: NewRequest,
) {
	const callable = input.aramaIzni && input.yakinlik !== "Ogrenci";
	const raporAnahtari = newKey();
	// Document Service (not db.query): the call notes are a component.
	const talep = await strapi.documents(UIDS.talep).create({
		data: {
			adSoyad: input.adSoyad,
			telefon: input.telefon,
			yakinlik: input.yakinlik,
			raporIzni: true,
			aramaIzni: input.aramaIzni,
			durum: callable ? "Aranacak" : "Uygun_degil",
			aramaNotlari: callable
				? []
				: [
						{
							tarih: new Date(),
							not:
								input.yakinlik === "Ogrenci"
									? "Sistem: numara öğrenciye ait, satış araması yapılmaz. Raporda veli numarası istendi."
									: "Sistem: arama izni verilmedi.",
						},
					],
			sinavSonucu: sonuc.documentId,
			denemeBaslik: sonuc.denemeBaslik,
			net: sonuc.net as number,
			kaynak: input.kaynak,
			raporAnahtari,
			raporLinki: `${siteUrl()}/rapor/${raporAnahtari}`,
		},
	});
	setImmediate(() => {
		prepareReport(strapi, Number(talep.id)).catch((error) =>
			strapi.log.error(`[deneme] Report preparation failed for request #${talep.id}: ${error.message}`),
		);
	});
	return { telefon: maskMobile(input.telefon), raporAnahtari };
}

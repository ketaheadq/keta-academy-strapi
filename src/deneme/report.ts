import { randomBytes } from "node:crypto";
import type { Core } from "@strapi/strapi";
import { findUnknownLinks, writeComment } from "./ai";
import {
	MANUAL_APPROVAL_COUNT,
	RANK_THRESHOLD,
	SAMPLE_CHECK_RATE,
	siteUrl,
	UIDS,
	VIDEOS_PER_TOPIC,
	WEAK_TOPIC_COUNT,
} from "./config";
import { sendSms, sendTeacherEmail } from "./notify";
import { maskMobile } from "./phone";
import { type TopicStat, weakestTopics } from "./scoring";

export const newKey = () => randomBytes(24).toString("base64url");

type Video = { baslik: string; url: string };
export type ReportData = {
	deneme: { baslik: string; slug: string; sinavTuru: string };
	dogru: number;
	yanlis: number;
	bos: number;
	net: number;
	soruSayisi: number;
	konular: TopicStat[];
	zayifKonular: { ad: string; slug: string; oran: number; videolar: Video[] }[];
	siralama: { yuzde: number; katilimci: number } | null;
};

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
	let comment: string | null = null;
	let aiLabel: string | null = null;
	let aiError: string | null = null;

	if (sibling?.raporVerisi) {
		data = sibling.raporVerisi;
		comment = sibling.raporMetni ?? null;
		aiLabel = sibling.yapayZeka ?? null;
		aiError = comment ? null : "Aynı sonucun diğer talebinde yorum yok";
	} else {
		const konular: TopicStat[] = sonuc.konuOranlari ?? [];
		const weak = weakestTopics(konular, WEAK_TOPIC_COUNT);
		const videos = await videosForTopics(strapi, weak);
		const deneme = sonuc.deneme ?? { documentId: "", baslik: sonuc.denemeBaslik, slug: "", sinavTuru: "" };
		data = {
			deneme: { baslik: deneme.baslik, slug: deneme.slug, sinavTuru: deneme.sinavTuru },
			dogru: sonuc.dogru,
			yanlis: sonuc.yanlis,
			bos: sonuc.bos,
			net: Number(sonuc.net),
			soruSayisi: sonuc.dogru + sonuc.yanlis + sonuc.bos,
			konular,
			zayifKonular: weak.map((t) => ({ ad: t.ad, slug: t.slug, oran: t.oran, videolar: videos.get(t.slug) ?? [] })),
			siralama: deneme.documentId ? await rank(strapi, deneme.documentId, Number(sonuc.net)) : null,
		};

		try {
			const result = await writeComment({
				denemeBaslik: data.deneme.baslik,
				sinavTuru: data.deneme.sinavTuru,
				dogru: data.dogru,
				yanlis: data.yanlis,
				bos: data.bos,
				net: data.net,
				soruSayisi: data.soruSayisi,
				konular: data.konular.map(({ ad, oran, dogru, toplam }) => ({ ad, oran, dogru, toplam })),
				zayifKonular: data.zayifKonular.map(({ ad, oran, videolar }) => ({ ad, oran, videolar })),
			});
			aiLabel = `${result.provider}/${result.model}`;
			const unknown = findUnknownLinks(result.text, data.zayifKonular.flatMap((t) => t.videolar.map((v) => v.url)));
			if (unknown.length) {
				// Keep the draft for the teacher, but never send it automatically.
				comment = result.text;
				aiError = `Listede olmayan link: ${unknown.join(", ")}`;
			} else {
				comment = result.text;
			}
		} catch (error) {
			aiError = (error as Error).message;
			strapi.log.error(`[deneme] AI comment failed for request #${talep.id}: ${aiError}`);
		}
	}

	const sentCount = await strapi.db.query(UIDS.talep).count({ where: { gonderimDurumu: "Gonderildi" } });
	const autoSend = !aiError && Boolean(comment) && sentCount >= MANUAL_APPROVAL_COUNT;

	await strapi.db.query(UIDS.talep).update({
		where: { id: talep.id },
		data: {
			raporVerisi: data,
			raporMetni: comment,
			yapayZeka: aiLabel,
			yapayZekaHatasi: aiError,
			zayifKonular: data.zayifKonular.map((t) => `${t.ad} (%${t.oran})`).join(", "),
			ornekKontrol: autoSend && Math.random() < SAMPLE_CHECK_RATE,
		},
	});

	if (autoSend) await sendReport(strapi, talep.id);
	await notifyTeacher(strapi, talep.id);
}

/** Sends the report link by SMS and records the outcome on the request. */
export async function sendReport(strapi: Core.Strapi, talepId: number) {
	const talep = await strapi.db.query(UIDS.talep).findOne({ where: { id: talepId } });
	if (!talep || talep.gonderimDurumu === "Gonderildi" || talep.gonderimDurumu === "Gonderilmeyecek") return;
	const firstName = String(talep.adSoyad).trim().split(/\s+/)[0];
	const message = `Merhaba ${firstName}, KetaLearn ${talep.denemeBaslik} deneme raporunuz hazır: ${talep.raporLinki}`;
	try {
		await sendSms(talep.telefon, message);
		await strapi.db.query(UIDS.talep).update({
			where: { id: talepId },
			data: { gonderimDurumu: "Gonderildi", gonderimZamani: new Date(), gonderimHatasi: null },
		});
	} catch (error) {
		const message = (error as Error).message;
		strapi.log.error(`[deneme] SMS failed for request #${talepId}: ${message}`);
		await strapi.db.query(UIDS.talep).update({
			where: { id: talepId },
			data: { gonderimDurumu: "Hata", gonderimHatasi: message },
		});
	}
}

async function notifyTeacher(strapi: Core.Strapi, talepId: number) {
	const talep = await strapi.db.query(UIDS.talep).findOne({ where: { id: talepId } });
	if (!talep) return;
	const status =
		talep.gonderimDurumu === "Gonderildi"
			? "Rapor SMS ile gönderildi."
			: talep.gonderimDurumu === "Hata"
				? `SMS gönderilemedi: ${talep.gonderimHatasi}`
				: "Rapor onayınızı bekliyor (panelde 'Hoca onayı'nı işaretleyip kaydedin).";
	const lines = [
		`Ad soyad: ${talep.adSoyad} (${talep.yakinlik})`,
		`Telefon: 0${talep.telefon}`,
		`Deneme: ${talep.denemeBaslik} — net ${talep.net}`,
		`En zayıf konular: ${talep.zayifKonular || "—"}`,
		`Kaynak: ${talep.kaynak || "doğrudan"}`,
		`Arama izni: ${talep.aramaIzni ? "var" : "YOK (aranmayacak)"}`,
		`Durum: ${talep.durum}`,
		"",
		status,
		talep.yapayZekaHatasi ? `Yapay zeka: ${talep.yapayZekaHatasi}` : "",
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
									: "Sistem: arama izni verilmedi, yalnızca rapor gönderilir.",
						},
					],
			sinavSonucu: sonuc.documentId,
			denemeBaslik: sonuc.denemeBaslik,
			net: sonuc.net as number,
			kaynak: input.kaynak,
			raporAnahtari,
			raporLinki: `${siteUrl()}/rapor/${raporAnahtari}`,
			gonderimDurumu: "Onay_bekliyor",
		},
	});
	setImmediate(() => {
		prepareReport(strapi, Number(talep.id)).catch((error) =>
			strapi.log.error(`[deneme] Report preparation failed for request #${talep.id}: ${error.message}`),
		);
	});
	return { telefon: maskMobile(input.telefon) };
}

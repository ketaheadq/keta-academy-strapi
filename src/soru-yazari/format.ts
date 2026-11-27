import type { Core } from "@strapi/strapi";
import { UIDS } from "../deneme/config";
import { LETTERS } from "../deneme/scoring";
import { blocksToText } from "../deneme/text";

/**
 * The exam format the question-writer API reads and writes. Plain JSON with slugs and media ids
 * instead of Strapi's nested shapes, so an agent can write it by hand:
 *
 * - text fields (`metin`, `cozum`) are plain text: each line becomes a paragraph, lines starting
 *   with "- " become a bulleted list;
 * - grade, subject and topics are referenced by slug;
 * - images are media ids returned by POST /api/soru-yazari/gorseller.
 */

export const EXAM_TYPES = ["LGS", "TYT", "AYT", "Okul"] as const;
export const DIFFICULTIES = ["Kolay", "Orta", "Zor"] as const;
const MAX_QUESTIONS = 100;

export type OptionInput = { metin?: string | null; gorsel?: number | null };
export type QuestionInput = {
	metin: string;
	gorsel?: number | null;
	secenekler: OptionInput[];
	dogruSecenek: string;
	zorluk?: string;
	konu: string;
	cozum?: string | null;
};
export type ExamInput = {
	baslik: string;
	slug?: string;
	aciklama?: string | null;
	sinavTuru: string;
	sinif?: string | null;
	ders?: string | null;
	konular?: string[];
	sureDakika: number;
	oneCikan?: boolean;
	sorular: QuestionInput[];
	SEO?: {
		metaTitle: string;
		metaDescription: string;
		keywords?: string | null;
	} | null;
};

/** Plain text → Strapi blocks: one paragraph per line, "- " lines grouped into a list. */
export function textToBlocks(text: string | null | undefined) {
	const lines = String(text ?? "")
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	// biome-ignore lint/suspicious/noExplicitAny: Strapi blocks are a loose JSON tree
	const blocks: any[] = [];
	for (const line of lines) {
		const item = /^[-•]\s+(.*)$/.exec(line);
		if (item) {
			const last = blocks.at(-1);
			const li = {
				type: "list-item",
				children: [{ type: "text", text: item[1] }],
			};
			if (last?.type === "list") last.children.push(li);
			else blocks.push({ type: "list", format: "unordered", children: [li] });
		} else {
			blocks.push({
				type: "paragraph",
				children: [{ type: "text", text: line }],
			});
		}
	}
	return blocks;
}

/** Strapi blocks → the plain text format above (lists come back as "- " lines). */
// biome-ignore lint/suspicious/noExplicitAny: Strapi blocks
export function blocksToPlain(blocks: any): string {
	if (!Array.isArray(blocks)) return "";
	// biome-ignore lint/suspicious/noExplicitAny: see above
	const inline = (nodes: any[]): string =>
		(nodes ?? [])
			.map((n) => (typeof n?.text === "string" ? n.text : inline(n?.children ?? [])))
			.join("");
	return blocks
		.map((block) =>
			block?.type === "list"
				? (block.children ?? [])
						.map((item: { children?: unknown[] }) => `- ${inline(item.children ?? [])}`)
						.join("\n")
				: inline(block?.children ?? []),
		)
		.filter((t: string) => t.trim())
		.join("\n");
}

const TURKISH: Record<string, string> = {
	ç: "c",
	ğ: "g",
	ı: "i",
	ö: "o",
	ş: "s",
	ü: "u",
	â: "a",
	î: "i",
	û: "u",
};

export function slugify(text: string) {
	return text
		.toLocaleLowerCase("tr-TR")
		.replace(/[çğıöşüâîû]/g, (c) => TURKISH[c] ?? c)
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
}

type Issue = { yol: string; hata: string };

const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/**
 * Checks an exam against the content model and the catalogue, and turns it into the data
 * Strapi's document service takes. Collects every problem instead of stopping at the first,
 * so the agent can fix them all at once.
 */
export async function toDocumentData(
	strapi: Core.Strapi,
	input: ExamInput,
	options: { documentId?: string } = {},
): Promise<{
	data: Record<string, unknown> | null;
	hatalar: Issue[];
	uyarilar: Issue[];
}> {
	const hatalar: Issue[] = [];
	const uyarilar: Issue[] = [];
	const fail = (yol: string, hata: string) => hatalar.push({ yol, hata });

	if (!input || typeof input !== "object")
		return {
			data: null,
			hatalar: [{ yol: "", hata: "JSON nesnesi bekleniyor" }],
			uyarilar,
		};

	if (!isText(input.baslik)) fail("baslik", "Zorunlu");
	const slug = slugify(isText(input.slug) ? input.slug : String(input.baslik ?? ""));
	if (!slug) fail("slug", "Başlıktan slug üretilemedi; slug alanını verin");
	if (!EXAM_TYPES.includes(input.sinavTuru as (typeof EXAM_TYPES)[number])) {
		fail("sinavTuru", `Şunlardan biri olmalı: ${EXAM_TYPES.join(", ")}`);
	}
	if (!Number.isInteger(input.sureDakika) || input.sureDakika < 1)
		fail("sureDakika", "1 veya daha büyük tam sayı olmalı");
	if (!Array.isArray(input.sorular) || !input.sorular.length)
		fail("sorular", "En az bir soru gerekli");
	else if (input.sorular.length > MAX_QUESTIONS) fail("sorular", `En fazla ${MAX_QUESTIONS} soru`);
	if (input.SEO && (!isText(input.SEO.metaTitle) || !isText(input.SEO.metaDescription))) {
		fail("SEO", "metaTitle ve metaDescription birlikte verilmeli");
	}

	// Slug must be unique among exams (other than the one being updated).
	if (slug) {
		const clash = await strapi.db
			.query(UIDS.deneme)
			.findOne({ where: { slug }, select: ["documentId"] });
		if (clash && clash.documentId !== options.documentId)
			fail("slug", `"${slug}" başka bir denemede kullanılıyor`);
	}

	// Catalogue look-ups by slug.
	const bySlug = async (uid: string, slugs: string[]) => {
		if (!slugs.length) return new Map<string, string>();
		const rows = await strapi.db.query(uid).findMany({
			where: { slug: { $in: slugs } },
			select: ["slug", "documentId"],
		});
		return new Map<string, string>(
			rows.map((r: { slug: string; documentId: string }) => [r.slug, r.documentId]),
		);
	};
	const grade = input.sinif
		? (await bySlug("api::grade.grade", [input.sinif])).get(input.sinif)
		: undefined;
	if (input.sinif && !grade) fail("sinif", `"${input.sinif}" sınıfı yok (GET /katalog → siniflar)`);
	const subject = input.ders
		? (await bySlug("api::subject.subject", [input.ders])).get(input.ders)
		: undefined;
	if (input.ders && !subject) fail("ders", `"${input.ders}" dersi yok (GET /katalog → dersler)`);

	const questions = Array.isArray(input.sorular) ? input.sorular : [];
	const topicSlugs = [
		...new Set([...(input.konular ?? []), ...questions.map((q) => q?.konu).filter(isText)]),
	];
	const topics = await bySlug(UIDS.konu, topicSlugs);

	const mediaIds = new Set<number>();
	for (const q of questions) {
		if (q?.gorsel != null) mediaIds.add(Number(q.gorsel));
		for (const o of Array.isArray(q?.secenekler) ? q.secenekler : [])
			if (o?.gorsel != null) mediaIds.add(Number(o.gorsel));
	}
	const foundMedia = mediaIds.size
		? new Set(
				(
					await strapi.db
						.query("plugin::upload.file")
						.findMany({ where: { id: { $in: [...mediaIds] } }, select: ["id"] })
				).map((f: { id: number }) => f.id),
			)
		: new Set<number>();
	const media = (value: unknown, yol: string) => {
		if (value == null) return null;
		const id = Number(value);
		if (!Number.isInteger(id) || !foundMedia.has(id)) {
			fail(yol, `${value} numaralı görsel yok (önce POST /gorseller ile yükleyin)`);
			return null;
		}
		return id;
	};

	const sorular = questions.map((q, i) => {
		const at = `sorular[${i}]`;
		if (!q || typeof q !== "object") {
			fail(at, "Soru nesnesi bekleniyor");
			return null;
		}
		if (!isText(q.metin)) fail(`${at}.metin`, "Zorunlu");
		const options = Array.isArray(q.secenekler) ? q.secenekler : [];
		if (options.length < 2 || options.length > LETTERS.length)
			fail(`${at}.secenekler`, "2 ile 5 arasında şık olmalı");
		const letters = LETTERS.slice(0, options.length) as readonly string[];
		if (!letters.includes(q.dogruSecenek))
			fail(`${at}.dogruSecenek`, `Şunlardan biri olmalı: ${letters.join(", ") || "A–E"}`);
		if (q.zorluk != null && !DIFFICULTIES.includes(q.zorluk as (typeof DIFFICULTIES)[number])) {
			fail(`${at}.zorluk`, `Şunlardan biri olmalı: ${DIFFICULTIES.join(", ")}`);
		}
		if (!isText(q.konu)) fail(`${at}.konu`, "Zorunlu: konu slug'ı (GET /katalog → konular)");
		else if (!topics.has(q.konu))
			fail(`${at}.konu`, `"${q.konu}" konusu yok (GET /katalog → konular)`);
		if (!isText(q.cozum))
			uyarilar.push({
				yol: `${at}.cozum`,
				hata: "Çözüm yok: raporda çözüm ve hocanın ipucu çıkmaz",
			});

		const texts = options.map((o) => (isText(o?.metin) ? o.metin.trim() : ""));
		const duplicate = texts.find((t, j) => t && texts.indexOf(t) !== j);
		if (duplicate) fail(`${at}.secenekler`, `Aynı şık iki kez var: "${duplicate}"`);

		return {
			metin: textToBlocks(q.metin),
			gorsel: media(q.gorsel, `${at}.gorsel`),
			secenekler: options.map((o, j) => {
				const yol = `${at}.secenekler[${j}]`;
				if (!isText(o?.metin) && o?.gorsel == null) fail(yol, "Şıkta metin ya da görsel olmalı");
				return {
					metin: isText(o?.metin) ? o.metin.trim() : null,
					gorsel: media(o?.gorsel, `${yol}.gorsel`),
				};
			}),
			dogruSecenek: q.dogruSecenek,
			zorluk: q.zorluk ?? "Orta",
			konu: topics.get(q.konu) ?? null,
			cozum: isText(q.cozum) ? textToBlocks(q.cozum) : null,
		};
	});

	for (const s of input.konular ?? []) if (!topics.has(s)) fail("konular", `"${s}" konusu yok`);
	// The exam's topics default to the topics of its questions.
	const examTopics = (input.konular?.length ? input.konular : questions.map((q) => q?.konu)).filter(
		(s): s is string => isText(s) && topics.has(s),
	);

	if (hatalar.length) return { data: null, hatalar, uyarilar };
	return {
		data: {
			baslik: input.baslik.trim(),
			slug,
			aciklama: input.aciklama ?? null,
			sinavTuru: input.sinavTuru,
			sinif: grade ?? null,
			ders: subject ?? null,
			konular: [...new Set(examTopics.map((s) => topics.get(s) as string))],
			sureDakika: input.sureDakika,
			oneCikan: Boolean(input.oneCikan),
			sorular,
			SEO: input.SEO
				? {
						metaTitle: input.SEO.metaTitle,
						metaDescription: input.SEO.metaDescription,
						keywords: input.SEO.keywords ?? null,
					}
				: null,
		},
		hatalar,
		uyarilar,
	};
}

type MediaRow = {
	id: number;
	url: string;
	alternativeText?: string | null;
	width?: number;
	height?: number;
} | null;
const mediaOut = (m: MediaRow) =>
	m
		? {
				id: m.id,
				url: m.url,
				alt: m.alternativeText ?? "",
				width: m.width,
				height: m.height,
			}
		: null;

/** A stored exam in the same format the API accepts, plus read-only ids and media URLs. */
// biome-ignore lint/suspicious/noExplicitAny: populated Strapi document
export function fromDocument(doc: any) {
	return {
		documentId: doc.documentId,
		durum: doc.publishedAt ? "yayında" : "taslak",
		baslik: doc.baslik,
		slug: doc.slug,
		aciklama: doc.aciklama ?? null,
		sinavTuru: doc.sinavTuru,
		sinif: doc.sinif?.slug ?? null,
		ders: doc.ders?.slug ?? null,
		konular: (doc.konular ?? []).map((k: { slug: string }) => k.slug),
		sureDakika: doc.sureDakika,
		oneCikan: Boolean(doc.oneCikan),
		// biome-ignore lint/suspicious/noExplicitAny: component
		sorular: (doc.sorular ?? []).map((q: any, i: number) => ({
			no: i + 1,
			metin: blocksToPlain(q.metin) || blocksToText(q.metin),
			gorsel: q.gorsel?.id ?? null,
			gorselBilgi: mediaOut(q.gorsel),
			// biome-ignore lint/suspicious/noExplicitAny: component
			secenekler: (q.secenekler ?? []).map((o: any) => ({
				metin: o.metin ?? null,
				gorsel: o.gorsel?.id ?? null,
				gorselBilgi: mediaOut(o.gorsel),
			})),
			dogruSecenek: q.dogruSecenek,
			zorluk: q.zorluk,
			konu: q.konu?.slug ?? null,
			cozum: blocksToPlain(q.cozum) || null,
		})),
		SEO: doc.SEO
			? {
					metaTitle: doc.SEO.metaTitle,
					metaDescription: doc.SEO.metaDescription,
					keywords: doc.SEO.keywords ?? null,
				}
			: null,
	};
}

import { UIDS } from "../../../deneme/config";
import { blocksToText } from "../../../deneme/text";
import {
	DIFFICULTIES,
	EXAM_TYPES,
	type ExamInput,
	fromDocument,
	toDocumentData,
} from "../../../soru-yazari/format";
import { MAX_UPLOAD_BYTES, storeImage } from "../../../soru-yazari/images";

/**
 * Question-writer API (see routes/soru-yazari.ts). Reads use the database directly so drafts
 * and unpublished lessons are visible too; writes go through the document service and only
 * ever touch the draft version of an exam.
 */

// biome-ignore lint/suspicious/noExplicitAny: Strapi populate typing doesn't cover components in components
const EXAM_POPULATE: any = {
	sinif: { fields: ["slug", "title"] },
	ders: { fields: ["slug", "title"] },
	konular: { fields: ["slug", "ad"] },
	sorular: {
		populate: {
			gorsel: true,
			secenekler: { populate: { gorsel: true } },
			konu: { fields: ["slug", "ad"] },
		},
	},
	SEO: true,
};

const LESSON_CONTENT_LIMIT = 6000;
const PAGE_LIMIT = 100;

const adminUrl = (documentId: string) => {
	const base = String(strapi.config.get("server.url") || "").replace(/\/$/, "");
	return `${base}/admin/content-manager/collection-types/${UIDS.deneme}/${documentId}`;
};

const text = (value: unknown) =>
	typeof value === "string" ? value.trim() : "";
const lower = (s: string) => s.toLocaleLowerCase("tr-TR");

/** documentId → lesson ids linked to each topic, and lesson → topics, from the Konu side. */
async function topicLessonLinks() {
	const topics = await strapi.db.query(UIDS.konu).findMany({
		select: ["documentId", "ad", "slug"],
		populate: { dersVideolari: { select: ["documentId"] } },
	});
	const topicsOfLesson = new Map<string, { slug: string; ad: string }[]>();
	for (const t of topics) {
		for (const l of t.dersVideolari ?? []) {
			const list = topicsOfLesson.get(l.documentId) ?? [];
			if (!list.some((x) => x.slug === t.slug))
				list.push({ slug: t.slug, ad: t.ad });
			topicsOfLesson.set(l.documentId, list);
		}
	}
	return topicsOfLesson;
}

/** Published course(s) each lesson appears in, in course order. */
async function lessonCourses() {
	const links = await strapi.db.query(UIDS.courseLesson).findMany({
		select: ["order"],
		populate: {
			lesson: { select: ["documentId"] },
			course: { select: ["slug", "title", "publishedAt"] },
		},
	});
	const map = new Map<
		string,
		{ slug: string; title: string; sira: number | null }[]
	>();
	for (const link of links) {
		if (!link.lesson || !link.course) continue;
		const list = map.get(link.lesson.documentId) ?? [];
		if (!list.some((c) => c.slug === link.course.slug))
			list.push({
				slug: link.course.slug,
				title: link.course.title,
				sira: link.order ?? null,
			});
		map.set(link.lesson.documentId, list);
	}
	return map;
}

/** One row per lesson document: the published version if there is one, else the draft. */
async function lessonRows() {
	const rows = await strapi.db.query(UIDS.lesson).findMany({
		select: [
			"id",
			"documentId",
			"title",
			"slug",
			"description",
			"videoURL",
			"content",
			"publishedAt",
		],
		orderBy: { title: "asc" },
	});
	const byDocument = new Map<string, (typeof rows)[number]>();
	for (const row of rows) {
		const current = byDocument.get(row.documentId);
		if (!current || (!current.publishedAt && row.publishedAt))
			byDocument.set(row.documentId, row);
	}
	return [...byDocument.values()];
}

export default {
	/** Everything needed to write an exam: enums, subjects, grades, topics with their lessons. */
	// biome-ignore lint/suspicious/noExplicitAny: Koa context
	async catalog(ctx: any) {
		const [subjects, grades, topics, questions] = await Promise.all([
			strapi.db.query("api::subject.subject").findMany({
				select: ["documentId", "title", "slug", "publishedAt"],
				orderBy: { title: "asc" },
			}),
			strapi.db.query("api::grade.grade").findMany({
				select: ["documentId", "title", "slug", "publishedAt"],
				orderBy: { title: "asc" },
			}),
			strapi.db.query(UIDS.konu).findMany({
				select: ["documentId", "ad", "slug"],
				orderBy: { ad: "asc" },
				populate: {
					ders: { select: ["slug"] },
					siniflar: { select: ["slug"] },
					dersVideolari: {
						select: ["documentId", "title", "slug", "publishedAt"],
					},
				},
			}),
			// How many questions already use each topic, across all exam drafts.
			strapi.documents(UIDS.deneme).findMany({
				status: "draft",
				fields: ["documentId"],
				populate: {
					sorular: { populate: { konu: { fields: ["slug"] } } },
				} as never,
			}),
		]);
		const usage = new Map<string, number>();
		// biome-ignore lint/suspicious/noExplicitAny: populated component
		for (const exam of questions as any[])
			for (const q of exam.sorular ?? [])
				if (q.konu?.slug)
					usage.set(q.konu.slug, (usage.get(q.konu.slug) ?? 0) + 1);
		// Draft & publish types have one row per version; keep one per document.
		const unique = <
			T extends { documentId: string; publishedAt?: string | null },
		>(
			rows: T[],
		) => {
			const map = new Map<string, T>();
			for (const r of rows)
				if (!map.has(r.documentId) || r.publishedAt) map.set(r.documentId, r);
			return [...map.values()];
		};
		ctx.body = {
			sinavTurleri: EXAM_TYPES,
			zorluklar: DIFFICULTIES,
			sikHarfleri: ["A", "B", "C", "D", "E"],
			gorselSiniri: {
				maksimumBayt: MAX_UPLOAD_BYTES,
				bicimler: ["svg", "png", "jpeg", "webp"],
			},
			dersler: unique(subjects).map((s) => ({ slug: s.slug, title: s.title })),
			siniflar: unique(grades).map((g) => ({ slug: g.slug, title: g.title })),
			konular: topics.map((t) => ({
				slug: t.slug,
				ad: t.ad,
				ders: t.ders?.slug ?? null,
				siniflar: (t.siniflar ?? []).map((g: { slug: string }) => g.slug),
				soruSayisi: usage.get(t.slug) ?? 0,
				dersVideolari: unique(t.dersVideolari ?? []).map(
					(l: {
						documentId: string;
						title: string;
						slug: string;
						publishedAt: string | null;
					}) => ({
						documentId: l.documentId,
						title: l.title,
						slug: l.slug,
						yayinda: Boolean(l.publishedAt),
					}),
				),
			})),
		};
	},

	/**
	 * Lessons, filterable: ?q= (title/description), ?konu=<slug>, ?kurs=<course slug>,
	 * ?konusuz=1 (lessons not linked to any topic), ?icerik=1 (lesson text, truncated).
	 */
	// biome-ignore lint/suspicious/noExplicitAny: Koa context
	async lessons(ctx: any) {
		const q = lower(text(ctx.query.q));
		const topic = text(ctx.query.konu);
		const course = text(ctx.query.kurs);
		const withContent = ctx.query.icerik === "1" || ctx.query.icerik === "true";
		const untopiced = ctx.query.konusuz === "1" || ctx.query.konusuz === "true";
		const limit = Math.min(
			PAGE_LIMIT,
			Math.max(1, Number.parseInt(text(ctx.query.limit) || "50", 10) || 50),
		);
		const page = Math.max(
			1,
			Number.parseInt(text(ctx.query.sayfa) || "1", 10) || 1,
		);

		const [rows, topicsOfLesson, coursesOfLesson] = await Promise.all([
			lessonRows(),
			topicLessonLinks(),
			lessonCourses(),
		]);
		const filtered = rows.filter((l) => {
			const topics = topicsOfLesson.get(l.documentId) ?? [];
			const courses = coursesOfLesson.get(l.documentId) ?? [];
			if (topic && !topics.some((t) => t.slug === topic)) return false;
			if (course && !courses.some((c) => c.slug === course)) return false;
			if (untopiced && topics.length) return false;
			if (q && !lower(`${l.title ?? ""} ${l.description ?? ""}`).includes(q))
				return false;
			return true;
		});
		ctx.body = {
			toplam: filtered.length,
			sayfa: page,
			limit,
			dersler: filtered.slice((page - 1) * limit, page * limit).map((l) => ({
				documentId: l.documentId,
				title: l.title,
				slug: l.slug,
				aciklama: l.description ?? "",
				videoURL: l.videoURL ?? null,
				yayinda: Boolean(l.publishedAt),
				kurslar: coursesOfLesson.get(l.documentId) ?? [],
				konular: topicsOfLesson.get(l.documentId) ?? [],
				...(withContent
					? { icerik: blocksToText(l.content).slice(0, LESSON_CONTENT_LIMIT) }
					: {}),
			})),
		};
	},

	/** One lesson with its full text. */
	// biome-ignore lint/suspicious/noExplicitAny: Koa context
	async lesson(ctx: any) {
		const lesson = (await lessonRows()).find(
			(l) => l.documentId === ctx.params.documentId,
		);
		if (!lesson) return ctx.notFound("Ders bulunamadı");
		const [topicsOfLesson, coursesOfLesson] = await Promise.all([
			topicLessonLinks(),
			lessonCourses(),
		]);
		ctx.body = {
			documentId: lesson.documentId,
			title: lesson.title,
			slug: lesson.slug,
			aciklama: lesson.description ?? "",
			videoURL: lesson.videoURL ?? null,
			yayinda: Boolean(lesson.publishedAt),
			kurslar: coursesOfLesson.get(lesson.documentId) ?? [],
			konular: topicsOfLesson.get(lesson.documentId) ?? [],
			icerik: blocksToText(lesson.content),
		};
	},

	/** Every exam (drafts included), newest first. ?q= filters by title or slug. */
	// biome-ignore lint/suspicious/noExplicitAny: Koa context
	async exams(ctx: any) {
		const q = lower(text(ctx.query.q));
		const [drafts, published] = await Promise.all([
			strapi.documents(UIDS.deneme).findMany({
				status: "draft",
				sort: "updatedAt:desc",
				populate: EXAM_POPULATE,
			}),
			strapi
				.documents(UIDS.deneme)
				.findMany({ status: "published", fields: ["documentId"] }),
		]);
		const live = new Set(published.map((d) => d.documentId));
		ctx.body = {
			denemeler: (drafts as unknown[])
				// biome-ignore lint/suspicious/noExplicitAny: populated document
				.map((d: any) => ({
					documentId: d.documentId,
					baslik: d.baslik,
					slug: d.slug,
					sinavTuru: d.sinavTuru,
					sinif: d.sinif?.slug ?? null,
					ders: d.ders?.slug ?? null,
					konular: (d.konular ?? []).map((k: { slug: string }) => k.slug),
					soruSayisi: d.sorular?.length ?? 0,
					sureDakika: d.sureDakika,
					yayinda: live.has(d.documentId),
					guncellenme: d.updatedAt,
				}))
				.filter((d) => !q || lower(`${d.baslik} ${d.slug}`).includes(q)),
		};
	},

	/** One exam's draft, answer key and solutions included, in the format PUT accepts. */
	// biome-ignore lint/suspicious/noExplicitAny: Koa context
	async exam(ctx: any) {
		const { documentId } = ctx.params;
		const draft = await strapi
			.documents(UIDS.deneme)
			.findOne({ documentId, status: "draft", populate: EXAM_POPULATE });
		if (!draft) return ctx.notFound("Deneme bulunamadı");
		const published = await strapi
			.documents(UIDS.deneme)
			.findOne({ documentId, status: "published", fields: ["documentId"] });
		ctx.body = {
			...fromDocument({ ...draft, publishedAt: null }),
			yayinda: Boolean(published),
			adminUrl: adminUrl(documentId),
		};
	},

	/** Creates an exam as a draft. ?kontrol=1 only validates. */
	// biome-ignore lint/suspicious/noExplicitAny: Koa context
	async createExam(ctx: any) {
		const input = ctx.request.body as ExamInput;
		const { data, hatalar, uyarilar } = await toDocumentData(strapi, input);
		if (!data) {
			ctx.status = 400;
			ctx.body = { tamam: false, hatalar, uyarilar };
			return;
		}
		if (ctx.query.kontrol === "1") {
			ctx.body = {
				tamam: true,
				kontrol: true,
				slug: data.slug,
				soruSayisi: (data.sorular as unknown[]).length,
				uyarilar,
			};
			return;
		}
		const created = await strapi
			.documents(UIDS.deneme)
			.create({ data: data as never, status: "draft" } as never);
		strapi.log.info(
			`[soru-yazari] Draft exam created: ${created.documentId} (${data.slug})`,
		);
		ctx.status = 201;
		ctx.body = {
			tamam: true,
			documentId: created.documentId,
			slug: data.slug,
			soruSayisi: (data.sorular as unknown[]).length,
			durum: "taslak",
			adminUrl: adminUrl(created.documentId),
			uyarilar,
		};
	},

	/**
	 * Replaces an exam's draft with the given exam (send the whole exam, as GET returns it).
	 * The published version stays as it is until the teacher publishes the draft.
	 */
	// biome-ignore lint/suspicious/noExplicitAny: Koa context
	async updateExam(ctx: any) {
		const { documentId } = ctx.params;
		const existing = await strapi
			.documents(UIDS.deneme)
			.findOne({ documentId, status: "draft", fields: ["documentId"] });
		if (!existing) return ctx.notFound("Deneme bulunamadı");
		const input = ctx.request.body as ExamInput;
		const { data, hatalar, uyarilar } = await toDocumentData(strapi, input, {
			documentId,
		});
		if (!data) {
			ctx.status = 400;
			ctx.body = { tamam: false, hatalar, uyarilar };
			return;
		}
		if (ctx.query.kontrol === "1") {
			ctx.body = {
				tamam: true,
				kontrol: true,
				slug: data.slug,
				soruSayisi: (data.sorular as unknown[]).length,
				uyarilar,
			};
			return;
		}
		await strapi
			.documents(UIDS.deneme)
			.update({ documentId, data: data as never, status: "draft" } as never);
		strapi.log.info(
			`[soru-yazari] Draft exam updated: ${documentId} (${data.slug})`,
		);
		ctx.body = {
			tamam: true,
			documentId,
			slug: data.slug,
			soruSayisi: (data.sorular as unknown[]).length,
			durum: "taslak",
			adminUrl: adminUrl(documentId),
			uyarilar,
		};
	},

	/** multipart/form-data: `file` (SVG/PNG/JPEG/WebP), optional `alt`. Returns the media id. */
	// biome-ignore lint/suspicious/noExplicitAny: Koa context
	async uploadImage(ctx: any) {
		const files = ctx.request.files?.file;
		const file = Array.isArray(files) ? files[0] : files;
		if (!file)
			return ctx.badRequest(
				"`file` alanında bir görsel gönderin (multipart/form-data)",
			);
		const alt = text(ctx.request.body?.alt).slice(0, 300);
		if (!alt)
			return ctx.badRequest(
				"`alt` zorunlu: görselin ne gösterdiğini bir cümleyle yazın (erişilebilirlik)",
			);
		try {
			ctx.status = 201;
			ctx.body = await storeImage(strapi, file, alt);
		} catch (error) {
			return ctx.badRequest((error as Error).message);
		}
	},
};

/**
 * CSV'deki YouTube videolarını bir kursa ders (lesson) olarak yükler.
 *
 * Kullanım:
 *   STRAPI_URL=https://admin.ketalearn.cloud STRAPI_TOKEN=xxx \
 *     node --experimental-strip-types scripts/import-lessons.mts --course <kurs-slug> --csv dersler.csv [--draft] [--dry-run]
 *
 *   --course   Derslerin ekleneceği kursun slug'ı (kurs taslakta olabilir).
 *   --csv      CSV dosyası. Satır sırası = ders sırası.
 *   --draft    Dersleri taslak olarak oluşturur (varsayılan: yayınlanmış).
 *   --dry-run  Hiçbir şey yazmadan ne yapılacağını listeler.
 *
 * CSV sütunları (başlık satırı zorunlu, ayraç , veya ; olabilir):
 *   url, title             zorunlu
 *   description            opsiyonel (boşsa başlık kullanılır)
 *   metaTitle, metaDescription, keywords
 *                          opsiyonel; boş olanlar başlık ve kurs adından üretilir
 *
 * Akış (her satır için):
 *   1. Ders slug'ı "<kurs-slug>-<başlık-slug>" olarak üretilir.
 *   2. Bu slug kursa zaten bağlıysa satır atlanır (script tekrar çalıştırılabilir).
 *   3. Aynı slug'lı ders varsa yenisi oluşturulmaz, o ders kursa bağlanır.
 *   4. Başlık başka bir derste kullanılıyorsa sonuna " (Kurs Adı)" eklenir.
 *   5. POST /api/lessons (SEO ile) → POST /api/course-lessons (sıra ile).
 *
 * Token izinleri (Settings → API Tokens → Custom):
 *   Course: find · Lesson: find, create · Course-lesson: find, create
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const SITE_NAME = "KetaLearn";

const { values: args } = parseArgs({
	options: {
		course: { type: "string" },
		csv: { type: "string" },
		draft: { type: "boolean", default: false },
		"dry-run": { type: "boolean", default: false },
	},
});

const STRAPI_URL = process.env.STRAPI_URL?.replace(/\/$/, "");
const TOKEN = process.env.STRAPI_TOKEN;
if (!STRAPI_URL || !TOKEN || !args.course || !args.csv) {
	console.error(
		"Kullanım: STRAPI_URL=... STRAPI_TOKEN=... node --experimental-strip-types scripts/import-lessons.mts --course <slug> --csv <dosya> [--draft] [--dry-run]",
	);
	process.exit(1);
}
const dryRun = args["dry-run"];

// ─── Strapi REST yardımcıları ────────────────────────────────────────────────

async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
	const res = await fetch(`${STRAPI_URL}/api/${path}`, {
		method: init.method ?? "GET",
		headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
		body: init.body === undefined ? undefined : JSON.stringify(init.body),
	});
	if (!res.ok) {
		throw new Error(`${init.method ?? "GET"} /api/${path} → ${res.status} ${await res.text()}`);
	}
	return (await res.json()) as T;
}

type Doc = { documentId: string };
const q = encodeURIComponent;

// status=draft: yayınlanmamış kayıtları da bulur (her yayınlanmış kaydın bir taslağı vardır).
async function findOne<T extends Doc>(collection: string, field: string, value: string) {
	const res = await api<{ data: T[] }>(
		`${collection}?filters[${field}][$eq]=${q(value)}&status=draft&pagination[pageSize]=1`,
	);
	return res.data[0];
}

// ─── Metin yardımcıları ──────────────────────────────────────────────────────

function slugify(text: string): string {
	const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" };
	return text
		.toLocaleLowerCase("tr-TR")
		.replace(/[çğıöşü]/g, (c) => map[c])
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/** Metni kelime sınırından keser. */
function truncate(text: string, max: number): string {
	const clean = text.replace(/\s+/g, " ").trim();
	if (clean.length <= max) return clean;
	const cut = clean.slice(0, max - 1);
	return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max / 2)).trim()}…`;
}

function buildSEO(row: Row, title: string, courseTitle: string) {
	const withSite = `${title} | ${courseTitle} | ${SITE_NAME}`;
	const metaTitle =
		row.metaTitle || (withSite.length <= 60 ? withSite : truncate(`${title} | ${SITE_NAME}`, 60));
	const metaDescription = truncate(
		row.metaDescription ||
			row.description ||
			`${courseTitle} kursunda "${title}" dersini ücretsiz izle, ilerlemeni takip et ve quizlerle pekiştir.`,
		155,
	);
	const keywords = row.keywords || [title, courseTitle, SITE_NAME, "ders videosu", "ücretsiz ders"].join(", ");
	return { metaTitle, metaDescription, keywords };
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

type Row = {
	line: number;
	url: string;
	title: string;
	description?: string;
	metaTitle?: string;
	metaDescription?: string;
	keywords?: string;
};

/** Tırnaklı alanları, alan içi satır sonlarını ve , / ; ayraçlarını destekler. */
function parseCSV(text: string): string[][] {
	const src = text.replace(/^﻿/, "");
	const firstLine = src.slice(0, src.indexOf("\n") >>> 0);
	const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;
	for (let i = 0; i < src.length; i++) {
		const c = src[i];
		if (quoted) {
			if (c === '"' && src[i + 1] === '"') {
				field += '"';
				i++;
			} else if (c === '"') quoted = false;
			else field += c;
		} else if (c === '"') quoted = true;
		else if (c === sep) {
			row.push(field);
			field = "";
		} else if (c === "\n" || c === "\r") {
			if (c === "\r" && src[i + 1] === "\n") i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
		} else field += c;
	}
	if (field || row.length) {
		row.push(field);
		rows.push(row);
	}
	return rows.filter((r) => r.some((cell) => cell.trim()));
}

function readRows(text: string): Row[] {
	const [header, ...lines] = parseCSV(text);
	const aliases: Record<string, keyof Row> = {
		url: "url",
		videourl: "url",
		link: "url",
		title: "title",
		baslik: "title",
		description: "description",
		aciklama: "description",
		metatitle: "metaTitle",
		metadescription: "metaDescription",
		keywords: "keywords",
	};
	const columns = header.map((h) => aliases[slugify(h).replace(/-/g, "")]);
	if (!columns.includes("url") || !columns.includes("title")) {
		throw new Error(`CSV başlığında "url" ve "title" sütunları olmalı. Bulunan: ${header.join(", ")}`);
	}
	return lines.map((cells, index) => {
		const row = { line: index + 2 } as Row;
		columns.forEach((key, i) => {
			const value = cells[i]?.trim();
			if (key && value) (row[key] as string) = value;
		});
		return row;
	});
}

// ─── Ana akış ────────────────────────────────────────────────────────────────

const rows = readRows(await readFile(args.csv, "utf8"));

const course = await findOne<Doc & { title: string; slug: string }>("courses", "slug", args.course);
if (!course) throw new Error(`"${args.course}" slug'ına sahip kurs bulunamadı`);
console.log(`📚 Kurs: ${course.title} (${course.documentId})\n`);

// Kursa bağlı mevcut dersler ve son sıra numarası
const linked = new Set<string>();
let order = 0;
for (let page = 1; ; page++) {
	const res = await api<{
		data: { order: number; lesson: { slug: string } | null }[];
		meta: { pagination: { pageCount: number } };
	}>(
		`course-lessons?filters[course][documentId][$eq]=${course.documentId}` +
			`&populate[lesson][fields][0]=slug` +
			`&pagination[page]=${page}&pagination[pageSize]=100`,
	);
	for (const link of res.data) {
		order = Math.max(order, link.order ?? 0);
		if (link.lesson?.slug) linked.add(link.lesson.slug);
	}
	if (page >= res.meta.pagination.pageCount) break;
}

const stats = { created: 0, reused: 0, skipped: 0, failed: 0 };
for (const row of rows) {
	const label = `#${row.line} ${row.title ?? "(başlıksız)"}`;
	try {
		if (!row.url || !row.title) throw new Error("url ve title zorunlu");

		const slug = `${slugify(course.slug)}-${slugify(row.title)}`;
		if (linked.has(slug)) {
			stats.skipped++;
			console.log(`⏭  ${label}: zaten bu kursta`);
			continue;
		}

		let lesson = await findOne<Doc>("lessons", "slug", slug);
		if (lesson) {
			// Taslak dersler yukarıdaki listede görünmeyebilir; bağlantıyı doğrudan kontrol et.
			const link = await api<{ data: unknown[] }>(
				`course-lessons?filters[course][documentId][$eq]=${course.documentId}` +
					`&filters[lesson][documentId][$eq]=${lesson.documentId}&pagination[pageSize]=1`,
			);
			if (link.data.length) {
				stats.skipped++;
				linked.add(slug);
				console.log(`⏭  ${label}: zaten bu kursta`);
				continue;
			}
			stats.reused++;
			console.log(`🔗 ${label}: mevcut ders bağlanıyor`);
		} else {
			const titleTaken = await findOne<Doc>("lessons", "title", row.title);
			const title = titleTaken ? `${row.title} (${course.title})` : row.title;
			const data = {
				title,
				slug,
				description: row.description || row.title,
				videoURL: row.url,
				// SEO metinlerinde kurs eki olmadan orijinal başlık kullanılır.
				SEO: buildSEO(row, row.title, course.title),
			};
			if (dryRun) {
				console.log(`🧪 ${label}: oluşturulacak →`, JSON.stringify(data));
				lesson = { documentId: "(dry-run)" };
			} else {
				lesson = (
					await api<{ data: Doc }>(`lessons${args.draft ? "?status=draft" : ""}`, {
						method: "POST",
						body: { data },
					})
				).data;
				console.log(`✅ ${label}: ders oluşturuldu${title !== row.title ? ` ("${title}")` : ""}`);
			}
			stats.created++;
		}

		order = order + 10;
		if (!dryRun) {
			await api("course-lessons", {
				method: "POST",
				body: { data: { course: course.documentId, lesson: lesson.documentId, order } },
			});
		}
		linked.add(slug);
	} catch (error) {
		stats.failed++;
		console.error(`❌ ${label}: ${(error as Error).message}`);
	}
}

console.log(
	`\n${dryRun ? "[dry-run] " : ""}Bitti: ${stats.created} oluşturuldu, ${stats.reused} mevcut ders bağlandı, ` +
		`${stats.skipped} atlandı, ${stats.failed} hata.`,
);
if (stats.failed) process.exitCode = 1;

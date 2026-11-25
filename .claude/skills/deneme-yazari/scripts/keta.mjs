#!/usr/bin/env node
/**
 * KetaLearn question-writer CLI: talks to the Strapi "soru-yazari" API.
 * No dependencies (Node 18+). Run `node keta.mjs yardim` for the commands.
 *
 * Settings (a variable already set in the shell wins over the file):
 *   KETA_API_URL        Strapi root address, without /api (default http://localhost:1337)
 *   SORU_YAZARI_TOKEN   the API token (same value as on the server)
 * They are also read from an env file: --env <file>, else KETA_ENV_FILE, else ENV_PATH
 * (the variable Strapi itself uses to start with another file), else ./.env.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, extname, isAbsolute, resolve } from "node:path";

const { positional, flags } = parseArgs(process.argv.slice(2));

/** KEY=VALUE lines of a .env file (comments, `export` and quotes handled). */
function readEnvFile(path) {
	const values = {};
	for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
		const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
			line,
		);
		if (!match) continue;
		let value = match[2].trim();
		const quoted = /^(["'])(.*)\1$/.exec(value);
		value = quoted ? quoted[2] : value.replace(/\s+#.*$/, "");
		values[match[1]] = value;
	}
	return values;
}

const ENV_FILE = (() => {
	const explicit =
		typeof flags.env === "string"
			? flags.env
			: process.env.KETA_ENV_FILE || process.env.ENV_PATH;
	if (explicit) {
		const path = resolve(explicit);
		if (!existsSync(path)) {
			console.error(`Hata: env dosyası bulunamadı: ${path}`);
			process.exit(1);
		}
		return path;
	}
	const local = resolve(".env");
	return existsSync(local) ? local : null;
})();
const fileEnv = ENV_FILE ? readEnvFile(ENV_FILE) : {};
const setting = (name) => process.env[name] || fileEnv[name] || "";
const source = (name) =>
	process.env[name] ? "terminal" : fileEnv[name] ? ENV_FILE : "yok";

const API = (setting("KETA_API_URL") || "http://localhost:1337")
	.replace(/\/+$/, "")
	.replace(/\/api$/, "");
const TOKEN = setting("SORU_YAZARI_TOKEN").trim();

const HELP = `KetaLearn soru yazarı

Ayarlar
  ayarlar                                                 Kullanılan adres, token ve env dosyası; sunucuya bağlantıyı dener
  --env <dosya> (her komutta)                             Ayarları bu env dosyasından oku (varsayılan ./.env)

Okuma
  katalog [--ders <slug>] [--sinif <slug>] [--q <metin>]   Sınav türleri, dersler, sınıflar, konular (+ bağlı ders videoları)
  dersler [--q <metin>] [--konu <slug>] [--kurs <slug>] [--konusuz] [--icerik] [--sayfa N] [--limit N]
  ders <documentId>                                       Bir dersin tüm metni
  denemeler [--q <metin>]                                 Mevcut denemeler (taslaklar dahil)
  deneme <documentId> [--cikti <dosya.json>]              Bir denemenin tamamı (cevap ve çözümlerle), düzenlenebilir biçimde

Görseller
  onizle <dosya.svg> [--cikti <dosya.png>]                SVG'yi yerelde PNG'ye çevirir (kontrol için)
  gorsel <dosya> --alt "<açıklama>"                       Tek görsel yükler, medya id'si döner

Yazma (her zaman TASLAK; yayınlama admin panelinde, hocada)
  kontrol <deneme.json>                                   Kaydetmeden doğrular (görselleri yüklemez)
  gonder <deneme.json>                                    Görselleri yükler, denemeyi taslak olarak oluşturur
                                                          ya da dosyada documentId varsa taslağı günceller

deneme.json içinde "gorsel" alanı bir medya id'si, bir dosya yolu ya da
{ "dosya": "yol.svg", "alt": "açıklama" } olabilir. Dosya yolları JSON dosyasına göredir;
yüklenen görseller <deneme>.gorseller.json içinde saklanır, aynı dosya ikinci kez yüklenmez.`;

// ── Arguments ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
	const positional = [];
	const flags = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg.startsWith("--")) {
			const key = arg.slice(2);
			const next = argv[i + 1];
			if (next === undefined || next.startsWith("--")) flags[key] = true;
			else {
				flags[key] = next;
				i++;
			}
		} else positional.push(arg);
	}
	return { positional, flags };
}

function die(message, extra) {
	console.error(`Hata: ${message}`);
	if (extra)
		console.error(
			typeof extra === "string" ? extra : JSON.stringify(extra, null, 2),
		);
	process.exit(1);
}

const print = (value) => console.log(JSON.stringify(value, null, 2));

// ── HTTP ─────────────────────────────────────────────────────────────────────
async function call(method, path, { json, form, query } = {}) {
	if (!TOKEN)
		die(
			`SORU_YAZARI_TOKEN bulunamadı: terminalde yok, ${ENV_FILE ? `${ENV_FILE} içinde de yok` : ".env dosyası da yok"}. "ayarlar" komutuyla kontrol edin.`,
		);
	const url = new URL(`${API}/api/soru-yazari${path}`);
	for (const [k, v] of Object.entries(query ?? {}))
		if (v !== undefined && v !== false)
			url.searchParams.set(k, v === true ? "1" : String(v));
	const headers = { "x-soru-yazari-token": TOKEN };
	let body;
	if (json !== undefined) {
		headers["content-type"] = "application/json";
		body = JSON.stringify(json);
	} else if (form) body = form;
	let response;
	try {
		response = await fetch(url, { method, headers, body });
	} catch (error) {
		die(
			`${url.host} adresine bağlanılamadı: ${error.cause?.message ?? error.message}`,
		);
	}
	const text = await response.text();
	let data;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = text;
	}
	if (response.status === 403)
		die(
			`Yetki yok (403): ${API} adresindeki sunucu token'ı kabul etmedi. Token sunucuyu başlattığınız env dosyasındakiyle aynı olmalı; sunucu SORU_YAZARI_TOKEN olmadan ya da eski değerle başlatıldıysa yeniden başlatın. "ayarlar" komutu hangi değerin kullanıldığını gösterir.`,
		);
	return { ok: response.ok, status: response.status, data };
}

async function get(path, query) {
	const { ok, status, data } = await call("GET", path, { query });
	if (!ok) die(`HTTP ${status}`, data?.error?.message ?? data);
	return data;
}

// ── Images ───────────────────────────────────────────────────────────────────
const MIME = {
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
};

async function uploadImage(path, alt) {
	if (!existsSync(path)) die(`Görsel bulunamadı: ${path}`);
	const type = MIME[extname(path).toLowerCase()];
	if (!type)
		die(`Desteklenmeyen görsel uzantısı: ${path} (svg, png, jpg, webp)`);
	const form = new FormData();
	form.set("file", new Blob([await readFile(path)], { type }), basename(path));
	form.set("alt", alt);
	const { ok, status, data } = await call("POST", "/gorseller", { form });
	if (!ok)
		die(
			`Görsel yüklenemedi (${path}): HTTP ${status}`,
			data?.error?.message ?? data,
		);
	return data;
}

/** Loads an optional package from the current project or the global modules (CommonJS lookup honours NODE_PATH). */
function optional(name) {
	for (const base of [`${process.cwd()}/`, import.meta.url]) {
		try {
			return createRequire(base)(name);
		} catch {}
	}
	return null;
}

/** SVG → PNG locally, with whatever is installed: sharp, rsvg-convert, Playwright or ImageMagick. */
async function preview(svgPath, outPath) {
	if (!existsSync(svgPath)) die(`Dosya bulunamadı: ${svgPath}`);
	const out = outPath || `${svgPath.replace(/\.svg$/i, "")}.onizleme.png`;
	const sharp = optional("sharp");
	if (sharp) {
		await sharp(await readFile(svgPath), { density: 192 })
			.flatten({ background: "#ffffff" })
			.png()
			.toFile(out);
		return out;
	}
	const tryRun = (cmd, args) =>
		spawnSync(cmd, args, { stdio: "pipe" }).status === 0;
	if (tryRun("rsvg-convert", ["-z", "2", "-b", "white", "-o", out, svgPath]))
		return out;
	const playwright = optional("playwright");
	if (playwright) {
		const browser = await playwright.chromium.launch();
		try {
			const page = await browser.newPage({ deviceScaleFactor: 2 });
			await page.setContent(
				`<html><body style="margin:0;background:#fff">${await readFile(svgPath, "utf8")}</body></html>`,
			);
			await (await page.$("svg")).screenshot({ path: out });
			return out;
		} finally {
			await browser.close();
		}
	}
	if (
		tryRun("magick", ["-density", "192", "-background", "white", svgPath, out])
	)
		return out;
	die(
		"SVG'yi PNG'ye çevirecek araç yok (sharp, rsvg-convert, Playwright ya da ImageMagick). Sunucu yüklemede zaten çevirir; önizlemeyi atlamadan önce kullanıcıya söyle.",
	);
}

/**
 * Replaces image paths in an exam with media ids, uploading each file once.
 * The cache maps file hash → media, so re-running after an edit uploads only changed images.
 */
async function resolveImages(exam, baseDir, cachePath) {
	const cache = existsSync(cachePath)
		? JSON.parse(await readFile(cachePath, "utf8"))
		: {};
	let uploaded = 0;
	const resolveOne = async (value, defaultAlt) => {
		if (value == null || typeof value === "number") return value ?? null;
		const spec = typeof value === "string" ? { dosya: value } : value;
		if (!spec.dosya) die(`Geçersiz görsel alanı: ${JSON.stringify(value)}`);
		const path = isAbsolute(spec.dosya)
			? spec.dosya
			: resolve(baseDir, spec.dosya);
		if (!existsSync(path)) die(`Görsel bulunamadı: ${path}`);
		const alt = (spec.alt || defaultAlt).trim();
		const hash = createHash("sha256")
			.update(await readFile(path))
			.update(alt)
			.digest("hex")
			.slice(0, 16);
		if (!cache[hash]) {
			cache[hash] = { ...(await uploadImage(path, alt)), dosya: spec.dosya };
			uploaded++;
			await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
		}
		return cache[hash].id;
	};
	const sorular = [];
	for (const [i, q] of (exam.sorular ?? []).entries()) {
		const no = i + 1;
		const secenekler = [];
		for (const [j, o] of (q.secenekler ?? []).entries()) {
			secenekler.push({
				...o,
				gorsel: await resolveOne(
					o?.gorsel,
					`${no}. soru, ${"ABCDE"[j]} şıkkının görseli`,
				),
			});
		}
		sorular.push({
			...q,
			gorsel: await resolveOne(q.gorsel, `${no}. sorunun görseli`),
			secenekler,
		});
	}
	return { exam: { ...exam, sorular }, uploaded };
}

/** Image paths in an exam that don't exist, for `kontrol` (which doesn't upload). */
function missingImages(exam, baseDir) {
	const missing = [];
	const check = (value, where) => {
		if (value == null || typeof value === "number") return;
		const file = typeof value === "string" ? value : value.dosya;
		const path = isAbsolute(file ?? "") ? file : resolve(baseDir, file ?? "");
		if (!file || !existsSync(path))
			missing.push({ yol: where, hata: `Görsel dosyası yok: ${file}` });
	};
	(exam.sorular ?? []).forEach((q, i) => {
		check(q.gorsel, `sorular[${i}].gorsel`);
		for (const [j, o] of (q.secenekler ?? []).entries()) {
			check(o?.gorsel, `sorular[${i}].secenekler[${j}].gorsel`);
		}
	});
	return missing;
}

/** For validation without uploading: a stand-in id that the server will reject only as "missing". */
function withoutLocalImages(exam) {
	const strip = (v) => (typeof v === "number" ? v : null);
	return {
		...exam,
		sorular: (exam.sorular ?? []).map((q) => ({
			...q,
			gorsel: strip(q.gorsel),
			secenekler: (q.secenekler ?? []).map((o, j) => ({
				...o,
				gorsel: strip(o?.gorsel),
				// A local image counts as content for the "option needs text or image" rule.
				// Lettered so image-only options aren't reported as duplicates of each other.
				metin:
					o?.metin ||
					(o?.gorsel != null && typeof o.gorsel !== "number"
						? `(${"ABCDE"[j]} şıkkının görseli)`
						: o?.metin),
			})),
		})),
	};
}

async function readExam(file) {
	if (!file) die("deneme.json dosyasını verin");
	try {
		return JSON.parse(await readFile(file, "utf8"));
	} catch (error) {
		die(`${file} okunamadı: ${error.message}`);
	}
}

function report(result) {
	const { ok, status, data } = result;
	if (data?.uyarilar?.length) {
		console.error("Uyarılar:");
		for (const u of data.uyarilar) console.error(`  - ${u.yol}: ${u.hata}`);
	}
	if (!ok) {
		if (data?.hatalar?.length) {
			console.error("Hatalar:");
			for (const h of data.hatalar) console.error(`  - ${h.yol}: ${h.hata}`);
			process.exit(1);
		}
		die(`HTTP ${status}`, data?.error?.message ?? data);
	}
	print(data);
}

// ── Commands ─────────────────────────────────────────────────────────────────
const [command, ...rest] = positional;

switch (command) {
	case "katalog": {
		const data = await get("/katalog");
		const q =
			typeof flags.q === "string" ? flags.q.toLocaleLowerCase("tr-TR") : "";
		data.konular = data.konular.filter(
			(k) =>
				(!flags.ders || k.ders === flags.ders) &&
				(!flags.sinif || k.siniflar.includes(flags.sinif)) &&
				(!q || `${k.ad} ${k.slug}`.toLocaleLowerCase("tr-TR").includes(q)),
		);
		print(data);
		break;
	}
	case "dersler":
		print(
			await get("/dersler", {
				q: flags.q,
				konu: flags.konu,
				kurs: flags.kurs,
				konusuz: flags.konusuz,
				icerik: flags.icerik,
				sayfa: flags.sayfa,
				limit: flags.limit,
			}),
		);
		break;
	case "ders":
		if (!rest[0]) die("documentId verin");
		print(await get(`/dersler/${encodeURIComponent(rest[0])}`));
		break;
	case "denemeler":
		print(await get("/denemeler", { q: flags.q }));
		break;
	case "deneme": {
		if (!rest[0]) die("documentId verin");
		const data = await get(`/denemeler/${encodeURIComponent(rest[0])}`);
		if (typeof flags.cikti === "string") {
			// Editable copy: drop read-only fields the API ignores anyway.
			const { durum, yayinda, adminUrl, ...exam } = data;
			exam.sorular = exam.sorular.map(({ no, gorselBilgi, ...q }) => ({
				...q,
				secenekler: q.secenekler.map(({ gorselBilgi: _, ...o }) => o),
			}));
			await writeFile(flags.cikti, `${JSON.stringify(exam, null, 2)}\n`);
			console.error(
				`Yazıldı: ${flags.cikti} (${yayinda ? "yayında olan denemenin taslağı" : "taslak"})`,
			);
		} else print(data);
		break;
	}
	case "onizle": {
		if (!rest[0]) die("SVG dosyasını verin");
		console.log(
			await preview(
				rest[0],
				typeof flags.cikti === "string" ? flags.cikti : undefined,
			),
		);
		break;
	}
	case "gorsel": {
		if (!rest[0]) die("Görsel dosyasını verin");
		if (typeof flags.alt !== "string" || !flags.alt.trim())
			die('--alt "<görselin açıklaması>" zorunlu');
		print(await uploadImage(rest[0], flags.alt));
		break;
	}
	case "kontrol": {
		const exam = await readExam(rest[0]);
		const missing = missingImages(exam, dirname(resolve(rest[0])));
		if (missing.length) {
			console.error("Hatalar:");
			for (const h of missing) console.error(`  - ${h.yol}: ${h.hata}`);
			process.exit(1);
		}
		const body = withoutLocalImages(exam);
		const path = exam.documentId
			? `/denemeler/${encodeURIComponent(exam.documentId)}`
			: "/denemeler";
		report(
			await call(exam.documentId ? "PUT" : "POST", path, {
				json: body,
				query: { kontrol: true },
			}),
		);
		break;
	}
	case "gonder": {
		const file = rest[0];
		const exam = await readExam(file);
		const full = resolve(file);
		const cachePath = full.replace(/\.json$/i, "") + ".gorseller.json";
		// Validate first, so a broken exam doesn't upload images for nothing.
		const missing = missingImages(exam, dirname(full));
		if (missing.length) {
			console.error("Hatalar:");
			for (const h of missing) console.error(`  - ${h.yol}: ${h.hata}`);
			process.exit(1);
		}
		const path = exam.documentId
			? `/denemeler/${encodeURIComponent(exam.documentId)}`
			: "/denemeler";
		const method = exam.documentId ? "PUT" : "POST";
		const check = await call(method, path, {
			json: withoutLocalImages(exam),
			query: { kontrol: true },
		});
		if (!check.ok) report(check);
		const { exam: resolved, uploaded } = await resolveImages(
			exam,
			dirname(full),
			cachePath,
		);
		if (uploaded) console.error(`${uploaded} görsel yüklendi`);
		const result = await call(method, path, { json: resolved });
		if (result.ok && !exam.documentId && result.data?.documentId) {
			// Remember the id so the next `gonder` updates this draft instead of creating another.
			await writeFile(
				full,
				`${JSON.stringify({ documentId: result.data.documentId, ...exam }, null, 2)}\n`,
			);
			console.error(
				`documentId ${file} dosyasına yazıldı; sonraki gonder bu taslağı günceller`,
			);
		}
		report(result);
		break;
	}
	case "ayarlar": {
		const masked = TOKEN
			? `${TOKEN.slice(0, 4)}…${TOKEN.slice(-4)} (${TOKEN.length} karakter)`
			: "yok";
		console.log(`Env dosyası:        ${ENV_FILE ?? "yok"}`);
		console.log(
			`KETA_API_URL:       ${API}  (kaynak: ${setting("KETA_API_URL") ? source("KETA_API_URL") : "varsayılan"})`,
		);
		console.log(
			`SORU_YAZARI_TOKEN:  ${masked}  (kaynak: ${source("SORU_YAZARI_TOKEN")})`,
		);
		if (!TOKEN)
			die("Token yok: terminalde tanımlayın ya da env dosyasına yazın");
		const { ok, status } = await call("GET", "/katalog");
		if (!ok) die(`Sunucu HTTP ${status} döndü`);
		console.log(`Bağlantı:           tamam (${API}/api/soru-yazari/katalog)`);
		break;
	}
	case undefined:
	case "yardim":
	case "help":
	case "--help":
		console.log(HELP);
		break;
	default:
		die(`Bilinmeyen komut: ${command}`, HELP);
}

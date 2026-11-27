import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Core } from "@strapi/strapi";

/**
 * Question images from the agent. Anything sharp can read (SVG, PNG, JPEG, WebP) is stored as
 * PNG or JPEG, because the report PDF (pdfkit) can only draw those two. SVG is rasterised at
 * twice its size so lines and text stay sharp; very large images are scaled down.
 */

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Longest side of a stored image; enough for a full-width question figure on a retina screen. */
const MAX_SIDE = 1600;
/** SVG rasterisation density (96 dpi = 1×). */
const SVG_DENSITY = 192;

type IncomingFile = {
	filepath: string;
	originalFilename?: string | null;
	mimetype?: string | null;
	size: number;
};

type SharpFn = typeof import("sharp").default;

// sharp comes with Strapi's upload plugin; loaded lazily so the rest of the app doesn't need it.
async function loadSharp(): Promise<SharpFn> {
	try {
		const mod = await import("sharp");
		return (mod as unknown as { default?: SharpFn }).default ?? (mod as unknown as SharpFn);
	} catch {
		throw new Error("Görsel dönüştürücü (sharp) yüklü değil");
	}
}

export async function storeImage(strapi: Core.Strapi, file: IncomingFile, alt: string) {
	if (file.size > MAX_UPLOAD_BYTES)
		throw new Error(`Görsel en fazla ${MAX_UPLOAD_BYTES / 1024 / 1024} MB olabilir`);
	const sharp = await loadSharp();
	const input = await readFile(file.filepath);

	const isSvg =
		/\.svg$/i.test(file.originalFilename ?? "") ||
		/svg/.test(file.mimetype ?? "") ||
		/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(input.subarray(0, 512).toString("utf8"));
	let image = isSvg ? sharp(input, { density: SVG_DENSITY }) : sharp(input);
	let meta: Awaited<ReturnType<typeof image.metadata>>;
	try {
		meta = await image.metadata();
	} catch {
		throw new Error("Dosya okunamadı: SVG, PNG, JPEG veya WebP gönderin");
	}
	if (!meta.format || !["svg", "png", "jpeg", "webp"].includes(meta.format)) {
		throw new Error(
			`Desteklenmeyen biçim (${meta.format ?? "bilinmiyor"}): SVG, PNG, JPEG veya WebP gönderin`,
		);
	}

	image = image.resize({
		width: MAX_SIDE,
		height: MAX_SIDE,
		fit: "inside",
		withoutEnlargement: true,
	});
	const asJpeg = meta.format === "jpeg";
	// SVGs usually have a transparent background; flatten them on white so they read on any page.
	const output = asJpeg
		? await image.jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true })
		: await (isSvg ? image.flatten({ background: "#ffffff" }) : image)
				.png({ compressionLevel: 9 })
				.toBuffer({ resolveWithObject: true });

	const ext = asJpeg ? "jpg" : "png";
	const base =
		(file.originalFilename ?? "soru-gorseli")
			.replace(/\.[a-z0-9]+$/i, "")
			.replace(/[^\w.-]+/g, "-")
			.slice(0, 60) || "soru-gorseli";
	const dir = await mkdtemp(join(tmpdir(), "soru-yazari-"));
	const path = join(dir, `${base}.${ext}`);
	try {
		await writeFile(path, output.data);
		const uploaded = await strapi
			.plugin("upload")
			.service("upload")
			.upload({
				data: {
					fileInfo: {
						name: `${base}.${ext}`,
						alternativeText: alt || null,
						caption: null,
					},
				},
				files: {
					filepath: path,
					originalFilename: `${base}.${ext}`,
					mimetype: asJpeg ? "image/jpeg" : "image/png",
					size: output.data.length,
				},
			});
		const stored = Array.isArray(uploaded) ? uploaded[0] : uploaded;
		return {
			id: stored.id as number,
			url: stored.url as string,
			alt: (stored.alternativeText as string | null) ?? "",
			width: output.info.width,
			height: output.info.height,
			bicim: ext,
		};
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

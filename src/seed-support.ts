import type { Core, UID } from "@strapi/strapi";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const blocks = (text: string) => [{ type: "paragraph", children: [{ type: "text", text }] }];

/**
 * Deterministic PRNG: every run produces the same titles, so re-seeding finds
 * the rows it created before instead of adding new ones.
 */
export function createRandom(seed: number) {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 0x100000000;
	};
}

export function createSeedKit(strapi: Core.Strapi) {
	async function seed(uid: UID.ContentType, match: Record<string, unknown>, data: Record<string, unknown>) {
		const documents = strapi.documents(uid);
		const published = strapi.contentTypes[uid].options?.draftAndPublish;
		const options = published ? { status: "published" as const } : {};
		if (strapi.contentTypes[uid].kind === "singleType") {
			const existing = await documents.findFirst();
			if (!existing) return documents.create({ data, ...options });
			// `findFirst` matches the draft, which REST never serves: a single type
			// that was only saved in the admin still answers 404 until published.
			if (published && !(await documents.findFirst({ status: "published" }))) {
				await documents.publish({ documentId: existing.documentId });
			}
			return existing;
		}
		const existing = await documents.findFirst({ filters: match });
		return existing ?? documents.create({ data, ...options });
	}

	const upload = async (name: string, mime: string, bytes: Buffer) => {
		const existing = await strapi.db.query("plugin::upload.file").findOne({ where: { name } });
		if (existing) return existing.id;
		const directory = await mkdtemp(join(tmpdir(), "keta-seed-"));
		try {
			const filepath = join(directory, name);
			await writeFile(filepath, bytes);
			const [file] = await strapi.plugin("upload").service("upload").upload({
				data: { fileInfo: { name, alternativeText: "KetaLearn demo" } },
				files: { filepath, originalFilename: name, mimetype: mime, size: bytes.length },
			});
			return file.id;
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	};

	return { seed, upload };
}

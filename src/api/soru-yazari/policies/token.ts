import { timingSafeEqual } from "node:crypto";
import type { Core } from "@strapi/strapi";

/** Shortest token accepted, so a weak value can't switch the API on. */
const MIN_TOKEN_LENGTH = 32;

/**
 * Allows the request only with `x-soru-yazari-token: <SORU_YAZARI_TOKEN>` (403 otherwise).
 * Without the variable, or with a value shorter than 32 characters, the API is off.
 */
type PolicyContext = {
	request: { header: Record<string, string | string[] | undefined> };
};

export default (ctx: PolicyContext, _config: unknown, { strapi }: { strapi: Core.Strapi }) => {
	const expected = (process.env.SORU_YAZARI_TOKEN || "").trim();
	if (expected.length < MIN_TOKEN_LENGTH) {
		strapi.log.warn(
			"[soru-yazari] SORU_YAZARI_TOKEN is missing or shorter than 32 characters: API is off",
		);
		return false;
	}
	const given = Buffer.from(String(ctx.request.header["x-soru-yazari-token"] ?? ""));
	const wanted = Buffer.from(expected);
	return given.length === wanted.length && timingSafeEqual(given, wanted);
};

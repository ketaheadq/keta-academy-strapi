import { createHash } from "node:crypto";
import type { Core } from "@strapi/strapi";
import { verify } from "jsonwebtoken";

export async function migrateQuizProgress(strapi: Core.Strapi) {
	const progress = strapi.db.query("api::quiz-progress.quiz-progress");
	const rows = await progress.findMany({ where: { user_plus_quiz_id: { $startsWith: "eyJ" } } });

	for (const row of rows) {
		const key = row.user_plus_quiz_id;
		const match = /^([\w-]+\.[\w-]+\.[\w-]+)_(\d+)$/.exec(key);
		if (!match) continue;
		const [, token, quizId] = match;
		const data = { user_plus_quiz_id: `legacy_${createHash("sha256").update(key).digest("hex")}` };
		let learnerId: number | undefined;
		if (process.env.JWT_SECRET) {
			try {
				const claims = verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
				if (typeof claims !== "string" && Number.isSafeInteger(claims.id)) learnerId = claims.id;
			} catch {
				// Keep the historical score while removing the token from the key.
			}
		}

		const learner =
			learnerId &&
			(await strapi.db.query("plugin::users-permissions.user").findOne({
				where: { id: learnerId },
				select: ["id"],
			}));
		const quiz = await strapi.db.query("api::quiz.quiz").findOne({
			where: { id: Number(quizId) },
			select: ["id"],
		});
		await progress.update({
			where: { id: row.id, user_plus_quiz_id: key },
			data: {
				...data,
				learner: learner ? learner.id : undefined,
				quiz: quiz?.id,
				completedAt: row.quiz_status === "completed" ? row.updatedAt : null,
			},
		});
	}
}

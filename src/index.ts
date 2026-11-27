import type { Core } from "@strapi/strapi";
import { registerPanelRoute } from "./deneme/admin";
import { seedDefaultTerms } from "./legal/terms";
import { migrateQuizProgress } from "./migrate-quiz-progress";
import { seedBulk } from "./seed-bulk";
import { seedDevelopment } from "./seed-development";

interface AdvancedSettings {
	default_role?: number;
	// biome-ignore lint/suspicious/noExplicitAny: Strapi settings can contain any value
	[key: string]: any;
}

/**
 * Idempotent permission grant helper.
 * Grants an action to a role only if it doesn't already exist.
 */
async function grantPermission(strapi: Core.Strapi, action: string, roleId: number) {
	const permissions = strapi.db.query("plugin::users-permissions.permission");
	const existing = await permissions.findOne({ where: { action, role: roleId } });
	if (!existing) {
		await permissions.create({ data: { action, role: roleId } });
		strapi.log.debug(`  ✅ Granted: ${action} → role #${roleId}`);
	}
}

const COURSE_LESSON = "api::course-lesson.course-lesson";

/**
 * Strapi doesn't cascade deletes: removing a lesson or course leaves its
 * course-lesson links behind with an empty relation, which breaks the course
 * page. Delete those links together with the lesson/course.
 *
 * Only `delete` is handled. Unpublishing keeps the links on purpose, so that
 * publishing the lesson again puts it back in the course.
 */
function cascadeCourseLessonDeletes(strapi: Core.Strapi) {
	const relationFor: Record<string, "lesson" | "course"> = {
		"api::lesson.lesson": "lesson",
		"api::course.course": "course",
	};

	strapi.documents.use(async (context, next) => {
		const relation = relationFor[context.uid];
		const documentId = (context.params as { documentId?: string })?.documentId;
		if (context.action !== "delete" || !relation || !documentId) return next();

		// Look the links up first: once the document is gone the relation is gone too.
		const links = await strapi.db.query(COURSE_LESSON).findMany({
			where: { [relation]: { documentId } },
			select: ["documentId"],
		});
		const result = await next();

		const linkIds = [...new Set(links.map((link) => link.documentId))];
		for (const linkId of linkIds) {
			await strapi.documents(COURSE_LESSON).delete({ documentId: linkId });
		}
		if (linkIds.length) {
			strapi.log.info(
				`🧹 Removed ${linkIds.length} course-lesson link(s) of deleted ${relation} ${documentId}`,
			);
		}
		return result;
	});
}

/**
 * Content types that must NEVER be exposed through the generic REST API.
 * Progress records belong to a single learner and are only read/written
 * through the ownership-checked `api::learning.learning.*` endpoints.
 */
const PRIVATE_CONTENT_TYPES = new Set([
	"api::lesson-progress.lesson-progress",
	"api::quiz-progress.quiz-progress",
	"api::user-course-progress.user-course-progress",
	// Reviews are read and written only through the custom tutor-review routes.
	"api::tutor-review.tutor-review",
	// Mock exams: the answer key, results and phone numbers stay behind the custom deneme routes.
	"api::deneme.deneme",
	"api::sinav-sonucu.sinav-sonucu",
	"api::rapor-talebi.rapor-talebi",
	"api::konu.konu",
]);

/**
 * Sets up all API permissions automatically on every startup.
 * This is idempotent — safe to run repeatedly without duplicating grants.
 *
 * PUBLIC role        → read-only access to published content
 *                      (collection types: find + findOne, single types: find)
 * AUTHENTICATED role → same read access + own profile + learning actions
 *                      (lesson completion, quiz submission, progress)
 *
 * Every `api::*` content type is picked up automatically. To hide a new
 * content type from the public API, add it to PRIVATE_CONTENT_TYPES.
 */
async function bootstrapPermissions(strapi: Core.Strapi) {
	const roles = strapi.db.query("plugin::users-permissions.role");
	const authenticated = await roles.findOne({ where: { type: "authenticated" } });
	const publicRole = await roles.findOne({ where: { type: "public" } });

	if (!authenticated || !publicRole) {
		strapi.log.warn("⚠️  Roles not found — skipping permission bootstrap");
		return;
	}

	// ─── Content types readable by EVERYONE (public + authenticated) ───────────
	for (const [uid, contentType] of Object.entries(strapi.contentTypes)) {
		if (!uid.startsWith("api::") || PRIVATE_CONTENT_TYPES.has(uid)) continue;

		// Single types only expose `find` (GET /api/<name>); there is no findOne.
		const methods = contentType.kind === "singleType" ? ["find"] : ["find", "findOne"];
		for (const method of methods) {
			const action = `${uid}.${method}`;
			await grantPermission(strapi, action, publicRole.id);
			await grantPermission(strapi, action, authenticated.id);
		}
	}

	// ─── Auth endpoints (public must be able to login / register) ─────────────
	const publicAuthActions = [
		"plugin::users-permissions.auth.callback", // POST /auth/local
		"plugin::users-permissions.auth.connect", // social login
		"plugin::users-permissions.auth.register", // POST /auth/local/register
		"plugin::users-permissions.auth.forgotPassword", // POST /auth/forgot-password
		"plugin::users-permissions.auth.resetPassword", // POST /auth/reset-password
		"plugin::users-permissions.auth.emailConfirmation", // GET /auth/email-confirmation
		"plugin::users-permissions.auth.sendEmailConfirmation", // POST /auth/send-email-confirmation
	];
	for (const action of publicAuthActions) {
		await grantPermission(strapi, action, publicRole.id);
	}

	// ─── Authenticated-only: own account ──────────────────────────────────────
	// NOTE: `user.update` / `user.find` / `user.findOne` are intentionally NOT
	// granted — Strapi does no ownership check there, so any logged-in user could
	// read or edit other accounts (including their role).
	const accountActions = [
		"plugin::users-permissions.user.me", // GET  /users/me
		"plugin::users-permissions.auth.changePassword", // POST /auth/change-password (own password)
	];
	for (const action of accountActions) {
		await grantPermission(strapi, action, authenticated.id);
	}

	// ─── Authenticated-only: learning actions (ownership-checked) ─────────────
	// These are the ONLY write paths for progress data; each handler scopes
	// reads/writes to ctx.state.user.
	const learningActions = [
		"listLessons", // GET  /learning/lesson-progress
		"completeLesson", // PUT  /learning/lesson-progress/:documentId
		"courseProgress", // GET  /learning/course-progress/:documentId
		"listCourses", // GET  /learning/courses
		"startCourse", // POST /learning/courses/:documentId/start
		"listAttempts", // GET  /learning/quizzes/:documentId/attempts
		"submitQuiz", // POST /learning/quizzes/:documentId/attempts
	];
	for (const handler of learningActions) {
		await grantPermission(strapi, `api::learning.learning.${handler}`, authenticated.id);
	}

	// ─── Tutor reviews: anyone can read, members can rate (one review per tutor) ─
	const reviewReadActions = ["summary", "list"];
	const reviewMemberActions = ["mine", "upsert", "remove"];
	for (const handler of reviewReadActions) {
		const action = `api::tutor-review.tutor-review.${handler}`;
		await grantPermission(strapi, action, publicRole.id);
		await grantPermission(strapi, action, authenticated.id);
	}
	for (const handler of reviewMemberActions) {
		await grantPermission(strapi, `api::tutor-review.tutor-review.${handler}`, authenticated.id);
	}

	// ─── Mock exams: solved without sign-up, so everything is public ───────────
	const denemeActions = [
		"list",
		"detail",
		"submit",
		"requestReport",
		"report",
		"reportPdf",
		"addParent",
		"lessonExams",
	];
	for (const handler of denemeActions) {
		const action = `api::deneme.deneme.${handler}`;
		await grantPermission(strapi, action, publicRole.id);
		await grantPermission(strapi, action, authenticated.id);
	}

	// Members only: their own exam results (scoped to ctx.state.user in the handler).
	await grantPermission(strapi, "api::deneme.deneme.mine", authenticated.id);

	strapi.log.info("✅ Permission bootstrap complete");
}

export default {
	/**
	 * An asynchronous register function that runs before
	 * your application is initialized.
	 *
	 * This gives you an opportunity to extend code.
	 */
	register({ strapi }: { strapi: Core.Strapi }) {
		cascadeCourseLessonDeletes(strapi);
		registerPanelRoute(strapi);
	},

	/**
	 * An asynchronous bootstrap function that runs before
	 * your application gets started.
	 *
	 * This gives you an opportunity to set up your data model,
	 * run jobs, or perform some special logic.
	 */
	async bootstrap({ strapi }: { strapi: Core.Strapi }) {
		// ── 1. Ensure default roles exist ─────────────────────────────────────
		const pluginStore = strapi.store({
			type: "plugin",
			name: "users-permissions",
		});

		const authenticatedRole = await strapi
			.query("plugin::users-permissions.role")
			.findOne({ where: { type: "authenticated" } });

		if (!authenticatedRole) {
			await strapi.query("plugin::users-permissions.role").create({
				data: {
					name: "Authenticated",
					description: "Default role given to authenticated user.",
					type: "authenticated",
				},
			});
			strapi.log.info("✅ Created default authenticated role");
		}

		const publicRole = await strapi
			.query("plugin::users-permissions.role")
			.findOne({ where: { type: "public" } });

		if (!publicRole) {
			await strapi.query("plugin::users-permissions.role").create({
				data: {
					name: "Public",
					description: "Default role given to unauthenticated user.",
					type: "public",
				},
			});
			strapi.log.info("✅ Created default public role");
		}

		// ── 2. Set default role for new users ─────────────────────────────────
		const settings = (await pluginStore.get({
			key: "advanced",
		})) as AdvancedSettings | null;

		if (!settings?.default_role) {
			const defaultRole = await strapi
				.query("plugin::users-permissions.role")
				.findOne({ where: { type: "authenticated" } });

			if (defaultRole) {
				await pluginStore.set({
					key: "advanced",
					value: { ...(settings || {}), default_role: defaultRole.id },
				});
				strapi.log.info("✅ Set default role for new users");
			}
		}

		// ── 3. Run migrations ──────────────────────────────────────────────────
		await migrateQuizProgress(strapi);

		// ── 4. Bootstrap all API permissions automatically ─────────────────────
		await bootstrapPermissions(strapi);

		// ── 5. Default terms of service (only while the text is empty) ─────────
		try {
			await seedDefaultTerms(strapi);
		} catch (error) {
			strapi.log.error(`Could not write the default terms of service: ${(error as Error).message}`);
		}

		// ── 5. Optional: seed demo data ────────────────────────────────────────
		if (process.env.KETA_SEED_DEMO === "true") {
			await seedDevelopment(strapi);
		}

		// ── 6. Optional: bulk dummy catalog ────────────────────────────────────
		// KETA_SEED_BULK is the number of generated courses; lessons, quizzes,
		// blogs, videos, admission scores and tutors scale with it.
		const bulkCourses = Number.parseInt(process.env.KETA_SEED_BULK ?? "0", 10);
		if (Number.isFinite(bulkCourses) && bulkCourses > 0) {
			await seedBulk(strapi, bulkCourses);
		}
	},
};

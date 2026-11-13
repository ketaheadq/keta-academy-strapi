import type { Core } from "@strapi/strapi";
import { seedDevelopment } from "./seed-development";
import { migrateQuizProgress } from "./migrate-quiz-progress";

interface AdvancedSettings {
	default_role?: number;
	// biome-ignore lint/suspicious/noExplicitAny: Strapi settings can contain any value
	[key: string]: any;
}

/**
 * Idempotent permission grant helper.
 * Grants an action to a role only if it doesn't already exist.
 */
async function grantPermission(
	strapi: Core.Strapi,
	action: string,
	roleId: number,
) {
	const permissions = strapi.db.query("plugin::users-permissions.permission");
	const existing = await permissions.findOne({ where: { action, role: roleId } });
	if (!existing) {
		await permissions.create({ data: { action, role: roleId } });
		strapi.log.debug(`  ✅ Granted: ${action} → role #${roleId}`);
	}
}

/**
 * Sets up all API permissions automatically on every startup.
 * This is idempotent — safe to run repeatedly without duplicating grants.
 *
 * PUBLIC role  → read-only access to published content (find + findOne)
 * AUTHENTICATED role → read-only content + user profile + learning actions
 *
 * To add a new content type, just add its name to the lists below and redeploy.
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
	const publicReadableAPIs = [
		"admission-score",
		"blog",
		"contact-page",
		"course",
		"course-lesson",
		"department",
		"grade",
		"lesson",
		"page",
		"page-category",
		"privacy-policy",
		"quiz",
		"setting",
		"subject",
		"term-and-condition",
		"tutoring-profile",
		"university",
		"video",
	];

	for (const name of publicReadableAPIs) {
		for (const method of ["find", "findOne"]) {
			const action = `api::${name}.${name}.${method}`;
			await grantPermission(strapi, action, publicRole.id);
			await grantPermission(strapi, action, authenticated.id);
		}
	}

	// ─── Auth endpoints (public must be able to login / register) ─────────────
	const publicAuthActions = [
		"plugin::users-permissions.auth.callback",       // POST /auth/local
		"plugin::users-permissions.auth.connect",        // social login
		"plugin::users-permissions.auth.register",       // POST /auth/local/register
		"plugin::users-permissions.auth.forgotPassword", // POST /auth/forgot-password
		"plugin::users-permissions.auth.resetPassword",  // POST /auth/reset-password
		"plugin::users-permissions.auth.emailConfirmation",
	];
	for (const action of publicAuthActions) {
		await grantPermission(strapi, action, publicRole.id);
	}

	// ─── Authenticated-only: user profile & learning actions ──────────────────
	await grantPermission(strapi, "plugin::users-permissions.user.me", authenticated.id);

	const learningActions = [
		"listLessons",
		"completeLesson",
		"courseProgress",
		"listAttempts",
		"submitQuiz",
	];
	for (const handler of learningActions) {
		await grantPermission(strapi, `api::learning.learning.${handler}`, authenticated.id);
	}

	strapi.log.info("✅ Permission bootstrap complete");
}

export default {
	/**
	 * An asynchronous register function that runs before
	 * your application is initialized.
	 *
	 * This gives you an opportunity to extend code.
	 */
	register(/* { strapi }: { strapi: Core.Strapi } */) { },

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

		// ── 5. Optional: seed demo data ────────────────────────────────────────
		if (process.env.KETA_SEED_DEMO === "true") {
			await seedDevelopment(strapi);
		}
	},
};

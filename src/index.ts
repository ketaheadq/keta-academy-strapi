import type { Core } from "@strapi/strapi";

interface AdvancedSettings {
	default_role?: number;
	// biome-ignore lint/suspicious/noExplicitAny: Strapi settings can contain any value
	[key: string]: any;
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
		// Ensure default authenticated role exists
		const pluginStore = strapi.store({
			type: "plugin",
			name: "users-permissions",
		});

		// Check if authenticated role exists
		const authenticatedRole = await strapi
			.query("plugin::users-permissions.role")
			.findOne({ where: { type: "authenticated" } });

		if (!authenticatedRole) {
			// Create default authenticated role
			await strapi.query("plugin::users-permissions.role").create({
				data: {
					name: "Authenticated",
					description: "Default role given to authenticated user.",
					type: "authenticated",
				},
			});

			strapi.log.info("✅ Created default authenticated role");
		}

		// Ensure public role exists
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

		// Set default role for new users
		const settings = (await pluginStore.get({
			key: "advanced",
		})) as AdvancedSettings | null;
		if (!settings || !settings.default_role) {
			const defaultRole = await strapi
				.query("plugin::users-permissions.role")
				.findOne({ where: { type: "authenticated" } });

			if (defaultRole) {
				await pluginStore.set({
					key: "advanced",
					value: {
						...(settings || {}),
						default_role: defaultRole.id,
					},
				});

				strapi.log.info("✅ Set default role for new users");
			}
		}
	},
};

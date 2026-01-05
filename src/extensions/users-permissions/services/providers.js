

/**
 * Custom providers service that extends the default one
 */

const { getService } = require("@strapi/plugin-users-permissions/server/utils");

module.exports = ({ strapi }) => ({
	async connect(provider, query) {
		strapi.log.info(`🔐 Custom providers service called for: ${provider}`);

		// Call the original connect method
		const defaultProviders = getService("providers");
		const result = await defaultProviders.connect(provider, query);

		if (result?.user) {
			strapi.log.info(`✅ User data from ${provider}:`, {
				email: result.user.email,
				username: result.user.username,
				provider: result.user.provider,
			});

			// Generate username if not provided
			if (!result.user.username) {
				let baseUsername = result.user.email
					? result.user.email.split("@")[0]
					: "user";

				// Clean username (remove special characters, ensure min length)
				baseUsername = baseUsername.replace(/[^a-zA-Z0-9]/g, "");
				if (baseUsername.length < 3) {
					baseUsername = `user${Date.now()}`;
				}

				let username = baseUsername;
				let counter = 1;

				// Check if username exists and generate unique one
				while (
					await strapi
						.query("plugin::users-permissions.user")
						.findOne({ where: { username } })
				) {
					username = `${baseUsername}${counter}`;
					counter++;
				}

				result.user.username = username;
				strapi.log.info(`📝 Generated username: ${username}`);

				// Update the user in the database
				await strapi.query("plugin::users-permissions.user").update({
					where: { id: result.user.id },
					data: { username },
				});
			}

			// Ensure user is confirmed for OAuth
			if (result.user.provider !== "local" && !result.user.confirmed) {
				await strapi.query("plugin::users-permissions.user").update({
					where: { id: result.user.id },
					data: { confirmed: true },
				});
				result.user.confirmed = true;
				strapi.log.info(`✅ User confirmed for OAuth provider`);
			}

			// Ensure user has a role
			if (!result.user.role) {
				const defaultRole = await strapi
					.query("plugin::users-permissions.role")
					.findOne({ where: { type: "authenticated" } });

				if (defaultRole) {
					await strapi.query("plugin::users-permissions.user").update({
						where: { id: result.user.id },
						data: { role: defaultRole.id },
					});
					result.user.role = defaultRole.id;
					strapi.log.info(`👤 Assigned default role: ${defaultRole.name}`);
				}
			}

			strapi.log.info(`🎉 User ${result.user.email} processed successfully`);
		}

		return result;
	},
});

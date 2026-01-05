import { factories } from "@strapi/strapi";
import { google } from "googleapis";


export default factories.createCoreController(
	"plugin::users-permissions.user",
	({ strapi }) => ({
		async googleAuth(ctx) {
			try {
				const redirectUri =
					process.env.GOOGLE_REDIRECT_URI ||
					"http://localhost:1337/api/auth/google/callback";

				console.log("🔍 Debug Info:");
				console.log(
					"GOOGLE_CLIENT_ID:",
					process.env.GOOGLE_CLIENT_ID ? "SET" : "NOT SET",
				);
				console.log(
					"GOOGLE_CLIENT_SECRET:",
					process.env.GOOGLE_CLIENT_SECRET ? "SET" : "NOT SET",
				);
				console.log("GOOGLE_REDIRECT_URI:", redirectUri);

				const oauth2Client = new google.auth.OAuth2(
					process.env.GOOGLE_CLIENT_ID,
					process.env.GOOGLE_CLIENT_SECRET,
					redirectUri,
				);

				const scopes = [
					"https://www.googleapis.com/auth/userinfo.email",
					"https://www.googleapis.com/auth/userinfo.profile",
				];

				const authUrl = oauth2Client.generateAuthUrl({
					access_type: "offline",
					scope: scopes,
					state: "some_random_state",
				});

				console.log("🔗 Generated Auth URL:", authUrl);

				// Redirect directly to Google instead of returning URL
				ctx.redirect(authUrl);
			} catch (error) {
				console.error("❌ Google Auth Error:", error);
				ctx.badRequest("Failed to generate Google auth URL", {
					error: error.message,
				});
			}
		},

		async googleCallback(ctx) {
			try {
				const { code } = ctx.request.query;

				if (!code || typeof code !== "string") {
					return ctx.badRequest("Authorization code is required");
				}

				const redirectUri =
					process.env.GOOGLE_REDIRECT_URI ||
					"http://localhost:1337/api/auth/google/callback";

				console.log("🔄 Callback - Using redirect URI:", redirectUri);

				// Initialize OAuth2 client
				const oauth2Client = new google.auth.OAuth2(
					process.env.GOOGLE_CLIENT_ID,
					process.env.GOOGLE_CLIENT_SECRET,
					redirectUri,
				);

				// Exchange code for tokens
				const tokenResponse = await oauth2Client.getToken(code);
				const tokens = tokenResponse.tokens;
				oauth2Client.setCredentials(tokens);

				// Get user info from Google
				const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
				const { data: googleUser } = await oauth2.userinfo.get();

				if (!googleUser.email) {
					return ctx.badRequest("Email not provided by Google");
				}

				console.log("👤 Google User:", googleUser);

				// Check if user already exists
				let user = await strapi.db
					.query("plugin::users-permissions.user")
					.findOne({
						where: { email: googleUser.email },
					});

				if (!user) {
					// Create new user
					const defaultRole = await strapi.db
						.query("plugin::users-permissions.role")
						.findOne({
							where: { type: "authenticated" },
						});

					user = await strapi.db
						.query("plugin::users-permissions.user")
						.create({
							data: {
								username: googleUser.email.split("@")[0], // Ensure unique username
								email: googleUser.email,
								confirmed: true,
								blocked: false,
								provider: "google",
								role: defaultRole.id,
								// Add additional fields from Google profile
								...(googleUser.given_name && {
									firstName: googleUser.given_name,
								}),
								...(googleUser.family_name && {
									lastName: googleUser.family_name,
								}),
								...(googleUser.picture && {
									profilePicture: googleUser.picture,
								}),
							},
						});

					console.log("✅ Created new user:", user.email);
				} else {
					console.log("✅ Found existing user:", user.email);
				}

				// Generate JWT token
				const jwtToken = strapi
					.plugin("users-permissions")
					.service("jwt")
					.issue({
						id: user.id,
					});

				// Remove sensitive data manually instead of using sanitizeOutput
				const sanitizedUser = {
					id: user.id,
					username: user.username,
					email: user.email,
					provider: user.provider,
					confirmed: user.confirmed,
					blocked: user.blocked,
					createdAt: user.createdAt,
					updatedAt: user.updatedAt,
					...(user.firstName && { firstName: user.firstName }),
					...(user.lastName && { lastName: user.lastName }),
					...(user.profilePicture && { profilePicture: user.profilePicture }),
				};

				console.log("🎉 Authentication successful for:", sanitizedUser.email);

				// Redirect to frontend with token and user data
				const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
				const callbackUrl = new URL("/auth/callback", frontendUrl);

				// Add token and user data as query parameters
				callbackUrl.searchParams.set("token", jwtToken);
				callbackUrl.searchParams.set("user", JSON.stringify(sanitizedUser));
				callbackUrl.searchParams.set("success", "true");

				console.log("🔗 Redirecting to frontend:", callbackUrl.toString());

				// Redirect to frontend
				ctx.redirect(callbackUrl.toString());
			} catch (error) {
				console.error("❌ Google OAuth error:", error);

				// Redirect to frontend with error
				const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
				const errorUrl = new URL("/auth/callback", frontendUrl);
				errorUrl.searchParams.set("error", "authentication_failed");
				errorUrl.searchParams.set("message", error.message);
				errorUrl.searchParams.set("success", "false");

				ctx.redirect(errorUrl.toString());
			}
		},

		// Verify Strapi JWT token and return user info
		async verifyToken(ctx) {
			try {
				// Get token from Authorization header
				const authHeader = ctx.request.headers.authorization;

				console.log("🔍 Auth Header:", authHeader);

				if (!authHeader?.startsWith("Bearer ")) {
					console.log("❌ No valid Authorization header");
					return ctx.unauthorized(
						"Authorization header with Bearer token is required",
					);
				}

				const token = authHeader.substring(7); // Remove 'Bearer ' prefix
				console.log("🔍 Extracted Token:", `${token.substring(0, 50)}...`);

				// Verify JWT token using Strapi's JWT service
				console.log("🔍 Attempting to verify token...");
				const decoded = await strapi
					.plugin("users-permissions")
					.service("jwt")
					.verify(token);
				console.log("✅ Token decoded successfully:", decoded);

				if (!decoded?.id) {
					console.log("❌ Invalid decoded token:", decoded);
					return ctx.unauthorized("Invalid token");
				}

				// Get user from database
				console.log("🔍 Looking for user with ID:", decoded.id);
				const user = await strapi.db
					.query("plugin::users-permissions.user")
					.findOne({
						where: { id: decoded.id },
						populate: ["role"],
					});

				if (!user) {
					console.log("❌ User not found with ID:", decoded.id);
					return ctx.unauthorized("User not found");
				}

				if (user.blocked) {
					console.log("❌ User is blocked:", user.email);
					return ctx.unauthorized("User is blocked");
				}

				console.log("✅ User found:", user.email);

				// Return sanitized user data
				const sanitizedUser = {
					id: user.id,
					username: user.username,
					email: user.email,
					provider: user.provider,
					confirmed: user.confirmed,
					blocked: user.blocked,
					role: user.role?.name || "authenticated",
					createdAt: user.createdAt,
					updatedAt: user.updatedAt,
					...(user.firstName && { firstName: user.firstName }),
					...(user.lastName && { lastName: user.lastName }),
					...(user.profilePicture && { profilePicture: user.profilePicture }),
				};

				ctx.send({
					message: "🎉 JWT Authentication successful!",
					user: sanitizedUser,
					tokenInfo: {
						issuedAt: new Date(decoded.iat * 1000),
						expiresAt: new Date(decoded.exp * 1000),
						isValid: true,
					},
					timestamp: new Date().toISOString(),
				});
			} catch (error) {
				console.error("❌ Token verification error:", error);
				console.error("❌ Error details:", error.message);
				ctx.unauthorized("Invalid or expired token", { error: error.message });
			}
		},
	}),
);

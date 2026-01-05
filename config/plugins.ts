export default ({ env }) => ({
	// Upload provider for actual file uploads
	upload: {
		config: {
			provider: "cloudinary",
			providerOptions: {
				cloud_name: env("CLOUDINARY_CLOUD_NAME"),
				api_key: env("CLOUDINARY_API_KEY"),
				api_secret: env("CLOUDINARY_ENCRYPTION_KEY"),
			},
		},
	},
	documentation: {
		enabled: true,
		config: {
			generateDefaultResponse: true,
			// Optional: customize further below
		},
	},
});

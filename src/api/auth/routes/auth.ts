export default {
	routes: [
		{
			method: "GET",
			path: "/auth/google",
			handler: "auth.googleAuth",
			config: {
				auth: false,
				policies: [],
				middlewares: [],
			},
		},
		{
			method: "GET",
			path: "/auth/google/callback",
			handler: "auth.googleCallback",
			config: {
				auth: false,
				policies: [],
				middlewares: [],
			},
		},
		{
			method: "GET",
			path: "/auth/verify",
			handler: "auth.verifyToken",
			config: {
				auth: false, // We handle auth manually in the controller
				policies: [],
				middlewares: [],
			},
		},
	],
};

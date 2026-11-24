// Public mock-exam endpoints (no core find/findOne: those would expose the answer key).
// Fixed paths come before ":slug" so they aren't matched as a slug.
export default {
	routes: [
		{ method: "GET", path: "/denemeler", handler: "deneme.list" },
		{ method: "GET", path: "/denemeler/ders-eslesme", handler: "deneme.lessonExams" },
		{ method: "POST", path: "/denemeler/rapor-talebi", handler: "deneme.requestReport" },
		{ method: "GET", path: "/denemeler/:slug", handler: "deneme.detail" },
		{ method: "POST", path: "/denemeler/:slug/sonuc", handler: "deneme.submit" },
		{ method: "GET", path: "/raporlar/:key", handler: "deneme.report" },
		{ method: "POST", path: "/raporlar/:key/veli", handler: "deneme.addParent" },
	],
};

/**
 * Question-writer API: lets an AI agent (the "deneme-yazari" Claude skill) read the catalogue
 * (subjects, grades, topics, lessons, exams), upload question images and save exams as drafts.
 *
 * Not tied to a Strapi user: every route is behind the `x-soru-yazari-token` header, checked
 * against SORU_YAZARI_TOKEN. Without that variable the API is off. Exams are only ever saved as
 * drafts; the teacher reviews and publishes them in the admin panel.
 */
const config = { auth: false as const, policies: ["api::soru-yazari.token"] };

export default {
	routes: [
		{
			method: "GET",
			path: "/soru-yazari/katalog",
			handler: "soru-yazari.catalog",
			config,
		},
		{
			method: "GET",
			path: "/soru-yazari/dersler",
			handler: "soru-yazari.lessons",
			config,
		},
		{
			method: "GET",
			path: "/soru-yazari/dersler/:documentId",
			handler: "soru-yazari.lesson",
			config,
		},
		{
			method: "GET",
			path: "/soru-yazari/denemeler",
			handler: "soru-yazari.exams",
			config,
		},
		{
			method: "GET",
			path: "/soru-yazari/denemeler/:documentId",
			handler: "soru-yazari.exam",
			config,
		},
		{
			method: "POST",
			path: "/soru-yazari/denemeler",
			handler: "soru-yazari.createExam",
			config,
		},
		{
			method: "PUT",
			path: "/soru-yazari/denemeler/:documentId",
			handler: "soru-yazari.updateExam",
			config,
		},
		{
			method: "POST",
			path: "/soru-yazari/gorseller",
			handler: "soru-yazari.uploadImage",
			config,
		},
	],
};

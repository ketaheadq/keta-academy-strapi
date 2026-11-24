/** Settings for the free mock exams ("deneme sınavları"). See README → Alınan kararlar. */

/** First N reports wait for the teacher's approval; later ones are sent automatically. */
export const MANUAL_APPROVAL_COUNT = 30;
/** Share of automatically sent reports flagged for spot checks ("örnekleme"). */
export const SAMPLE_CHECK_RATE = 0.1;
/** The "X öğrenci çözdü" counter appears only from this many results on. */
export const SOLVED_COUNTER_THRESHOLD = 50;
/** The student's rank among participants appears only from this many results on. */
export const RANK_THRESHOLD = 30;
/** How many weakest topics the report lists. */
export const WEAK_TOPIC_COUNT = 3;
/** Videos suggested per weak topic. */
export const VIDEOS_PER_TOPIC = 2;
/** Max report requests per phone number in 24 hours (limits SMS abuse). */
export const MAX_REQUESTS_PER_PHONE_PER_DAY = 3;

export const siteUrl = () =>
	(process.env.PUBLIC_SITE_URL || process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");

export const whatsappNumber = () => (process.env.WHATSAPP_NUMBER || "").trim();

/** Days to keep report requests and exam results before the daily cleanup deletes them. */
export const retentionDays = () => {
	const days = Number.parseInt(process.env.DENEME_RETENTION_DAYS || "", 10);
	return Number.isFinite(days) && days >= 90 ? days : 365;
};

export const UIDS = {
	deneme: "api::deneme.deneme",
	konu: "api::konu.konu",
	sonuc: "api::sinav-sonucu.sinav-sonucu",
	talep: "api::rapor-talebi.rapor-talebi",
	lesson: "api::lesson.lesson",
	courseLesson: "api::course-lesson.course-lesson",
} as const;

import type { Core } from "@strapi/strapi";
import { blocks, createRandom, createSeedKit } from "./seed-support";

const DEMO_VIDEO_URL = "https://www.youtube.com/watch?v=DnFrOetuUKg";

// 160x90 gradient placeholders, cycled across the generated rows.
const COVERS: { name: string; base64: string }[] = [
	{
		name: "indigo",
		base64: "iVBORw0KGgoAAAANSUhEUgAAAKAAAABaCAIAAACwpMoFAAABxUlEQVR42u3RBZbaAABF0b8iYICEBCIEEigMMLtrp+7uPnWXqbvbVPbRffzzzrk7uFoZ/YMxrYz+wpgW1R8Y06L6DWNaVBswpnm1AWOal79gTPPyJ4xpXv6AMc3K7zCm2fAbjGk2/ApjWh5+gTEtDz7DGMHuwdPBJxjTdPARxjQtPsCYJsV7GNOkeAdjmhRvYUyT/hsY06b+axgj2D44fwVjGucvYUzj/AWMaZw/hzGNsmcwplH2FMY0yp7AmKpsHcZUpeswpip9DGOq0kcwpjJ5CGMqkwcwpjK5D2MaJvdgTMPeXRjTsHcHxjTo3YYxgu2Du7dgTEX3Joyp6N6AMRXxdRhTEV+DMfXjqzCmfnwFxtSP1mBMebQGY8qjyzCmPLoEY8o6F2FMWecCjCnrnIcxpeE5GFManoUxpeEZGCPYPTgJTsOYkuAUjCkJTsKYesEJGFOvfRzG1GsfgzF120dhTN3WERgj2D04bh2GMcWtQzCmuHkQxhQ3D8CYouZ+GFPU3Adjipb2wpg6S3tgjGD74MZuGFPY2AVjChs7YUxhYweMKaxvhzEF9W0wpqC+FcYU1FdhTO3aKoypXdsCY2rXNsPYf07/sd3/qaGNAAAAAElFTkSuQmCC",
	},
	{
		name: "teal",
		base64: "iVBORw0KGgoAAAANSUhEUgAAAKAAAABaCAIAAACwpMoFAAABjElEQVR42u3RZ1ZaUQBG0e/vu/cxwDQrqBQrIGBBBSwxUdMGnHmcddbaM9jp/HsRWDp/nwVmMD74z5PADMYH/34UmMH44F8bgaXzsRFYOh9rgaV9Xwss7ftKYGnfVgJL+/YgsLQ/HwSW9se9wAzGB7/eCSzt61Jgab8vBZb25VZgBuODn28EZjA++OlaYAbjgx+vBJZ2cyWwtJuFwNKuFwJLXc8FlrqaCyx1NRNY6sNMYKn3lwJLvZ8KLPVuKrDUu4nAUpcTgaUuxwJLvR0LLPXmQmAG44OvzwVmMD746kxgBuODF6cCS52fCix1fiKwlNmJwFJmxwJLuRwJLGU6EljKdCiwlMlQYCmTgcBSxgOBpYz7Aku56Ass5fxIYAbjg88OBWYwPvj0QGAG44NPegJLOe4JLOW4K7CUUVdgaUb7Aksz3BOYwfjgwa7A0vR3BZamvyOwNEc7AktztC2wNIfbAktzuCWwNAdbAkvT+yYwg/HB3a8CMxgfvP9FYAbjg/c+CyzN7ieBGQz3H+B0+1zJnRp4AAAAAElFTkSuQmCC",
	},
	{
		name: "rose",
		base64: "iVBORw0KGgoAAAANSUhEUgAAAKAAAABaCAIAAACwpMoFAAABxklEQVR42u3RhXEbAQBE0e1Bx3eqwSILLMtiyf2FHHSYOQ4zc+IwUyfp48/OvA6e/pVXDUx/y6sGpj/luYHpd3luYA6mB/8q5gamn8XMwPSjmBmYvhczA9O3Ympg+lpMDUxfiqmBOZge/LmYGJg+5RMD08d8YmD6kE8MTO/zsYHpXT42MG3mYwPTZj4yML3NRwamN/nIwPQ6GxmYXmVDA9PLbGhgepENDUzPs4GBOZge/CwbGJieZgMD05Osb2B6nPYNTI/SvoHpYbpiYHqQrhiYg+nB99MVA9O9tGdgupv2DEx3kp6B6XbSMzDdSpYNTDeTZQNzMD34RtI1MF1Pugama0nXwHQ16RqYrsRLBqbL8ZKBaSNeMjBtxB0D06W4Y2C6GHcMTBfijoHpfNw2MJ2L2wams1HbwHQmahmYg+nBp6OWgelU1DIwnYyaBqYTUdPAdDxqGpiORU0D09Fw0cAcTA8+Ei4amA6HDQPTobBhYDoYNgxMB8KGgWl/WDcwrYd1A9N6UDcw7QtqBqa9Qc3AtCeoGZh2BzUD066gamDaGVQNTGtB1cC0FlQMTDtKFQPT9lLFwLStVDEwbS0tGJi2lBYM7D9E9UL2Aqc0ewAAAABJRU5ErkJggg==",
	},
	{
		name: "amber",
		base64: "iVBORw0KGgoAAAANSUhEUgAAAKAAAABaCAIAAACwpMoFAAABvElEQVR42u3RZVYWYBSF0fPjvXd4SElJN37UR87CblQsULCwBezAwMJAmY3zeNZZa89ga28+DUz/5tPA9HcuDUy7c2lg2p1NA9Of2TQw/Z5JA9OvmTQw/ZxOA9POdBqYdqbSwPRjKg1M36tpYPpWTQPT12oamL5MpoFpezINTNsTaWD6PJEGpk/jaWD6OJ4Gpg9jaWDaGgsD09ZoGJjej4aB6V0lDExvK2FgelMJA9Prg2FgDqYHvxoJA9PLkTAwvRgOA9Pz4TAwPRsKA9PmUBiYNgfDwLQxGAam9YEwMD0dCAPTk/4wMD3uDwNzMD34UV8YmB72hYHpQW8YmO73hoHpXk8YmNZ6wsC01h0GprvdYWC60xUGpttdYWC61RkGppudYWAOpgevdoSBaaUjDEw32sPAdL09DEzLB8LAHEwPXmoLA9O1tjAwXW0NA9OV1mJgutxSDEyXWoqBOZgevNhcDEwXm4uB6UJTMTCdbyoGpoX9xcAcTA8+11gMTGcbi4HpTEMxMJ1uKAamU/XFwHSyvhiYg+nBJ+qKgel4XTEwHastBqajtcXAdGRfMTAH04MP1xQD06GaYmD/ATnYKGO/jXtSAAAAAElFTkSuQmCC",
	},
];

const SUBJECTS = [
	{ slug: "bulk-matematik", title: "Matematik", icon: "math", description: "Sayılar, cebir ve geometri için otomatik üretilmiş konu havuzu." },
	{ slug: "bulk-fizik", title: "Fizik", icon: "physics", description: "Mekanik, elektrik ve modern fizik başlıkları." },
	{ slug: "bulk-kimya", title: "Kimya", icon: "chemistry", description: "Atom, bağlar ve reaksiyonlar için örnek içerik." },
	{ slug: "bulk-biyoloji", title: "Biyoloji", icon: "biology", description: "Hücre, kalıtım ve sistemler için örnek içerik." },
	{ slug: "bulk-turkce", title: "Türkçe", icon: "literature", description: "Paragraf, dil bilgisi ve anlam bilgisi çalışmaları." },
	{ slug: "bulk-ingilizce", title: "İngilizce", icon: "english", description: "Kelime, okuma ve dinleme pratiği." },
	{ slug: "bulk-tarih", title: "Tarih", icon: "history", description: "Dönemler, kavramlar ve kronoloji tekrarları." },
	{ slug: "bulk-cografya", title: "Coğrafya", icon: "geography", description: "Harita okuma, iklim ve yer şekilleri." },
	{ slug: "bulk-yazilim", title: "Yazılım", icon: "coding", description: "Algoritma ve programlamaya giriş içerikleri." },
];

const GRADES = [
	{ slug: "bulk-9-sinif", title: "9. Sınıf" },
	{ slug: "bulk-10-sinif", title: "10. Sınıf" },
	{ slug: "bulk-11-sinif", title: "11. Sınıf" },
	{ slug: "bulk-12-sinif", title: "12. Sınıf" },
	{ slug: "bulk-mezun", title: "Mezun" },
];

const TOPICS = [
	"Temel Kavramlar",
	"Problem Çözme Teknikleri",
	"Grafik ve Tablo Okuma",
	"Denklem Kurma",
	"Soru Çözüm Atölyesi",
	"Hızlı Tekrar",
	"Püf Noktalar",
	"Karma Alıştırmalar",
];

const LESSON_TITLES = ["Kavramlara Giriş", "Adım Adım Çözüm", "Örnek Sorular", "Video Anlatım", "Özet ve Tekrar"];

const LESSON_BODY = [
	"Bu ders otomatik üretilmiştir; konuyu kısa bir anlatımla özetler ve ardından örnek sorularla pekiştirir.",
	"Önce tanımı hatırla, sonra bir örneği adım adım çöz, son olarak benzer bir soruyu kendin dene.",
	"Konu anlatımını bitirdikten sonra quizdeki sorularla kendini test edebilirsin.",
];

const BLOG_TITLES = [
	"Verimli Ders Çalışma Yöntemleri",
	"Sınav Kaygısıyla Başa Çıkma",
	"Haftalık Çalışma Planı Nasıl Yapılır",
	"Deneme Sınavı Analizi Nasıl Okunur",
	"Motivasyonu Uzun Süre Koruma Rehberi",
	"Konu Tekrarı İçin Beş Adım",
];

const VIDEO_TITLES = ["Konu Anlatımı", "Soru Çözümü", "Tekrar Videosu", "Püf Noktalar", "Örnek Sınav"];

const UNIVERSITIES = [
	"Keta Kuzey Üniversitesi",
	"Anadolu Bilim Üniversitesi",
	"Ege Akademi Üniversitesi",
	"Başkent Yenilik Üniversitesi",
	"Marmara Gelecek Üniversitesi",
	"Akdeniz Ufuk Üniversitesi",
	"İç Anadolu Teknik Üniversitesi",
	"Karadeniz Bilgi Üniversitesi",
];

const DEPARTMENTS = [
	"Bilgisayar Mühendisliği",
	"Matematik",
	"Hukuk",
	"Tıp",
	"Psikoloji",
	"İktisat",
	"Elektrik-Elektronik Mühendisliği",
	"Mimarlık",
];

const SCORE_TYPES = ["SAY", "EA", "SÖZ", "DİL"];

const TUTOR_FIRST = ["Elif", "Mert", "Zeynep", "Kaan", "Ayşe", "Burak", "Selin", "Emre", "Deniz", "Ceren", "Onur", "Buse"];
const TUTOR_LAST = ["Yılmaz", "Demir", "Kaya", "Şahin", "Çelik", "Aydın", "Öztürk", "Arslan", "Doğan", "Kılıç", "Aslan", "Polat"];

/**
 * Generates a large, plausible catalog for local development: courses with
 * lessons, quizzes and links, plus blogs, videos, universities, admission
 * scores and tutors.
 *
 * Rows are matched on their unique field (title/name) or slug, so running the
 * seed again with the same count is a no-op and a bigger count only adds the
 * missing items.
 */
export async function seedBulk(strapi: Core.Strapi, courseCount: number) {
	if (process.env.DATABASE_HOST !== "db" || process.env.UPLOAD_PROVIDER !== "local") {
		throw new Error("Demo data requires the local Docker database and uploads.");
	}

	const { seed, upload } = createSeedKit(strapi);
	const random = createRandom(20260101);
	const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
	const between = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));

	const covers: number[] = [];
	for (const cover of COVERS) {
		covers.push(await upload(`keta-bulk-${cover.name}.png`, "image/png", Buffer.from(cover.base64, "base64")));
	}
	const notes = await upload("keta-bulk-alistirma.txt", "text/plain", Buffer.from("KetaLearn otomatik üretilmiş alıştırma notu.\n"));
	const coverFor = (index: number) => covers[index % covers.length];

	// ── Catalog backbone: subjects, grades, pages ────────────────────────────
	const subjects: { title: string; icon: string; documentId: string }[] = [];
	for (const row of SUBJECTS) {
		const subject = await seed("api::subject.subject", { title: row.title }, {
			slug: row.slug, title: row.title, description: row.description, icon: { name: row.icon },
		});
		subjects.push({ title: row.title, icon: row.icon, documentId: subject.documentId });
	}

	const grades: { documentId: string }[] = [];
	for (const row of GRADES) {
		const grade = await seed("api::grade.grade", { title: row.title }, { slug: row.slug, title: row.title });
		grades.push({ documentId: grade.documentId });
	}

	// Reuse the pages the demo seed created so all content shows up in one place.
	const ensurePage = async (pageType: string, slug: string, title: string) => {
		const existing = await strapi.documents("api::page.page").findFirst({
			filters: { pageType }, status: "published",
		});
		if (existing) return existing;
		const category = await seed("api::page-category.page-category", { slug: "bulk-rehber" }, {
			slug: "bulk-rehber", title: "Bulk Rehber",
		});
		return seed("api::page.page", { slug }, {
			slug, title, pageType, page_category: category.documentId,
		});
	};
	const blogPage = await ensurePage("Bloglar", "bulk-yazilar", "Bulk Yazılar");
	const videoPage = await ensurePage("Videolar", "bulk-videolar", "Bulk Videolar");
	const scoresPage = await ensurePage("Üniversite Taban Puanları", "bulk-taban-puanlari", "Bulk Taban Puanları");

	// ── Courses with lessons, quizzes and course-lesson links ────────────────
	let lessonTotal = 0;
	for (let index = 1; index <= courseCount; index++) {
		const subject = pick(subjects);
		const topic = pick(TOPICS);
		const courseGrades = [pick(grades), pick(grades)].filter(
			(grade, position, all) => all.findIndex((item) => item.documentId === grade.documentId) === position,
		);
		const courseSlug = `bulk-ders-${index}`;
		const courseTitle = `${subject.title}: ${topic} ${index}`;
		const course = await seed("api::course.course", { title: courseTitle }, {
			slug: courseSlug, title: courseTitle,
			description: `${subject.title} dersi için otomatik üretilmiş ${topic.toLowerCase()} içeriği.`,
			thumbnail: coverFor(index), image: coverFor(index), icon: { name: subject.icon },
			subject: subject.documentId, grades: courseGrades.map((grade) => grade.documentId),
			duration: between(20, 90), isPopular: index % 4 === 0,
		});

		const quizTitle = `${topic} Quizi ${index}`;
		const quiz = await seed("api::quiz.quiz", { title: quizTitle }, {
			title: quizTitle, description: `${courseTitle} dersini üç soruyla kontrol et.`,
			questions: makeQuestions(topic, index, random),
		});

		const lessonCount = between(3, 5);
		const lessons: { documentId: string }[] = [];
		for (let lessonIndex = 1; lessonIndex <= lessonCount; lessonIndex++) {
			const lessonTitle = `${topic} ${index} — ${pick(LESSON_TITLES)} ${lessonIndex}`;
			const data: Record<string, unknown> = {
				slug: `${courseSlug}-konu-${lessonIndex}`, title: lessonTitle,
				description: `${courseTitle} dersinin ${lessonIndex}. konusu.`,
				content: [...blocks(pick(LESSON_BODY)), ...blocks(`${topic} için örnek soru: ${lessonIndex}. soruyu çöz ve açıklamasını oku.`)],
			};
			if (lessonIndex === 1) data.attachments = [notes];
			if (lessonIndex % 2 === 0) data.videoURL = DEMO_VIDEO_URL;
			if (lessonIndex === lessonCount) data.quiz = quiz.documentId;
			const lesson = await seed("api::lesson.lesson", { title: lessonTitle }, data);
			lessons.push({ documentId: lesson.documentId });
			lessonTotal += 1;
		}

		for (const [order, lesson] of lessons.entries()) {
			await seed("api::course-lesson.course-lesson",
				{ course: { documentId: course.documentId }, lesson: { documentId: lesson.documentId } },
				{ course: course.documentId, lesson: lesson.documentId, order: order + 1 });
		}

		if (index % 5 === 0 || index === courseCount) {
			strapi.log.info(`🌱 Bulk seed: ${index}/${courseCount} course(s) ready`);
		}
	}

	// ── Blogs and videos ─────────────────────────────────────────────────────
	const blogCount = Math.max(4, Math.round(courseCount / 2));
	for (let index = 1; index <= blogCount; index++) {
		const title = `${pick(BLOG_TITLES)} ${index}`;
		await seed("api::blog.blog", { slug: `bulk-yazi-${index}` }, {
			slug: `bulk-yazi-${index}`, title, category: pick(["Lise", "Üniversite", "Mezun", "Doktora", "Üniversite Hazırlık"]),
			content: [...blocks(`${title} başlığı için otomatik üretilmiş giriş paragrafı.`), ...blocks("Kısa hedefler belirle, her gün tekrar et ve haftada bir deneme çöz.")],
			image: coverFor(index), page: blogPage.documentId, isPopular: index % 3 === 0,
		});
	}

	const videoCount = Math.max(4, Math.round(courseCount / 3));
	for (let index = 1; index <= videoCount; index++) {
		await seed("api::video.video", { slug: `bulk-video-${index}` }, {
			slug: `bulk-video-${index}`, title: `${pick(VIDEO_TITLES)} ${index}`,
			href: DEMO_VIDEO_URL, page: videoPage.documentId, isPopular: index % 4 === 0,
		});
	}

	// ── Universities, departments and admission scores ───────────────────────
	const universityCount = Math.min(UNIVERSITIES.length, Math.max(4, Math.round(courseCount / 2)));
	const universities: { title: string; documentId: string }[] = [];
	for (let index = 0; index < universityCount; index++) {
		const title = UNIVERSITIES[index];
		const university = await seed("api::university.university", { slug: `bulk-universite-${index + 1}` }, {
			slug: `bulk-universite-${index + 1}`, title, ranking: index + 1,
			description: `${title} için otomatik üretilmiş tanıtım yazısı.`,
			content: blocks("Kampüs, fakülteler ve öğrenci olanakları hakkındaki bilgiler örnek amaçlıdır."),
			image: coverFor(index),
		});
		universities.push({ title, documentId: university.documentId });
	}

	const departments: { title: string; documentId: string }[] = [];
	for (const [index, title] of DEPARTMENTS.entries()) {
		const department = await seed("api::department.department", { titile: title }, {
			titile: title, content: blocks(`${title} bölümü için otomatik üretilmiş tanıtım.`), image: coverFor(index),
		});
		departments.push({ title, documentId: department.documentId });
	}

	// University and department are one-to-one with an admission score, so there
	// is exactly one score row per generated university.
	const scoreCount = universities.length;
	for (let index = 0; index < scoreCount; index++) {
		const university = universities[index];
		const department = departments[index % departments.length];
		const scoreType = pick(SCORE_TYPES);
		const baseScore = between(210, 480);
		const baseRank = between(1000, 250000);
		const quota = between(20, 120);
		const rows = [2026, 2025, 2024].map(
			(year, offset) => `${year},${scoreType},${baseScore - offset * 5},${baseRank + offset * 2500},${quota + offset * 5}`,
		);
		await seed("api::admission-score.admission-score", { slug: `bulk-taban-puan-${index + 1}` }, {
			slug: `bulk-taban-puan-${index + 1}`,
			title: `${university.title} ${department.title} Taban Puanı`,
			content: blocks("Tablo otomatik üretilmiştir; resmî verilerle ilgisi yoktur."),
			tableData: ["Yıl,Puan Türü,Taban Puanı,Başarı Sırası,Kontenjan", ...rows].join("\n"),
			university: university.documentId, department: department.documentId, page: scoresPage.documentId,
			isPopular: index % 5 === 0,
		});
	}

	// ── Tutors ───────────────────────────────────────────────────────────────
	const tutorCount = Math.min(TUTOR_FIRST.length, Math.max(3, Math.round(courseCount / 3)));
	for (let index = 0; index < tutorCount; index++) {
		// Both `name` and `slug` are unique here, and name is the match key of the
		// other rows, so the pair must stay fixed per index: picking a random surname
		// from the shared stream would re-roll it whenever the course count changes
		// and collide with the slug that index already owns.
		const name = `${TUTOR_FIRST[index]} ${TUTOR_LAST[index % TUTOR_LAST.length]}`;
		const subject = pick(subjects);
		await seed("api::tutoring-profile.tutoring-profile", { slug: `bulk-egitmen-${index + 1}` }, {
			name, slug: `bulk-egitmen-${index + 1}`, title: `${subject.title} Eğitmeni`,
			phone: `05${between(30, 59)} ${between(200, 999)} ${String(between(0, 99)).padStart(2, "0")} ${String(between(0, 99)).padStart(2, "0")}`,
			price: between(300, 1500), successRate: between(70, 99), studentCount: between(8, 240),
			exprienceYears: between(1, 18), experties: `${subject.title}, ${pick(subjects).title}`,
			content: blocks(`${name} için otomatik üretilmiş eğitmen tanıtımı.`), profilePicture: coverFor(index),
		});
	}

	strapi.log.info(
		`🌱 KetaLearn bulk data is ready: ${courseCount} course(s), ${lessonTotal} lesson(s), ` +
		`${blogCount} blog(s), ${videoCount} video(s), ${universityCount} university/universities, ` +
		`${scoreCount} admission score(s), ${tutorCount} tutor(s).`,
	);
}

function makeQuestions(topic: string, courseIndex: number, random: () => number): Record<string, unknown>[] {
	const questions: Record<string, unknown>[] = [];
	for (let number = 1; number <= 3; number++) {
		if (number === 3) {
			const isTrue = random() < 0.5;
			questions.push({
				type: "trueFalse", order: number,
				text: blocks(`${topic} ${courseIndex}: aşağıdaki ifade doğru mudur?`),
				explanation: blocks(`Cevap: ${isTrue ? "doğru" : "yanlış"}.`),
				options: [
					{ text: "Doğru", isCorrect: isTrue, order: 1 },
					{ text: "Yanlış", isCorrect: !isTrue, order: 2 },
				],
			});
			continue;
		}
		const correctOrder = 1 + Math.floor(random() * 4);
		questions.push({
			type: "multipleChoice", order: number,
			text: blocks(`${topic} ${courseIndex} — ${number}. soru: hangi seçenek doğrudur?`),
			explanation: blocks(`Doğru cevap ${correctOrder}. seçenektir.`),
			options: ["A", "B", "C", "D"].map((label, offset) => ({
				text: `Seçenek ${label}`, isCorrect: offset + 1 === correctOrder, order: offset + 1,
			})),
		});
	}
	return questions;
}

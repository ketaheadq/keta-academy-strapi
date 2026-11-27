import type { Core } from "@strapi/strapi";
import { blocks, createSeedKit } from "./seed-support";

export async function seedDevelopment(strapi: Core.Strapi) {
	if (process.env.DATABASE_HOST !== "db" || process.env.UPLOAD_PROVIDER !== "local") {
		throw new Error("Demo data requires the local Docker database and uploads.");
	}

	const { seed, upload } = createSeedKit(strapi);

	const cover = await upload(
		"keta-demo-cover.png",
		"image/png",
		Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ2QAAAAASUVORK5CYII=",
			"base64",
		),
	);
	const notes = await upload(
		"keta-demo-alistirma.txt",
		"text/plain",
		Buffer.from("KetaLearn demo: 1/2 + 1/4 toplamını bulun.\n"),
	);
	const subject = await seed(
		"api::subject.subject",
		{ slug: "demo-matematik" },
		{
			slug: "demo-matematik",
			title: "Demo Matematik",
			description: "KetaLearn örnek konu kataloğu.",
		},
	);
	const grade = await seed(
		"api::grade.grade",
		{ slug: "demo-9-sinif" },
		{
			slug: "demo-9-sinif",
			title: "Demo 9. Sınıf",
		},
	);
	const course = await seed(
		"api::course.course",
		{ slug: "demo-kesirler" },
		{
			slug: "demo-kesirler",
			title: "Demo: Kesirlerle İşlemler",
			description: "Kesirleri karşılaştır, topla ve kısa bir quizle öğrendiklerini kontrol et.",
			thumbnail: cover,
			image: cover,
			subject: subject.documentId,
			grades: [grade.documentId],
			duration: 30,
			isPopular: true,
		},
	);
	const quiz = await seed(
		"api::quiz.quiz",
		{ title: "Demo: Kesirler Quizi" },
		{
			title: "Demo: Kesirler Quizi",
			description: "İki kısa soruyla bilgini kontrol et.",
			questions: [
				{
					type: "multipleChoice",
					order: 1,
					text: blocks("1/2 + 1/4 kaçtır?"),
					explanation: blocks("Paydaları eşitle: 2/4 + 1/4 = 3/4."),
					options: [
						{ text: "3/4", isCorrect: true, order: 1 },
						{ text: "2/6", order: 2 },
					],
				},
				{
					type: "trueFalse",
					order: 2,
					text: blocks("2/4 ile 1/2 eşittir."),
					explanation: blocks("2/4 kesrini 2 ile sadeleştirince 1/2 elde edilir."),
					options: [
						{ text: "Doğru", isCorrect: true, order: 1 },
						{ text: "Yanlış", order: 2 },
					],
				},
			],
		},
	);
	const lesson = await seed(
		"api::lesson.lesson",
		{ slug: "demo-payda-esitleme" },
		{
			slug: "demo-payda-esitleme",
			title: "Demo: Payda Eşitleme",
			description: "Kesirleri aynı paydada yaz.",
			content: blocks(
				"1/2 kesrini 2/4 olarak yazabiliriz. Artık 1/4 ile topladığımızda sonuç 3/4 olur.",
			),
			attachments: [notes],
			quiz: quiz.documentId,
		},
	);
	const videoLesson = await seed(
		"api::lesson.lesson",
		{ slug: "demo-kesirleri-gorsellestirme" },
		{
			slug: "demo-kesirleri-gorsellestirme",
			title: "Demo: Kesirleri Görselleştirme",
			description: "Kesirleri sayı doğrusunda incele.",
			videoURL: "https://www.youtube.com/watch?v=DnFrOetuUKg",
			content: blocks("Bir bütünü eş parçalara ayır ve parçaları karşılaştır."),
		},
	);
	for (const [index, item] of [lesson, videoLesson].entries()) {
		await seed(
			"api::course-lesson.course-lesson",
			{ course: { documentId: course.documentId }, lesson: { documentId: item.documentId } },
			{ course: course.documentId, lesson: item.documentId, order: index + 1 },
		);
	}
	const category = await seed(
		"api::page-category.page-category",
		{ slug: "demo-rehber" },
		{
			slug: "demo-rehber",
			title: "Demo Rehber",
		},
	);
	const page = await seed(
		"api::page.page",
		{ slug: "demo-yazilar" },
		{
			slug: "demo-yazilar",
			title: "Demo Yazılar",
			pageType: "Bloglar",
			page_category: category.documentId,
		},
	);
	const videoPage = await seed(
		"api::page.page",
		{ slug: "demo-videolar" },
		{
			slug: "demo-videolar",
			title: "Demo Videolar",
			pageType: "Videolar",
			page_category: category.documentId,
		},
	);
	const scoresPage = await seed(
		"api::page.page",
		{ slug: "demo-taban-puanlari" },
		{
			slug: "demo-taban-puanlari",
			title: "Demo Taban Puanları",
			pageType: "Üniversite Taban Puanları",
			page_category: category.documentId,
		},
	);
	const university = await seed(
		"api::university.university",
		{ slug: "demo-universite" },
		{
			slug: "demo-universite",
			title: "Demo Üniversitesi",
			description: "Kurgusal üniversite.",
			image: cover,
		},
	);
	const department = await seed(
		"api::department.department",
		{ titile: "Demo Matematik Bölümü" },
		{
			titile: "Demo Matematik Bölümü",
			content: blocks("Kurgusal bölüm tanıtımı."),
			image: cover,
		},
	);
	await seed(
		"api::admission-score.admission-score",
		{ slug: "demo-matematik-taban-puani" },
		{
			slug: "demo-matematik-taban-puani",
			title: "Demo Matematik Taban Puanı",
			content: blocks("Bu puan test için üretilmiştir."),
			tableData: "Yıl,Taban Puanı\n2026,350",
			university: university.documentId,
			department: department.documentId,
			page: scoresPage.documentId,
		},
	);
	await seed(
		"api::blog.blog",
		{ slug: "demo-calisma-plani" },
		{
			slug: "demo-calisma-plani",
			title: "Demo: Haftalık Çalışma Planı",
			category: "Lise",
			content: blocks("Her gün kısa bir tekrar ve haftalık bir quiz planla."),
			image: cover,
			page: page.documentId,
		},
	);
	await seed(
		"api::video.video",
		{ slug: "demo-kesir-videosu" },
		{
			slug: "demo-kesir-videosu",
			title: "Demo Kesir Videosu",
			href: "https://www.youtube.com/watch?v=DnFrOetuUKg",
			page: videoPage.documentId,
		},
	);
	await seed(
		"api::tutoring-profile.tutoring-profile",
		{ name: "Demo Eğitmen" },
		{
			name: "Demo Eğitmen",
			slug: "demo-egitmen",
			title: "Matematik Eğitmeni",
			phone: "0555 000 00 00",
			price: 500,
			studentCount: 24,
			exprienceYears: 4,
			content: blocks("Kurgusal eğitmen profili."),
			profilePicture: cover,
		},
	);
	// ─── Mock exam demo: topics, one LGS exam, home slides ─────────────────────
	const lgsGrade = await seed(
		"api::grade.grade",
		{ slug: "demo-8-sinif-lgs" },
		{ slug: "demo-8-sinif-lgs", title: "Demo 8. Sınıf (LGS)" },
	);
	const topic = (slug: string, ad: string, lessons: string[] = []) =>
		seed(
			"api::konu.konu",
			{ slug },
			{
				slug,
				ad,
				ders: subject.documentId,
				siniflar: [lgsGrade.documentId],
				dersVideolari: lessons,
			},
		);
	const carpanlar = await topic("carpanlar-ve-katlar", "Çarpanlar ve Katlar");
	const usluIfadeler = await topic("uslu-ifadeler", "Üslü İfadeler");
	const karekoklu = await topic("karekoklu-ifadeler", "Kareköklü İfadeler");
	const kesirler = await topic("kesirlerle-islemler", "Kesirlerle İşlemler", [
		lesson.documentId,
		videoLesson.documentId,
	]);
	const question = (
		konu: { documentId: string },
		metin: string,
		secenekler: string[],
		dogruSecenek: string,
		cozum: string,
	) => ({
		metin: blocks(metin),
		secenekler: secenekler.map((s) => ({ metin: s })),
		dogruSecenek,
		konu: konu.documentId,
		cozum: blocks(cozum),
	});
	await seed(
		"api::deneme.deneme",
		{ slug: "demo-lgs-matematik-deneme-1" },
		{
			slug: "demo-lgs-matematik-deneme-1",
			baslik: "Demo LGS Matematik Denemesi 1",
			aciklama:
				"Çarpanlar ve katlar, üslü ifadeler, kareköklü ifadeler ve kesirler. 10 soru, 20 dakika.",
			sinavTuru: "LGS",
			sinif: lgsGrade.documentId,
			ders: subject.documentId,
			konular: [
				carpanlar.documentId,
				usluIfadeler.documentId,
				karekoklu.documentId,
				kesirler.documentId,
			],
			sureDakika: 20,
			oneCikan: true,
			sorular: [
				question(
					carpanlar,
					"36 sayısının pozitif tam sayı çarpanlarının sayısı kaçtır?",
					["6", "8", "9", "12"],
					"C",
					"1, 2, 3, 4, 6, 9, 12, 18, 36: 9 çarpan.",
				),
				question(
					carpanlar,
					"24 ve 36 sayılarının en büyük ortak böleni (EBOB) kaçtır?",
					["6", "8", "12", "18"],
					"C",
					"24 = 2³·3, 36 = 2²·3² → EBOB = 2²·3 = 12.",
				),
				question(
					carpanlar,
					"6 ve 8 sayılarının en küçük ortak katı (EKOK) kaçtır?",
					["12", "24", "36", "48"],
					"B",
					"6 = 2·3, 8 = 2³ → EKOK = 2³·3 = 24.",
				),
				question(
					usluIfadeler,
					"2³ · 2⁴ işleminin sonucu aşağıdakilerden hangisidir?",
					["2⁷", "2¹²", "4⁷", "4¹²"],
					"A",
					"Tabanlar aynı, üsler toplanır: 2³⁺⁴ = 2⁷.",
				),
				question(
					usluIfadeler,
					"(−3)² − 3² işleminin sonucu kaçtır?",
					["−18", "0", "9", "18"],
					"B",
					"(−3)² = 9, 3² = 9 → 9 − 9 = 0.",
				),
				question(
					usluIfadeler,
					"0,00045 sayısının bilimsel gösterimi aşağıdakilerden hangisidir?",
					["4,5 · 10⁻⁴", "45 · 10⁻⁵", "4,5 · 10⁻⁵", "0,45 · 10⁻³"],
					"A",
					"Katsayı 1 ile 10 arasında olmalı: 4,5 · 10⁻⁴.",
				),
				question(
					karekoklu,
					"√48 ifadesinin a√b biçiminde yazılışı aşağıdakilerden hangisidir?",
					["2√12", "4√3", "3√4", "6√2"],
					"B",
					"48 = 16 · 3 → √48 = 4√3.",
				),
				question(
					karekoklu,
					"√2 · √8 işleminin sonucu kaçtır?",
					["4", "8", "√10", "16"],
					"A",
					"√2 · √8 = √16 = 4.",
				),
				question(
					karekoklu,
					"Aşağıdaki sayılardan hangisi 7 ile 8 arasındadır?",
					["√45", "√50", "√65", "√70"],
					"B",
					"49 < 50 < 64 olduğundan 7 < √50 < 8.",
				),
				question(
					kesirler,
					"1/2 + 1/4 işleminin sonucu kaçtır?",
					["2/6", "3/4", "1/8", "2/4"],
					"B",
					"Paydalar eşitlenir: 2/4 + 1/4 = 3/4.",
				),
			],
			SEO: {
				metaTitle: "Demo LGS Matematik Denemesi 1 – Ücretsiz Çöz | KetaLearn",
				metaDescription: "Kayıt olmadan ücretsiz LGS matematik denemesi çöz, netini hemen gör.",
			},
		},
	);
	await seed(
		"api::anasayfa-slayti.anasayfa-slayti",
		{ baslik: "Ücretsiz derslerle kendi hızında öğren." },
		{
			baslik: "Ücretsiz derslerle kendi hızında öğren.",
			altMetin: "Ders videolarını izle, ilerlemeni takip et ve öğrendiklerini quizlerle pekiştir.",
			butonYazisi: "Dersleri keşfet",
			link: "/kurslar",
			sira: 1,
			aktif: true,
		},
	);
	await seed(
		"api::anasayfa-slayti.anasayfa-slayti",
		{ baslik: "Ücretsiz deneme çöz, eksiklerini gör." },
		{
			baslik: "Ücretsiz deneme çöz, eksiklerini gör.",
			altMetin: "Kayıt olmadan LGS ve 9. sınıf matematik denemelerini çöz, netini hemen öğren.",
			butonYazisi: "Denemeleri gör",
			link: "/deneme-sinavlari",
			sira: 2,
			aktif: true,
		},
	);
	await seed(
		"api::setting.setting",
		{},
		{ siteName: "KetaLearn", defaultSEODescription: "KetaLearn geliştirme ortamı." },
	);
	await seed(
		"api::contact-page.contact-page",
		{},
		{ email: "demo@ketalearn.test", address: "Demo adresi" },
	);
	await seed(
		"api::privacy-policy.privacy-policy",
		{},
		{ text: blocks("Geliştirme ortamı için örnek gizlilik metni.") },
	);
	await seed(
		"api::term-and-condition.term-and-condition",
		{},
		{ text: blocks("Geliştirme ortamı için örnek kullanım koşulları.") },
	);

	const roles = strapi.db.query("plugin::users-permissions.role");
	const authenticated = await roles.findOne({ where: { type: "authenticated" } });
	const publicRole = await roles.findOne({ where: { type: "public" } });
	const permission = strapi.db.query("plugin::users-permissions.permission");
	const catalog = [
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
	for (const role of [authenticated, publicRole]) {
		for (const name of catalog) {
			for (const method of ["find", "findOne"]) {
				const action = `api::${name}.${name}.${method}`;
				if (!(await permission.findOne({ where: { action, role: role.id } }))) {
					await permission.create({ data: { action, role: role.id } });
				}
			}
		}
	}
	const loginAction = "plugin::users-permissions.auth.callback";
	if (!(await permission.findOne({ where: { action: loginAction, role: publicRole.id } }))) {
		await permission.create({ data: { action: loginAction, role: publicRole.id } });
	}
	const profileAction = "plugin::users-permissions.user.me";
	if (!(await permission.findOne({ where: { action: profileAction, role: authenticated.id } }))) {
		await permission.create({ data: { action: profileAction, role: authenticated.id } });
	}

	const learners = strapi.db.query("plugin::users-permissions.user");
	const email = "demo-learner@ketalearn.test";
	const learner =
		(await learners.findOne({ where: { email } })) ??
		(await strapi.plugin("users-permissions").service("user").add({
			email,
			username: "keta-demo-learner",
			password: "KetaDemo!2026",
			confirmed: true,
			provider: "local",
			role: authenticated.id,
		}));
	const timestamp = "2026-01-01T12:00:00.000Z";
	const publishedLesson = await strapi
		.documents("api::lesson.lesson")
		.findOne({ documentId: lesson.documentId, status: "published" });
	const publishedCourse = await strapi
		.documents("api::course.course")
		.findOne({ documentId: course.documentId, status: "published" });
	const publishedQuiz = await strapi
		.documents("api::quiz.quiz")
		.findOne({ documentId: quiz.documentId, status: "published" });
	const lessonKey = `${learner.id}_${lesson.documentId}`;
	const courseKey = `${learner.id}_${course.documentId}`;
	const quizKey = `${learner.id}_${quiz.documentId}_demo`;
	await seed(
		"api::lesson-progress.lesson-progress",
		{ user_plus_lesson_id: lessonKey },
		{
			learner: learner.documentId,
			lesson: publishedLesson.documentId,
			user_plus_lesson_id: lessonKey,
			isCompleted: true,
			completedAt: timestamp,
		},
	);
	await seed(
		"api::user-course-progress.user-course-progress",
		{ user_plus_course_id: courseKey },
		{
			learner: learner.documentId,
			course: publishedCourse.documentId,
			user_plus_course_id: courseKey,
			course_status: "in_progress",
		},
	);
	await seed(
		"api::quiz-progress.quiz-progress",
		{ user_plus_quiz_id: quizKey },
		{
			learner: learner.documentId,
			quiz: publishedQuiz.documentId,
			user_plus_quiz_id: quizKey,
			quiz_status: "completed",
			score: 1,
			completedAt: timestamp,
			result: {
				correctAnswers: 1,
				totalQuestions: 2,
				earnedPoints: 1,
				totalPoints: 2,
				percentage: 50,
				passed: false,
				attempts: [],
			},
		},
	);
	strapi.log.info("KetaLearn demo data is ready.");
}

import type { Core, UID } from "@strapi/strapi";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const blocks = (text: string) => [{ type: "paragraph", children: [{ type: "text", text }] }];

export async function seedDevelopment(strapi: Core.Strapi) {
  if (process.env.DATABASE_HOST !== "db" || process.env.UPLOAD_PROVIDER !== "local") {
    throw new Error("Demo data requires the local Docker database and uploads.");
  }

  async function seed(uid: UID.ContentType, match: Record<string, unknown>, data: Record<string, unknown>) {
    const documents = strapi.documents(uid);
    const published = strapi.contentTypes[uid].options?.draftAndPublish;
    const options = published ? { status: "published" as const } : {};
    if (strapi.contentTypes[uid].kind === "singleType") {
      const existing = await documents.findFirst();
      return existing ?? documents.create({ data, ...options });
    }
    const existing = await documents.findFirst({ filters: match });
    return existing ?? documents.create({ data, ...options });
  }

  const upload = async (name: string, mime: string, bytes: Buffer) => {
    const existing = await strapi.db.query("plugin::upload.file").findOne({ where: { name } });
    if (existing) return existing.id;
    const directory = await mkdtemp(join(tmpdir(), "keta-seed-"));
    try {
      const filepath = join(directory, name);
      await writeFile(filepath, bytes);
      const [file] = await strapi.plugin("upload").service("upload").upload({
        data: { fileInfo: { name, alternativeText: "KetaLearn demo" } },
        files: { filepath, originalFilename: name, mimetype: mime, size: bytes.length },
      });
      return file.id;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };

  const cover = await upload("keta-demo-cover.png", "image/png", Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ2QAAAAASUVORK5CYII=", "base64",
  ));
  const notes = await upload("keta-demo-alistirma.txt", "text/plain",
    Buffer.from("KetaLearn demo: 1/2 + 1/4 toplamını bulun.\n"));
  const subject = await seed("api::subject.subject", { slug: "demo-matematik" }, {
    slug: "demo-matematik", title: "Demo Matematik", description: "KetaLearn örnek konu kataloğu.",
  });
  const grade = await seed("api::grade.grade", { slug: "demo-9-sinif" }, {
    slug: "demo-9-sinif", title: "Demo 9. Sınıf",
  });
  const course = await seed("api::course.course", { slug: "demo-kesirler" }, {
    slug: "demo-kesirler", title: "Demo: Kesirlerle İşlemler",
    description: "Kesirleri karşılaştır, topla ve kısa bir quizle öğrendiklerini kontrol et.",
    thumbnail: cover, image: cover, subject: subject.documentId, grades: [grade.documentId],
    duration: 30, isPopular: true,
  });
  const quiz = await seed("api::quiz.quiz", { title: "Demo: Kesirler Quizi" }, {
    title: "Demo: Kesirler Quizi", description: "İki kısa soruyla bilgini kontrol et.",
    questions: [
      { type: "multipleChoice", order: 1, text: blocks("1/2 + 1/4 kaçtır?"),
        explanation: blocks("Paydaları eşitle: 2/4 + 1/4 = 3/4."),
        options: [{ text: "3/4", isCorrect: true, order: 1 }, { text: "2/6", order: 2 }] },
      { type: "trueFalse", order: 2, text: blocks("2/4 ile 1/2 eşittir."),
        explanation: blocks("2/4 kesrini 2 ile sadeleştirince 1/2 elde edilir."),
        options: [{ text: "Doğru", isCorrect: true, order: 1 }, { text: "Yanlış", order: 2 }] },
    ],
  });
  const lesson = await seed("api::lesson.lesson", { slug: "demo-payda-esitleme" }, {
    slug: "demo-payda-esitleme", title: "Demo: Payda Eşitleme", description: "Kesirleri aynı paydada yaz.",
    content: blocks("1/2 kesrini 2/4 olarak yazabiliriz. Artık 1/4 ile topladığımızda sonuç 3/4 olur."),
    attachments: [notes], quiz: quiz.documentId,
  });
  const videoLesson = await seed("api::lesson.lesson", { slug: "demo-kesirleri-gorsellestirme" }, {
    slug: "demo-kesirleri-gorsellestirme", title: "Demo: Kesirleri Görselleştirme",
    description: "Kesirleri sayı doğrusunda incele.", videoURL: "https://www.youtube.com/watch?v=DnFrOetuUKg",
    content: blocks("Bir bütünü eş parçalara ayır ve parçaları karşılaştır."),
  });
  for (const [index, item] of [lesson, videoLesson].entries()) {
    await seed("api::course-lesson.course-lesson",
      { course: { documentId: course.documentId }, lesson: { documentId: item.documentId } },
      { course: course.documentId, lesson: item.documentId, order: index + 1 });
  }
  const category = await seed("api::page-category.page-category", { slug: "demo-rehber" }, {
    slug: "demo-rehber", title: "Demo Rehber",
  });
  const page = await seed("api::page.page", { slug: "demo-yazilar" }, {
    slug: "demo-yazilar", title: "Demo Yazılar", pageType: "Bloglar", page_category: category.documentId,
  });
  const videoPage = await seed("api::page.page", { slug: "demo-videolar" }, {
    slug: "demo-videolar", title: "Demo Videolar", pageType: "Videolar", page_category: category.documentId,
  });
  const scoresPage = await seed("api::page.page", { slug: "demo-taban-puanlari" }, {
    slug: "demo-taban-puanlari", title: "Demo Taban Puanları", pageType: "Üniversite Taban Puanları", page_category: category.documentId,
  });
  const university = await seed("api::university.university", { slug: "demo-universite" }, {
    slug: "demo-universite", title: "Demo Üniversitesi", description: "Kurgusal üniversite.", image: cover,
  });
  const department = await seed("api::department.department", { titile: "Demo Matematik Bölümü" }, {
    titile: "Demo Matematik Bölümü", content: blocks("Kurgusal bölüm tanıtımı."), image: cover,
  });
  await seed("api::admission-score.admission-score", { slug: "demo-matematik-taban-puani" }, {
    slug: "demo-matematik-taban-puani", title: "Demo Matematik Taban Puanı",
    content: blocks("Bu puan test için üretilmiştir."), tableData: "Yıl,Taban Puanı\n2026,350",
    university: university.documentId, department: department.documentId, page: scoresPage.documentId,
  });
  await seed("api::blog.blog", { slug: "demo-calisma-plani" }, {
    slug: "demo-calisma-plani", title: "Demo: Haftalık Çalışma Planı", category: "Lise",
    content: blocks("Her gün kısa bir tekrar ve haftalık bir quiz planla."), image: cover, page: page.documentId,
  });
  await seed("api::video.video", { slug: "demo-kesir-videosu" }, {
    slug: "demo-kesir-videosu", title: "Demo Kesir Videosu", href: "https://www.youtube.com/watch?v=DnFrOetuUKg", page: videoPage.documentId,
  });
  await seed("api::tutoring-profile.tutoring-profile", { name: "Demo Eğitmen" }, {
    name: "Demo Eğitmen", slug: "demo-egitmen", title: "Matematik Eğitmeni", phone: "0555 000 00 00", price: 500,
    studentCount: 24, exprienceYears: 4, content: blocks("Kurgusal eğitmen profili."), profilePicture: cover,
  });
  await seed("api::setting.setting", {}, { siteName: "KetaLearn", defaultSEODescription: "KetaLearn geliştirme ortamı." });
  await seed("api::contact-page.contact-page", {}, { email: "demo@ketalearn.test", address: "Demo adresi" });
  await seed("api::privacy-policy.privacy-policy", {}, { text: blocks("Geliştirme ortamı için örnek gizlilik metni.") });
  await seed("api::term-and-condition.term-and-condition", {}, { text: blocks("Geliştirme ortamı için örnek kullanım koşulları.") });

  const roles = strapi.db.query("plugin::users-permissions.role");
  const authenticated = await roles.findOne({ where: { type: "authenticated" } });
  const publicRole = await roles.findOne({ where: { type: "public" } });
  const permission = strapi.db.query("plugin::users-permissions.permission");
  const catalog = [
    "admission-score", "blog", "contact-page", "course", "course-lesson", "department", "grade",
    "lesson", "page", "page-category", "privacy-policy", "quiz", "setting", "subject",
    "term-and-condition", "tutoring-profile", "university", "video",
  ];
  for (const role of [authenticated, publicRole]) {
    for (const name of catalog) {
      for (const method of ["find", "findOne"]) {
        const action = "api::" + name + "." + name + "." + method;
        if (!await permission.findOne({ where: { action, role: role.id } })) {
          await permission.create({ data: { action, role: role.id } });
        }
      }
    }
  }
  const loginAction = "plugin::users-permissions.auth.callback";
  if (!await permission.findOne({ where: { action: loginAction, role: publicRole.id } })) {
    await permission.create({ data: { action: loginAction, role: publicRole.id } });
  }
  const profileAction = "plugin::users-permissions.user.me";
  if (!await permission.findOne({ where: { action: profileAction, role: authenticated.id } })) {
    await permission.create({ data: { action: profileAction, role: authenticated.id } });
  }

  const learners = strapi.db.query("plugin::users-permissions.user");
  const email = "demo-learner@ketalearn.test";
  const learner = await learners.findOne({ where: { email } }) ??
    await strapi.plugin("users-permissions").service("user").add({
      email, username: "keta-demo-learner", password: "KetaDemo!2026", confirmed: true,
      provider: "local", role: authenticated.id,
    });
  const timestamp = "2026-01-01T12:00:00.000Z";
  const publishedLesson = await strapi.documents("api::lesson.lesson").findOne({ documentId: lesson.documentId, status: "published" });
  const publishedCourse = await strapi.documents("api::course.course").findOne({ documentId: course.documentId, status: "published" });
  const publishedQuiz = await strapi.documents("api::quiz.quiz").findOne({ documentId: quiz.documentId, status: "published" });
  const lessonKey = learner.id + "_" + lesson.documentId;
  const courseKey = learner.id + "_" + course.documentId;
  const quizKey = learner.id + "_" + quiz.documentId + "_demo";
  await seed("api::lesson-progress.lesson-progress", { user_plus_lesson_id: lessonKey }, {
    learner: learner.documentId, lesson: publishedLesson.documentId, user_plus_lesson_id: lessonKey, isCompleted: true, completedAt: timestamp,
  });
  await seed("api::user-course-progress.user-course-progress", { user_plus_course_id: courseKey }, {
    learner: learner.documentId, course: publishedCourse.documentId, user_plus_course_id: courseKey, course_status: "in_progress",
  });
  await seed("api::quiz-progress.quiz-progress", { user_plus_quiz_id: quizKey }, {
    learner: learner.documentId, quiz: publishedQuiz.documentId, user_plus_quiz_id: quizKey,
    quiz_status: "completed", score: 1, completedAt: timestamp,
    result: { correctAnswers: 1, totalQuestions: 2, earnedPoints: 1, totalPoints: 2, percentage: 50, passed: false, attempts: [] },
  });
  strapi.log.info("KetaLearn demo data is ready.");
}

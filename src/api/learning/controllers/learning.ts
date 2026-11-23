const lessonProgress = "api::lesson-progress.lesson-progress";
const courseProgress = "api::user-course-progress.user-course-progress";
const quizProgress = "api::quiz-progress.quiz-progress";

async function updateProgress(uid: typeof lessonProgress | typeof courseProgress, keyField: string, key: string, data: Record<string, unknown>) {
  await strapi.db.transaction(async ({ trx }) => {
    await trx.raw("select pg_advisory_xact_lock(hashtext(?))", [uid + ":" + key]);
    const query = strapi.db.query(uid);
    const existing = await query.findOne({ where: { [keyField]: key } });
    if (existing) {
      await query.update({ where: { id: existing.id }, data });
    } else {
      await query.create({ data: { ...data, [keyField]: key } });
    }
  });
}

export default {
  async listLessons(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();
    const prefix = user.id + "_";
    const rows = await strapi.db.query(lessonProgress).findMany({
      where: { $or: [
        { learner: { id: user.id } },
        { learner: { id: { $null: true } }, user_plus_lesson_id: { $startsWith: prefix } },
      ] },
      populate: { lesson: true },
    });
    ctx.body = { data: rows.filter(row => row.user_plus_lesson_id.startsWith(prefix)).map(row => ({
      documentId: row.lesson?.documentId ?? row.user_plus_lesson_id.slice(prefix.length),
      isCompleted: row.isCompleted,
    })) };
  },

  async completeLesson(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();
    const documentId = ctx.params.documentId;
    const lesson = await strapi.documents("api::lesson.lesson").findOne({ documentId, status: "published" });
    if (!lesson) return ctx.notFound();
    const isCompleted = ctx.request.body?.isCompleted;
    if (typeof isCompleted !== "boolean") return ctx.badRequest("isCompleted must be a boolean");

    await updateProgress(lessonProgress, "user_plus_lesson_id", user.id + "_" + documentId, {
      learner: user.id, lesson: lesson.id, isCompleted, completedAt: isCompleted ? new Date().toISOString() : null,
    });
    ctx.body = { data: { documentId, isCompleted } };
  },

  async courseProgress(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();
    const documentId = ctx.params.documentId;
    const course = await strapi.documents("api::course.course").findOne({ documentId, status: "published" });
    if (!course) return ctx.notFound();

    const links = await strapi.db.query("api::course-lesson.course-lesson").findMany({
      where: { course: { documentId }, lesson: { publishedAt: { $notNull: true } } },
      populate: { lesson: { populate: { quiz: true } } },
    });
    const lessonIds = [...new Set(links.map(link => link.lesson.documentId))];
    const quizIds = [...new Set(links.flatMap(link => link.lesson.quiz ? [link.lesson.quiz.documentId] : []))];
    const rows = lessonIds.length ? await strapi.db.query(lessonProgress).findMany({
      where: { user_plus_lesson_id: { $in: lessonIds.map(id => user.id + "_" + id) }, isCompleted: true },
    }) : [];
    const key = user.id + "_" + documentId;
    const previous = await strapi.db.query(courseProgress).findOne({ where: { user_plus_course_id: key } });
    const status = lessonIds.length && rows.length === lessonIds.length ? "completed"
      : rows.length || previous?.course_status === "in_progress" ? "in_progress" : "not_started";
    const lastAttempt = quizIds.length ? await strapi.db.query(quizProgress).findOne({
      where: { learner: { id: user.id }, quiz: { documentId: { $in: quizIds } }, quiz_status: "completed" },
      orderBy: [{ completedAt: "desc" }, { id: "desc" }],
    }) : null;
    ctx.body = { data: {
      documentId, status, completedLessons: rows.length, totalLessons: lessonIds.length,
      lastQuizPercentage: lastAttempt?.result?.percentage ?? null,
    } };
  },

  // Records that the user started a course (idempotent; never downgrades a completed course).
  async startCourse(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();
    const documentId = ctx.params.documentId;
    const course = await strapi.documents("api::course.course").findOne({ documentId, status: "published" });
    if (!course) return ctx.notFound();

    const key = user.id + "_" + documentId;
    const status = await strapi.db.transaction(async ({ trx }) => {
      await trx.raw("select pg_advisory_xact_lock(hashtext(?))", [courseProgress + ":" + key]);
      const query = strapi.db.query(courseProgress);
      const existing = await query.findOne({ where: { user_plus_course_id: key } });
      if (!existing) {
        await query.create({ data: {
          user_plus_course_id: key, learner: user.id, course: course.id, course_status: "in_progress",
        } });
        return "in_progress";
      }
      if (existing.course_status === "not_started") {
        await query.update({ where: { id: existing.id }, data: { course_status: "in_progress" } });
        return "in_progress";
      }
      return existing.course_status;
    });
    ctx.body = { data: { documentId, status } };
  },

  // Courses the user started, most recent first. Courses with a completed lesson but no start
  // record (progress from before start records existed) are included as well.
  async listCourses(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const started = await strapi.db.query(courseProgress).findMany({
      where: { learner: { id: user.id } },
      populate: { course: { select: ["documentId"] } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });
    const courses = new Map<string, string>();
    for (const row of started) {
      if (row.course?.documentId) courses.set(row.course.documentId, row.course_status);
    }

    // Same matching as listLessons: older rows only carry the user in their key.
    const prefix = user.id + "_";
    const completed = await strapi.db.query(lessonProgress).findMany({
      where: { isCompleted: true, $or: [
        { learner: { id: user.id } },
        { learner: { id: { $null: true } }, user_plus_lesson_id: { $startsWith: prefix } },
      ] },
      populate: { lesson: { select: ["documentId"] } },
    });
    const lessonIds = [...new Set(completed
      .filter(row => row.user_plus_lesson_id.startsWith(prefix))
      .map(row => row.lesson?.documentId ?? row.user_plus_lesson_id.slice(prefix.length)))];
    if (lessonIds.length) {
      const links = await strapi.db.query("api::course-lesson.course-lesson").findMany({
        where: { lesson: { documentId: { $in: lessonIds } } },
        populate: { course: { select: ["documentId"] } },
      });
      for (const link of links) {
        const id = link.course?.documentId;
        if (id && !courses.has(id)) courses.set(id, "in_progress");
      }
    }

    ctx.body = { data: [...courses].map(([documentId, status]) => ({ documentId, status })) };
  },

  async listAttempts(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();
    const rows = await strapi.db.query(quizProgress).findMany({
      where: { learner: { id: user.id }, quiz: { documentId: ctx.params.documentId }, quiz_status: "completed" },
      orderBy: { id: "desc" },
    });
    ctx.body = { data: rows.map(row => ({ completedAt: row.completedAt, score: row.score, result: row.result })) };
  },

  async submitQuiz(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();
    const { answers, submissionId } = ctx.request.body ?? {};
    if (!answers || typeof answers !== "object" || Array.isArray(answers) ||
        typeof submissionId !== "string" || !/^[0-9a-f-]{36}$/i.test(submissionId)) {
      return ctx.badRequest("Answers and a submission ID are required");
    }

    const documentId = ctx.params.documentId;
    const key = user.id + "_" + documentId + "_" + submissionId;
    const query = strapi.db.query(quizProgress);
    const result = await strapi.db.transaction(async ({ trx }) => {
      await trx.raw("select pg_advisory_xact_lock(hashtext(?))", [key]);
      const existing = await query.findOne({ where: { user_plus_quiz_id: key } });
      if (existing) return existing.result;

      const quiz = await strapi.documents("api::quiz.quiz").findOne({
        documentId, status: "published", populate: { questions: { populate: ["options"] } },
      });
      if (!quiz) {
        ctx.notFound();
        return null;
      }
      if (!quiz.questions?.length || Object.keys(answers).length !== quiz.questions.length) {
        ctx.badRequest("Answer every quiz question");
        return null;
      }

      const attempts = [];
      for (const question of quiz.questions) {
        const selected = question.options?.find(option => option.id === answers[question.id]);
        const correct = question.options?.find(option => option.isCorrect);
        if (!selected || !correct) {
          ctx.badRequest("Invalid quiz answers");
          return null;
        }
        const isCorrect = selected.id === correct.id;
        attempts.push({
          questionId: question.id, selectedAnswer: selected.text, correctAnswer: correct.text,
          isCorrect, points: isCorrect ? 1 : 0, explanation: question.explanation ?? [],
        });
      }
      const correctAnswers = attempts.filter(attempt => attempt.isCorrect).length;
      const totalQuestions = attempts.length;
      const percentage = correctAnswers / totalQuestions * 100;
      const result = {
        attempts, correctAnswers, totalQuestions, percentage, passed: percentage >= 70,
        totalPoints: totalQuestions, earnedPoints: correctAnswers,
      };
      await query.create({ data: {
        learner: user.id, quiz: quiz.id, user_plus_quiz_id: key, quiz_status: "completed",
        score: correctAnswers, result, completedAt: new Date().toISOString(),
      } });
      return result;
    });
    if (result) ctx.body = { data: result };
  },
};

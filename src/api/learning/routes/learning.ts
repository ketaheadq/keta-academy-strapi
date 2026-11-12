export default {
  routes: [
    { method: "GET", path: "/learning/lesson-progress", handler: "learning.listLessons" },
    { method: "PUT", path: "/learning/lesson-progress/:documentId", handler: "learning.completeLesson" },
    { method: "GET", path: "/learning/course-progress/:documentId", handler: "learning.courseProgress" },
    { method: "GET", path: "/learning/quizzes/:documentId/attempts", handler: "learning.listAttempts" },
    { method: "POST", path: "/learning/quizzes/:documentId/attempts", handler: "learning.submitQuiz" },
  ],
};

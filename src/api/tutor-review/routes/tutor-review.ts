// Custom routes only: reviews are read publicly and written by their author.
// "summary" must come before ":tutorDocumentId" so it isn't matched as an id.
export default {
  routes: [
    { method: "GET", path: "/tutor-reviews/summary", handler: "tutor-review.summary" },
    { method: "GET", path: "/tutor-reviews/:tutorDocumentId", handler: "tutor-review.list" },
    { method: "GET", path: "/tutor-reviews/:tutorDocumentId/mine", handler: "tutor-review.mine" },
    { method: "PUT", path: "/tutor-reviews/:tutorDocumentId", handler: "tutor-review.upsert" },
    { method: "DELETE", path: "/tutor-reviews/:tutorDocumentId", handler: "tutor-review.remove" },
  ],
};

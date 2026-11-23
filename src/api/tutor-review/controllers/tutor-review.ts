const reviewUid = "api::tutor-review.tutor-review";
const tutorUid = "api::tutoring-profile.tutoring-profile";

/** "ahmet.yilmaz" → "Ah***": usernames can be e-mail prefixes, so never show them in full. */
function maskName(username?: string | null) {
  const name = (username ?? "").trim();
  return name ? name.slice(0, 2) + "***" : "Üye";
}

function summarize(ratings: number[]) {
  const count = ratings.length;
  const average = count ? ratings.reduce((sum, r) => sum + r, 0) / count : 0;
  return {
    count,
    average: Math.round(average * 10) / 10,
    // Memnuniyet oranı: average rating as a percentage of 5 stars.
    satisfaction: count ? Math.round((average / 5) * 100) : null,
  };
}

async function publishedTutor(documentId: string) {
  return strapi.documents(tutorUid).findOne({ documentId, status: "published", fields: ["name"] });
}

export default {
  // Rating summary for every tutor: [{ tutorDocumentId, count, average, satisfaction }]
  async summary(ctx) {
    const rows = await strapi.db.query(reviewUid).findMany({ select: ["tutorDocumentId", "rating"] });
    const byTutor = new Map<string, number[]>();
    for (const row of rows) {
      byTutor.set(row.tutorDocumentId, [...(byTutor.get(row.tutorDocumentId) ?? []), row.rating]);
    }
    ctx.body = { data: [...byTutor].map(([tutorDocumentId, ratings]) => ({ tutorDocumentId, ...summarize(ratings) })) };
  },

  // Public list of a tutor's reviews (newest first) plus the summary.
  async list(ctx) {
    const { tutorDocumentId } = ctx.params;
    const rows = await strapi.db.query(reviewUid).findMany({
      where: { tutorDocumentId },
      populate: { author: { select: ["username"] } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });
    ctx.body = {
      data: rows.slice(0, 50).map(row => ({
        rating: row.rating,
        comment: row.comment ?? "",
        author: maskName(row.author?.username),
        updatedAt: row.updatedAt,
      })),
      meta: summarize(rows.map(row => row.rating)),
    };
  },

  async mine(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();
    const row = await strapi.db.query(reviewUid).findOne({
      where: { user_plus_tutor_id: user.id + "_" + ctx.params.tutorDocumentId },
    });
    ctx.body = { data: row ? { rating: row.rating, comment: row.comment ?? "" } : null };
  },

  // Create or update the signed-in member's review of a tutor (one per member per tutor).
  async upsert(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();
    const { tutorDocumentId } = ctx.params;
    const { rating, comment } = ctx.request.body ?? {};
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return ctx.badRequest("rating must be an integer between 1 and 5");
    }
    if (comment !== undefined && comment !== null && typeof comment !== "string") {
      return ctx.badRequest("comment must be a string");
    }
    const text = (comment ?? "").trim();
    if (text.length > 1000) return ctx.badRequest("comment must be at most 1000 characters");
    if (!(await publishedTutor(tutorDocumentId))) return ctx.notFound();

    const key = user.id + "_" + tutorDocumentId;
    await strapi.db.transaction(async ({ trx }) => {
      await trx.raw("select pg_advisory_xact_lock(hashtext(?))", [reviewUid + ":" + key]);
      const query = strapi.db.query(reviewUid);
      const existing = await query.findOne({ where: { user_plus_tutor_id: key } });
      const data = { rating, comment: text || null };
      if (existing) {
        await query.update({ where: { id: existing.id }, data });
      } else {
        await query.create({ data: { ...data, tutorDocumentId, author: user.id, user_plus_tutor_id: key } });
      }
    });
    ctx.body = { data: { rating, comment: text } };
  },

  async remove(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();
    await strapi.db.query(reviewUid).delete({
      where: { user_plus_tutor_id: user.id + "_" + ctx.params.tutorDocumentId },
    });
    ctx.body = { data: null };
  },
};

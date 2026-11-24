import { factories } from "@strapi/strapi";

// Read-only for the site; slides are managed in the admin panel.
export default factories.createCoreRouter("api::anasayfa-slayti.anasayfa-slayti", {
	only: ["find", "findOne"],
});

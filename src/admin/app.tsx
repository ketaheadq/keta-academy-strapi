import type { StrapiApp } from "@strapi/strapi/admin";
import { PhoneIcon } from "./widgets/phone-icon";

export default {
	config: {
		locales: ["tr"],
	},
	register(app: StrapiApp) {
		// Admin home: the teacher's call list (deneme report requests) and lessons without a topic.
		app.widgets.register({
			id: "deneme-panel",
			icon: PhoneIcon,
			title: { id: "deneme-panel.title", defaultMessage: "Deneme raporları ve arama listesi" },
			component: async () => {
				const { DenemePanelWidget } = await import("./widgets/deneme-panel-widget");
				return DenemePanelWidget;
			},
		});
	},
	bootstrap() {},
};

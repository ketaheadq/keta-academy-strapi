import type { Core, UID } from "@strapi/strapi";

/**
 * Single types the public site reads on every request. Unlike the demo seeds
 * this runs in every environment and is not opt-in: with `draftAndPublish` on,
 * a missing or unpublished entry makes `GET /api/setting` answer 404, which
 * silently drops the whole site back to hardcoded metadata.
 *
 * Existing entries are never overwritten — it only creates what is absent and
 * publishes what was left as a draft, so an editor's changes survive restarts.
 */

const SITE_NAME = "KetaLearn";
const SUPPORT_EMAIL = "destek@ketaacademy.com";
const SEO_DESCRIPTION =
	"Öğrencilere üniversite sınavında başarı için tüm derslerde konu anlatımları, güncel taban-tavan puanları, bloglar ve yayınlar sunan etkileşimli eğitim platformu";

// Mirrors the fallbacks the frontend already renders, so publishing these
// changes where the values come from, not what visitors see.
const CONTACT = {
	phone: "05451304287",
	email: "caglar_yildiz@outlook.com.tr",
	address: "Keklikpınarı Mah. 913. sok.",
};

/** Strapi blocks: one paragraph per block, which is how the frontend re-joins them. */
const paragraphs = (...texts: string[]) =>
	texts.map((text) => ({ type: "paragraph", children: [{ type: "text", text }] }));

const PRIVACY_PLACEHOLDER = paragraphs(
	"KetaLearn olarak kişisel verilerinizin gizliliğine önem veriyoruz. Bu politika, platformu kullanırken hangi verileri topladığımızı ve bunları nasıl işlediğimizi açıklar.",
	"Toplanan veriler: hesap oluştururken verdiğiniz ad, e-posta ve şifre bilgileri; öğrenme ilerlemeniz (tamamlanan dersler, quiz sonuçları); ve site trafiğini ölçmek için kullanılan çerezler.",
	"Verilerinizi üçüncü taraflara satmıyoruz. Yalnızca hizmeti yürütmek için zorunlu olan altyapı sağlayıcılarıyla (barındırma, e-posta gönderimi) paylaşıyoruz.",
	`6698 sayılı KVKK kapsamında verilerinize erişme, bunları düzeltme ve silinmesini isteme hakkınız vardır. Talepleriniz için ${SUPPORT_EMAIL} adresine yazabilirsiniz.`,
	"Bu metin bir taslaktır. Yayına almadan önce hukuki incelemenizden geçirin ve Strapi yönetim panelinde Content Manager → Privacy Policy altından güncelleyin.",
);

const TERMS_PLACEHOLDER = paragraphs(
	"KetaLearn platformuna üye olarak bu koşulları kabul etmiş sayılırsınız.",
	"Hesabınızın güvenliğinden siz sorumlusunuz. Şifrenizi kimseyle paylaşmayın ve hesabınız üzerinden yapılan işlemleri takip edin.",
	"Platformdaki ders videoları, quizler ve yazılı içerikler KetaLearn'e aittir; izinsiz kopyalanamaz, çoğaltılamaz veya yeniden yayınlanamaz.",
	"Hizmeti kötüye kullanan (diğer kullanıcıları rahatsız eden, içerikleri izinsiz dağıtan) hesaplar uyarı yapılmaksızın askıya alınabilir.",
	`Sorularınız için ${SUPPORT_EMAIL} adresinden bize ulaşabilirsiniz.`,
	"Bu metin bir taslaktır. Yayına almadan önce hukuki incelemenizden geçirin ve Strapi yönetim panelinde Content Manager → Term And Condition altından güncelleyin.",
);

type Action = "created" | "published" | "unchanged";

async function ensureSingleType(
	strapi: Core.Strapi,
	uid: UID.ContentType,
	data: Record<string, unknown>,
): Promise<Action> {
	const documents = strapi.documents(uid);
	const publishable = Boolean(strapi.contentTypes[uid].options?.draftAndPublish);

	const existing = await documents.findFirst();
	if (!existing) {
		await documents.create({
			data,
			...(publishable ? { status: "published" as const } : {}),
		});
		return "created";
	}
	// Saved as a draft in the admin but never published: REST still answers 404.
	if (publishable && !(await documents.findFirst({ status: "published" }))) {
		await documents.publish({ documentId: existing.documentId });
		return "published";
	}
	return "unchanged";
}

export async function seedSiteEssentials(strapi: Core.Strapi) {
	const entries: [UID.ContentType, Record<string, unknown>][] = [
		["api::setting.setting", { siteName: SITE_NAME, defaultSEODescription: SEO_DESCRIPTION }],
		["api::contact-page.contact-page", CONTACT],
		["api::privacy-policy.privacy-policy", { text: PRIVACY_PLACEHOLDER }],
		["api::term-and-condition.term-and-condition", { text: TERMS_PLACEHOLDER }],
	];

	const changes: string[] = [];
	for (const [uid, data] of entries) {
		const name = uid.split(".")[1];
		try {
			const action = await ensureSingleType(strapi, uid, data);
			if (action !== "unchanged") changes.push(`${name} (${action})`);
		} catch (error) {
			// One broken single type must not stop the server from booting.
			strapi.log.error(`Site essentials: could not prepare ${name}: ${String(error)}`);
		}
	}

	if (changes.length) {
		strapi.log.info(`✅ Site essentials ready: ${changes.join(", ")}`);
	}
}

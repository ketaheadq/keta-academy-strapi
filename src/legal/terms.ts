import type { Core } from "@strapi/strapi";
import { blocksToText } from "../deneme/text";

/**
 * Default "Hizmet Şartları" (terms of service) text. Written into the Term-and-condition single
 * type on start-up only when it has no text yet; once there is text (from here or the admin
 * panel), it is never overwritten. Edit the live text in the admin panel, not here.
 *
 * Format: "## " heading, "- " list item, anything else a paragraph; blank lines separate blocks.
 */
const TERMS = `
## 1. Taraflar ve kapsam
Bu Hizmet Şartları, ketalearn.cloud adresindeki KetaLearn web sitesini ve sunduğu hizmetleri ("Platform") kullanan herkes ("Kullanıcı") için geçerlidir. Platform'u kullanarak bu şartları okuduğunuzu ve kabul ettiğinizi beyan edersiniz. Şartları kabul etmiyorsanız Platform'u kullanmayınız.

## 2. Hizmetin tanımı
KetaLearn, ortaokul ve lise öğrencilerine yönelik çevrim içi bir eğitim platformudur. Platform'da şu hizmetler sunulur:
- Ücretsiz ders videoları, ders notları ve kurslar
- Konu quizleri ve kayıtlı kullanıcılar için ilerleme takibi
- Kayıt gerektirmeyen ücretsiz deneme sınavları ve istenirse kişiye özel PDF analiz raporu
- Özel ders veren öğretmenlerin tanıtım profilleri ve öğretmenlerle iletişim imkânı
KetaLearn, hizmetlerin kapsamını önceden bildirmeksizin değiştirme, yenilerini ekleme veya bir kısmını sonlandırma hakkını saklı tutar.

## 3. Üyelik
Ders içeriklerinin bir kısmı ve ilerleme takibi için üyelik gerekir. Üyelik e-posta adresiyle ya da Google hesabıyla oluşturulabilir.
- Kayıt sırasında verdiğiniz bilgilerin doğru ve güncel olmasından siz sorumlusunuz.
- Hesabınızın ve şifrenizin güvenliğini korumak sizin sorumluluğunuzdadır. Hesabınızla yapılan işlemler size ait kabul edilir.
- 18 yaşından küçük kullanıcılar Platform'u velisinin veya yasal temsilcisinin bilgisi ve onayıyla kullanır.
- Bu şartlara aykırı kullanım hâlinde KetaLearn hesabı askıya alabilir veya kapatabilir.
Hesabınızı kapatmak için iletişim sayfasındaki e-posta adresinden bize yazabilirsiniz.

## 4. Deneme sınavları ve analiz raporu
Deneme sınavları kayıt olmadan çözülebilir. Sınav sonucunuz (doğru, yanlış, boş ve net sayıları) Platform tarafından otomatik olarak hesaplanır.
- Ayrıntılı PDF analiz raporu, ad soyad ve telefon numarası paylaşılarak ve rapor için açık onay verilerek talep edilir. Rapor, size özel ve tahmin edilemeyen bir bağlantıyla açılır; bağlantıyı paylaştığınız herkes raporu görüntüleyebilir.
- Rapordaki değerlendirme notlarının bir kısmı yapay zekâ desteğiyle hazırlanır. Bu notlar yol gösterici niteliktedir; resmî bir sınav sonucu, not tahmini veya başarı garantisi değildir.
- Telefonla aranmayı ayrıca onayladıysanız, sonucunuzu değerlendirmek için sizi arayabiliriz. Bu onayı dilediğiniz zaman geri alabilirsiniz.
- Rapor talepleri ve sınav sonuçları belirli bir süre saklandıktan sonra silinir. Ayrıntılar Gizlilik Politikası'ndadır.

## 5. Özel ders
Platform, özel ders veren öğretmenlerin tanıtım profillerini yayımlar ve öğretmenlerle WhatsApp veya telefon üzerinden iletişime geçmenizi sağlar.
- Ders ücreti, saati, yeri ve diğer koşullar öğrenci veya velisi ile öğretmen arasında doğrudan kararlaştırılır. Profillerdeki ücretler bilgi amaçlıdır.
- Ücretsiz deneme dersi gibi kampanyalar, ilgili öğretmenin profilinde veya sizinle yapılan görüşmede belirtilen koşullarla geçerlidir.
- Üyeler öğretmenleri değerlendirebilir. Değerlendirmeler gerçek deneyime dayanmalı; hakaret, kişisel veri veya yanıltıcı bilgi içermemelidir. KetaLearn bu kurallara uymayan değerlendirmeleri kaldırabilir.

## 6. Kullanım kuralları
Platform'u kullanırken aşağıdakileri yapmamayı kabul edersiniz:
- Başkasının kimliğini veya bilgilerini kullanmak, yanlış bilgi vermek
- Platform'un işleyişini bozacak, güvenliğini tehdit edecek veya aşırı yük oluşturacak işlemler yapmak (otomatik veri toplama, saldırı, açık arama vb.)
- İçerikleri izinsiz kopyalamak, çoğaltmak, satmak veya başka bir platformda yayımlamak
- Hukuka, genel ahlaka veya başkalarının haklarına aykırı içerik paylaşmak

## 7. Fikrî mülkiyet
Platform'daki ders videoları, metinler, sorular, çözümler, görseller, raporlar ve tasarım KetaLearn'e veya içerik sahiplerine aittir ve fikir ve sanat eserleri mevzuatıyla korunur. İçerikleri kişisel ve ticari olmayan öğrenme amacıyla kullanabilirsiniz. Bunun dışındaki her türlü kullanım için yazılı izin gerekir. YouTube gibi üçüncü taraf platformlarda yayımlanan videolar, o platformların kullanım koşullarına da tabidir.

## 8. Sorumluluğun sınırı
KetaLearn içeriklerin doğru ve güncel olması için özen gösterir; ancak içeriklerin hatasız olduğunu veya belirli bir sınav başarısı sağlayacağını garanti etmez. Platform "olduğu gibi" sunulur; bakım, teknik arıza veya üçüncü taraf hizmetlerden kaynaklanan kesintiler yaşanabilir. Mevzuatın izin verdiği ölçüde, KetaLearn Platform'un kullanımından doğan dolaylı zararlardan sorumlu değildir. Öğretmenlerle doğrudan kurulan ilişkilerden ve yapılan anlaşmalardan doğan uyuşmazlıklarda taraflar öğrenci veya velisi ile öğretmendir.

## 9. Kişisel veriler
Kişisel verileriniz 6698 sayılı Kişisel Verilerin Korunması Kanunu'na uygun olarak işlenir. Hangi verilerin hangi amaçla işlendiği ve haklarınız Gizlilik Politikası ve KVKK Aydınlatma Metni'nde açıklanmıştır.

## 10. Üçüncü taraf bağlantılar
Platform'da YouTube, WhatsApp ve Google gibi üçüncü taraf hizmetlere bağlantılar bulunur. Bu hizmetlerin içeriğinden ve gizlilik uygulamalarından ilgili hizmet sağlayıcı sorumludur.

## 11. Değişiklikler
KetaLearn bu şartları gerektiğinde güncelleyebilir. Güncel metin bu sayfada yayımlandığı anda yürürlüğe girer; önemli değişiklikleri Platform üzerinden duyururuz. Değişiklikten sonra Platform'u kullanmaya devam etmeniz, güncel şartları kabul ettiğiniz anlamına gelir.

## 12. Uygulanacak hukuk ve iletişim
Bu şartlar Türkiye Cumhuriyeti hukukuna tabidir. Uyuşmazlıklarda, tüketici işlemleri için Tüketici Hakem Heyetleri ve Tüketici Mahkemeleri, diğer hâllerde Türkiye Cumhuriyeti mahkemeleri yetkilidir. Sorularınız için iletişim sayfasındaki e-posta adresinden bize ulaşabilirsiniz.
`;

/** The mini format above → Strapi blocks. */
export function textToLegalBlocks(text: string) {
	// biome-ignore lint/suspicious/noExplicitAny: Strapi blocks are a loose JSON tree
	const blocks: any[] = [];
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (!line) continue;
		if (line.startsWith("## ")) {
			blocks.push({
				type: "heading",
				level: 2,
				children: [{ type: "text", text: line.slice(3) }],
			});
		} else if (line.startsWith("- ")) {
			const item = {
				type: "list-item",
				children: [{ type: "text", text: line.slice(2) }],
			};
			const last = blocks.at(-1);
			if (last?.type === "list") last.children.push(item);
			else blocks.push({ type: "list", format: "unordered", children: [item] });
		} else {
			blocks.push({
				type: "paragraph",
				children: [{ type: "text", text: line }],
			});
		}
	}
	return blocks;
}

const TERMS_UID = "api::term-and-condition.term-and-condition";

const hasText = (blocks: unknown) => blocksToText(blocks).trim().length > 0;

/** Fills the terms of service with the default text when it is missing or empty. */
export async function seedDefaultTerms(strapi: Core.Strapi) {
	const documents = strapi.documents(TERMS_UID as never);
	const existing = (await documents.findFirst({})) as {
		documentId: string;
		text?: unknown;
	} | null;
	if (existing && hasText(existing.text)) return;
	const data = { text: textToLegalBlocks(TERMS) };
	if (existing) await documents.update({ documentId: existing.documentId, data } as never);
	else await documents.create({ data } as never);
	strapi.log.info(
		"📄 Hizmet şartları boştu: varsayılan metin yazıldı (admin panelinden düzenlenebilir)",
	);
}

---
name: deneme-yazari
description: KetaLearn deneme sınavı yazar. Use when asked to write, generate, extend or fix a mock exam ("deneme sınavı", "deneme oluştur", "soru yaz", "LGS/TYT/AYT denemesi") for KetaLearn. Reads the catalogue (subjects, grades, topics, linked lesson videos, existing exams) from the Strapi soru-yazari API, writes original multiple-choice questions with solutions, draws question figures as SVG, uploads them, and saves the exam as a draft for the teacher to review.
---

# KetaLearn deneme yazarı

KetaLearn'ün deneme sınavları için soru yazar, soru görsellerini çizer ve denemeyi Strapi'ye **taslak** olarak kaydedersin. Yayınlamak her zaman hocanın işidir: denemeyi admin panelinde okur, düzeltir, yayınlar. Sen asla yayınlamazsın; API buna izin de vermez.

Bütün işlemler `scripts/keta.mjs` üzerinden yapılır (Node 18+, bağımlılık yok):

```bash
node <skill>/scripts/keta.mjs yardim
```

## Kurulum

İki ortam değişkeni gerekir:

- `KETA_API_URL`: Strapi adresi (ör. `https://api.ketalearn.com`). Varsayılan `http://localhost:1337`.
- `SORU_YAZARI_TOKEN`: sunucudaki `SORU_YAZARI_TOKEN` ile aynı değer (en az 32 karakter).

Eksikse kullanıcıdan iste. Token'ı sohbete yazdırma, ortam değişkeni olarak tanımlatmasını söyle. 403 alırsan token yanlış ya da sunucuda API kapalıdır.

## Akış

1. **İsteği netleştir.** Sınav türü (LGS, TYT, AYT, Okul), sınıf, ders, konular, soru sayısı, süre ve zorluk dağılımı. Kullanıcı belirtmediyse makul varsayılanları kullan ve ne seçtiğini tek satırda söyle: LGS matematik 20 soru / 40 dk, 4 şık; TYT/AYT 5 şık; zorluk yaklaşık %30 Kolay, %50 Orta, %20 Zor.
2. **Kataloğu oku.**
   ```bash
   node keta.mjs katalog --ders matematik --sinif 8-sinif
   ```
   Her konunun `slug`'ı, bağlı ders videoları (`dersVideolari`) ve şimdiye kadar kaç soruda kullanıldığı (`soruSayisi`) gelir. **Konular yalnızca bu listeden seçilir.** Gereken konu yoksa uydurma; kullanıcıya hangi konunun admin panelinden (Konu) eklenmesi gerektiğini söyle.
3. **İlgili dersleri oku.** Sorular sitedeki derslerle uyumlu olmalı; raporda yanlış yapılan sorunun altında o konunun dersi önerilir.
   ```bash
   node keta.mjs dersler --konu uslu-ifadeler --icerik
   node keta.mjs ders <documentId>
   ```
   Dersin anlattığı yöntem ve gösterimi kullan (ör. ders "üslü sayılarda çarpma"yı nasıl anlatıyorsa soru da öyle sorsun). Konuya bağlı ders yoksa `--q` ile başlıkta ara. Konusu olmayan dersleri `--konusuz` listeler; bunları hocaya bildirebilirsin.
4. **Tekrardan kaçın.** `node keta.mjs denemeler` ile mevcut denemelere bak. Aynı konuda deneme varsa `node keta.mjs deneme <id>` ile sorularını oku ve aynı soruları ya da sayıları yazma.
5. **Soruları yaz** (aşağıdaki kurallar), görselleri çiz (aşağıdaki görsel kuralları) ve `deneme.json` dosyasını oluştur. Çalışma klasörü olarak proje dışında bir klasör kullan (ör. `denemeler/<slug>/`). Görseller de aynı klasöre.
6. **Her cevabı doğrula.** Her sorunun doğru cevabını, Python ya da Node ile hesaplayarak bağımsız olarak kontrol et: sayısal sonuç, şıkların hiçbirinin ikinci bir doğru cevap olmaması, görseldeki ölçülerin metinle tutması. Hesap tutmuyorsa soruyu düzelt; hiçbir soruyu doğrulamadan kaydetme.
7. **Kontrol et, sonra gönder.**
   ```bash
   node keta.mjs kontrol denemeler/<slug>/deneme.json   # kaydetmeden doğrular
   node keta.mjs gonder  denemeler/<slug>/deneme.json   # görselleri yükler, taslağı oluşturur
   ```
   `gonder` ilk seferde taslağı oluşturur ve dönen `documentId`'yi dosyaya yazar. Sonraki `gonder` aynı taslağı günceller (yeni deneme açmaz). Yalnızca değişen görseller yeniden yüklenir.
8. **Teslim et.** Kullanıcıya şunları ver: admin linki (`adminUrl`), soru sayısı ve konu/zorluk dağılımı, uyarılar, ve hocanın yayından önce bakması gereken şeyler (özellikle görselli sorular).

Var olan bir denemeyi düzeltmek için: `node keta.mjs deneme <id> --cikti deneme.json` → dosyayı düzenle → `kontrol` → `gonder`. Yayındaki bir denemeyi güncellemek yalnızca taslağını değiştirir; hoca yayınlayana kadar sitedeki sürüm aynı kalır.

## deneme.json biçimi

```json
{
  "baslik": "LGS Matematik Denemesi 3",
  "slug": "lgs-matematik-denemesi-3",
  "aciklama": "Üslü ifadeler ve kareköklü ifadeler. 20 soru, 40 dakika.",
  "sinavTuru": "LGS",
  "sinif": "8-sinif",
  "ders": "matematik",
  "sureDakika": 40,
  "sorular": [
    {
      "metin": "Şekildeki ABCD karesinin alanı 48 cm²'dir.\nBuna göre karenin bir kenar uzunluğu kaç cm'dir?",
      "gorsel": { "dosya": "s01.svg", "alt": "Köşeleri A, B, C, D olan bir kare." },
      "secenekler": [{ "metin": "2√3" }, { "metin": "4√3" }, { "metin": "6√2" }, { "metin": "8√3" }],
      "dogruSecenek": "B",
      "zorluk": "Kolay",
      "konu": "karekoklu-ifadeler",
      "cozum": "Kenar a ise a² = 48.\na = √48 = √(16·3) = 4√3 cm."
    }
  ],
  "SEO": {
    "metaTitle": "LGS Matematik Denemesi 3 – Ücretsiz Çöz | KetaLearn",
    "metaDescription": "Üslü ve kareköklü ifadelerden 20 soruluk ücretsiz LGS matematik denemesi. Kayıt olmadan çöz, netini hemen gör."
  }
}
```

- `slug` verilmezse başlıktan üretilir; benzersiz olmalı.
- `sinif`, `ders`, `konu` → katalogdaki `slug`'lar. `konular` verilmezse soruların konularından oluşur.
- `metin` ve `cozum` düz metin: her satır bir paragraf, `- ` ile başlayan satırlar madde işaretli liste. Markdown, LaTeX ya da HTML **yazma**; site bunları işlemez. Matematik için Unicode kullan: `√`, `²`, `³`, `⁻¹`, `·`, `×`, `÷`, `π`, `≤`, `≥`, `≠`, `°`, `∠`, `△`, `‖`, `⊥`, kesirler `3/4` ya da `¾`.
- Şıklar sırayla A, B, C, D, E olur. Her şıkta `metin` ya da `gorsel` (ya da ikisi) olmalı.
- `gorsel`: medya id'si (sayı), dosya yolu (`"s01.svg"`) ya da `{ "dosya": "...", "alt": "..." }`. Yollar JSON dosyasına göredir.
- `zorluk`: `Kolay`, `Orta`, `Zor`.

## Soru yazım kuralları

- **Özgün yaz.** ÖSYM/MEB'in yayımlanmış sorularını ya da bir yayınevinin sorularını kopyalama veya sayılarını değiştirip tekrar kullanma. Tarzı (LGS'nin bağlamlı, okuma ağırlıklı soruları gibi) örnek alabilirsin.
- **Müfredata uy.** Soru, seçilen sınıfın MEB kazanımları içinde kalmalı; o sınıfta henüz öğretilmeyen kavram kullanma.
- **Tek doğru cevap.** Şıklardan yalnızca biri doğru olmalı. "Hepsi", "hiçbiri" şıklarını kullanma.
- **Anlamlı çeldiriciler.** Her yanlış şık, gerçek bir öğrenci hatasından gelsin (üsleri çarpmak yerine toplamak, işaret hatası, birim karışıklığı, yarım kalan işlem). Rastgele sayı yazma.
- **Doğru cevabın yeri dengeli olsun.** A–E arasında yaklaşık eşit dağıt, art arda üç kez aynı harfi verme. Sayısal şıkları küçükten büyüğe sırala (dengeyi bu sıralamayla sağla).
- **Kısa ve açık kök.** Soru kökü sonda net bir soru cümlesiyle bitsin ("Buna göre … kaçtır?"). Olumsuz soruda olumsuzluğu vurgula: "hangisi **değildir**" yerine büyük harfle "hangisi DEĞİLDİR?".
- **Çözüm zorunlu.** Her soruya adım adım, 2–6 satırlık bir çözüm yaz. Rapordaki "Hocanın ipucu" bu çözüme dayanır; çözümsüz soruya ipucu çıkmaz. Çözüm, doğru cevaba varan kilit adımı açıkça göstersin.
- **Konu doğru etiketlensin.** Her soru tek bir konuya bağlanır; öğrencinin raporundaki konu başarısı bu etikete göre hesaplanır.
- **Dil.** Türkçe yazım kurallarına uy (TDK). Sayılarda ondalık ayırıcı virgül (`2,5`). Birimleri yaz (cm, m², TL, km/sa).

## Görsel kuralları

Görsel, soruyu çözmek için gerekiyorsa ekle (geometri şekli, grafik, tablo, sayı doğrusu, örüntü, harita/plan). Süs olsun diye ekleme.

- **SVG olarak elle yaz.** Koordinatları hesaplayarak yaz; göz kararı çizme. Ölçüler metindeki verilerle tutmalı, ama şekil "ölçekli değildir" kabul edilir; ölçüyü şekilden okuyarak bulunabilen bir cevap verme.
- Çerçeve: `viewBox` kullan, soru görseli için yaklaşık `0 0 800 500`, şık görseli için `0 0 300 200`. `width`/`height` ver (ör. `width="800" height="500"`).
- Arka plan beyaz (`<rect width="100%" height="100%" fill="#fff"/>`). Çizgiler `#0f172a`, kalınlık 2–3; vurgu rengi tek bir renk (`#2563eb`), gölge ve gradyan yok.
- Yazılar: `font-family="DejaVu Sans, Arial, sans-serif"`, en az 22px (soru görselinde), harfler (A, B, C) ve ölçüler net okunsun. Yazılar çizgilerin üstüne binmesin.
- Dış dosya, `<image>`, `<script>`, web fontu kullanma; her şey SVG'nin içinde olsun.
- **Cevabı görselde verme.** İstenen uzunluk/açı "?" ya da harfle gösterilsin.
- Şık görselleri küçük gösterilir (en fazla yaklaşık 220×130 px): sade tut, yazıları büyük yaz.
- `alt`: görselin ne gösterdiğini bir cümleyle yaz (ölçüler dahil, cevap hariç). Görme engelli bir öğrenci için yazdığını düşün.
- **Bak ve düzelt.** Her SVG için `node keta.mjs onizle s01.svg` çalıştır, çıkan PNG'yi aç ve kontrol et: taşan ya da üst üste binen yazı, yanlış etiket, metinle çelişen ölçü. Düzeltmeden yükleme.
- Sunucu, SVG'yi PNG'ye çevirip saklar (rapor PDF'i yalnızca PNG/JPEG çizebilir). PNG/JPEG/WebP de yükleyebilirsin (ör. matplotlib grafiği); en fazla 5 MB.

Grafik çizerken (fonksiyon, sütun grafiği) eksenleri, birimleri ve ızgara çizgilerini SVG'de hesaplayarak yaz ya da Python/matplotlib ile PNG üret; ikisinde de değerleri koddan hesapla.

## API

`keta.mjs` bu uçları kullanır; doğrudan çağırmak gerekirse hepsi `x-soru-yazari-token` başlığı ister:

| Uç | Ne yapar |
|---|---|
| `GET /api/soru-yazari/katalog` | Sınav türleri, zorluklar, dersler, sınıflar, konular (+ bağlı dersler, kullanım sayısı) |
| `GET /api/soru-yazari/dersler?q=&konu=&kurs=&konusuz=1&icerik=1&sayfa=&limit=` | Dersler, kursları ve konularıyla |
| `GET /api/soru-yazari/dersler/:documentId` | Bir dersin tüm metni |
| `GET /api/soru-yazari/denemeler?q=` | Denemeler (taslaklar dahil) |
| `GET /api/soru-yazari/denemeler/:documentId` | Bir deneme, cevap anahtarı ve çözümlerle |
| `POST /api/soru-yazari/denemeler[?kontrol=1]` | Taslak deneme oluşturur (`kontrol=1`: yalnızca doğrular) |
| `PUT /api/soru-yazari/denemeler/:documentId[?kontrol=1]` | Taslağı verilen denemeyle değiştirir |
| `POST /api/soru-yazari/gorseller` | multipart `file` + `alt` → `{ id, url, width, height }` |

Doğrulama hataları `{ hatalar: [{ yol, hata }], uyarilar: [...] }` olarak döner. Hepsini düzeltip tekrar dene.

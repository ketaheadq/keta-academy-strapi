import PDFDocument from "pdfkit";
import type { ReportComment } from "./ai";
import { siteUrl, whatsappNumber } from "./config";
import type { QuestionReview, ReportData } from "./report";

/**
 * Report PDF. The template owns numbers, answers and links; the AI's JSON only fills the
 * sentences (genel değerlendirme, konu yorumları, soru ipuçları, çalışma planı, kapanış).
 */

const FONT = require.resolve("dejavu-fonts-ttf/ttf/DejaVuSans.ttf");
const FONT_BOLD = require.resolve("dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf");

const C = {
	ink: "#0f172a",
	muted: "#64748b",
	line: "#e2e8f0",
	soft: "#f1f5f9",
	primary: "#0f172a",
	link: "#1d4ed8",
	green: "#16a34a",
	amber: "#f59e0b",
	red: "#dc2626",
	whatsapp: "#25D366",
};

const MARGIN = 50;

export type PdfInput = {
	ad: string;
	yakinlik: "Veli" | "Ogrenci" | "Diger";
	aramaIzni: boolean;
	raporAnahtari: string;
	data: ReportData;
	yorum: ReportComment | null;
	hocaNotu: string | null;
	tarih: Date;
};

/** Lesson links from the PDF carry UTM tags so visits show up as "rapor / pdf" in Analytics. */
function tracked(url: string) {
	return `${url}${url.includes("?") ? "&" : "?"}utm_source=rapor&utm_medium=pdf&utm_campaign=deneme`;
}

/** PNG/JPEG only (what PDFKit embeds); anything else is skipped with a note. */
async function fetchImage(url: string | null): Promise<Buffer | null> {
	if (!url) return null;
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
		if (!response.ok) return null;
		const buffer = Buffer.from(await response.arrayBuffer());
		const png = buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
		const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
		return png || jpeg ? buffer : null;
	} catch {
		return null;
	}
}

async function loadImages(sorular: QuestionReview[]) {
	const urls = new Set<string>();
	for (const q of sorular) {
		if (q.gorselUrl) urls.add(q.gorselUrl);
		for (const o of q.secenekler) if (o.gorselUrl) urls.add(o.gorselUrl);
	}
	const entries = await Promise.all([...urls].map(async (url) => [url, await fetchImage(url)] as const));
	return new Map(entries.filter(([, img]) => img) as [string, Buffer][]);
}

const rateColor = (oran: number) => (oran >= 75 ? C.green : oran >= 50 ? C.amber : C.red);

export async function renderReportPdf(input: PdfInput): Promise<Buffer> {
	const { data, yorum } = input;
	const images = await loadImages(data.sorular);
	const doc = new PDFDocument({
		size: "A4",
		margins: { top: MARGIN, bottom: MARGIN + 20, left: MARGIN, right: MARGIN },
		bufferPages: true,
		info: { Title: `${data.deneme.baslik} – Deneme Raporu`, Author: "KetaLearn – Çağlar Hoca" },
	});
	doc.registerFont("regular", FONT);
	doc.registerFont("bold", FONT_BOLD);
	const chunks: Buffer[] = [];
	doc.on("data", (chunk: Buffer) => chunks.push(chunk));
	const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

	const width = doc.page.width - MARGIN * 2;
	const left = MARGIN;
	const ensureSpace = (height: number) => {
		if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
	};
	const heading = (text: string) => {
		ensureSpace(60);
		doc.moveDown(0.8).font("bold").fontSize(15).fillColor(C.ink).text(text, left, doc.y, { width });
		doc.moveTo(left, doc.y + 4).lineTo(left + width, doc.y + 4).lineWidth(1).strokeColor(C.line).stroke();
		doc.moveDown(0.8);
	};
	const paragraph = (text: string, opts: { color?: string; size?: number } = {}) => {
		doc.font("regular").fontSize(opts.size ?? 10.5).fillColor(opts.color ?? C.ink).text(text, left, doc.y, {
			width,
			lineGap: 3,
		});
	};
	// openImage exists at runtime but isn't in @types/pdfkit.
	const open = (buffer: Buffer) =>
		(doc as unknown as { openImage(src: Buffer): { width: number; height: number } }).openImage(buffer);
	const scaledHeight = (buffer: Buffer, maxW: number, maxH: number) => {
		const img = open(buffer);
		return img.height * Math.min(maxW / img.width, maxH / img.height, 1);
	};
	/** Draws an image scaled into [maxW, maxH] at the cursor and moves the cursor below it. */
	const image = (buffer: Buffer, x: number, maxW: number, maxH: number) => {
		const img = open(buffer);
		const scale = Math.min(maxW / img.width, maxH / img.height, 1);
		const h = img.height * scale;
		ensureSpace(h + 8);
		doc.image(img as unknown as Buffer, x, doc.y + 4, { width: img.width * scale, height: h });
		doc.y += h + 8;
	};
	const link = (label: string, url: string) => {
		doc.font("regular").fontSize(10.5).fillColor(C.link).text(label, left, doc.y, {
			width,
			link: url,
			underline: true,
		});
		doc.fillColor(C.ink);
	};

	// ── Header ────────────────────────────────────────────────────────────────
	doc.rect(0, 0, doc.page.width, 110).fill(C.primary);
	doc.font("bold").fontSize(11).fillColor("#fbbf24").text("KetaLearn · Deneme Raporu", left, 32);
	doc.font("bold").fontSize(20).fillColor("#ffffff").text(data.deneme.baslik, left, 50, { width });
	doc
		.font("regular")
		.fontSize(10)
		.fillColor("#cbd5e1")
		.text(`${input.tarih.toLocaleDateString("tr-TR")} · Hazırlayan: Çağlar Hoca`, left, 82);
	doc.y = 135;
	doc.font("bold").fontSize(13).fillColor(C.ink).text(`Merhaba ${input.ad},`, left, doc.y);
	doc.moveDown(0.3);
	paragraph("Deneme sonucunun konu konu analizi, yanlış ve boş soruların çözümleri ve sana özel çalışma önerileri aşağıda.", {
		color: C.muted,
	});

	// ── Score boxes ───────────────────────────────────────────────────────────
	doc.moveDown(1);
	const boxes: [string, string, boolean][] = [
		["Net", data.net.toLocaleString("tr-TR"), true],
		["Doğru", String(data.dogru), false],
		["Yanlış", String(data.yanlis), false],
		["Boş", String(data.bos), false],
	];
	const gap = 10;
	const boxW = (width - gap * 3) / 4;
	const boxY = doc.y;
	boxes.forEach(([label, value, main], i) => {
		const x = left + i * (boxW + gap);
		doc.roundedRect(x, boxY, boxW, 62, 8).fill(main ? C.primary : C.soft);
		doc.font("bold").fontSize(22).fillColor(main ? "#ffffff" : C.ink).text(value, x, boxY + 10, { width: boxW, align: "center" });
		doc.font("regular").fontSize(9).fillColor(main ? "#cbd5e1" : C.muted).text(label, x, boxY + 40, { width: boxW, align: "center" });
	});
	doc.y = boxY + 74;
	if (data.siralama) {
		paragraph(
			`Bu denemeyi çözen ${data.siralama.katilimci.toLocaleString("tr-TR")} öğrencinin %${data.siralama.yuzde}'inden daha yüksek net.`,
		);
	}

	// ── General assessment + teacher's note ──────────────────────────────────
	if (yorum?.genelDegerlendirme) {
		heading("Genel değerlendirme");
		paragraph(yorum.genelDegerlendirme);
	}
	if (input.hocaNotu?.trim()) {
		ensureSpace(70);
		doc.moveDown(0.8);
		const noteY = doc.y;
		const noteHeight = doc.font("regular").fontSize(10.5).heightOfString(input.hocaNotu, { width: width - 24, lineGap: 3 }) + 34;
		doc.roundedRect(left, noteY, width, noteHeight, 8).fill("#fef3c7");
		doc.font("bold").fontSize(10).fillColor("#92400e").text("Çağlar Hoca'nın notu", left + 12, noteY + 10);
		doc.font("regular").fontSize(10.5).fillColor(C.ink).text(input.hocaNotu, left + 12, noteY + 26, { width: width - 24, lineGap: 3 });
		doc.y = noteY + noteHeight;
	}

	// ── Topic table ───────────────────────────────────────────────────────────
	heading("Konu bazında başarı");
	for (const konu of [...data.konular].sort((a, b) => a.oran - b.oran)) {
		ensureSpace(32);
		const y = doc.y;
		doc.font("regular").fontSize(10).fillColor(C.ink).text(konu.ad, left, y, { width: width * 0.55 });
		doc
			.fillColor(C.muted)
			.text(`${konu.dogru}/${konu.toplam} · %${konu.oran}`, left, y, { width, align: "right" });
		const barY = y + 15;
		doc.roundedRect(left, barY, width, 6, 3).fill(C.soft);
		doc.roundedRect(left, barY, Math.max(6, (width * konu.oran) / 100), 6, 3).fill(rateColor(konu.oran));
		doc.y = barY + 14;
	}

	// ── Priority topics ───────────────────────────────────────────────────────
	if (data.zayifKonular.length) {
		heading("Önce bu konulara çalışalım");
		for (const konu of data.zayifKonular) {
			ensureSpace(80);
			doc.font("bold").fontSize(11.5).fillColor(C.ink).text(`${konu.ad}  `, left, doc.y, { continued: true, width });
			doc.font("regular").fillColor(rateColor(konu.oran)).text(`%${konu.oran}`);
			const comment = yorum?.konuYorumlari.find((k) => k.konu === konu.ad)?.yorum;
			if (comment) {
				doc.moveDown(0.2);
				paragraph(comment);
			}
			doc.moveDown(0.2);
			if (konu.videolar.length) {
				for (const video of konu.videolar) link(`▶ Şu dersi izle: ${video.baslik}`, tracked(video.url));
			} else {
				paragraph("Bu konunun ders videoları yakında eklenecek.", { color: C.muted, size: 9.5 });
			}
			doc.moveDown(0.8);
		}
	}

	// ── Question by question ──────────────────────────────────────────────────
	if (data.sorular.length) {
		// Start on a new page only when the first question wouldn't fit.
		ensureSpace(260);
		heading("Soru soru analiz");
		paragraph("Yanlış yaptığın ve boş bıraktığın sorular, doğru cevaplar ve çözümleriyle.", { color: C.muted });
		doc.moveDown(0.5);
		for (const q of data.sorular) {
			// Keep the question header, text and image on one page.
			const questionImage = q.gorselUrl ? images.get(q.gorselUrl) : null;
			const textHeight = doc.font("regular").fontSize(10.5).heightOfString(q.soru, { width, lineGap: 3 });
			ensureSpace(120 + textHeight + (questionImage ? scaledHeight(questionImage, width * 0.7, 200) + 8 : 0));
			const top = doc.y;
			doc.moveTo(left, top).lineTo(left + width, top).lineWidth(1).strokeColor(C.line).stroke();
			doc.y = top + 10;
			doc.font("bold").fontSize(11.5).fillColor(C.ink).text(`Soru ${q.no}`, left, doc.y, { continued: true });
			doc
				.font("regular")
				.fillColor(q.durum === "yanlis" ? C.red : C.muted)
				.text(`  ·  ${q.konu}  ·  ${q.durum === "yanlis" ? "Yanlış" : "Boş"}`);
			doc.moveDown(0.4);
			paragraph(q.soru);
			if (questionImage) {
				image(questionImage, left, width * 0.7, 200);
			} else if (q.gorselUrl) {
				paragraph("(Sorunun görseli için denemeye bakın.)", { color: C.muted, size: 9 });
			}
			doc.moveDown(0.3);
			for (const option of q.secenekler) {
				ensureSpace(22);
				const isCorrect = option.harf === q.dogruCevap;
				const isStudent = option.harf === q.ogrenciCevabi;
				const mark = isCorrect ? "✓" : isStudent ? "✗" : " ";
				const color = isCorrect ? C.green : isStudent ? C.red : C.ink;
				const note = isCorrect ? "  (doğru cevap)" : isStudent ? "  (senin cevabın)" : "";
				doc
					.font(isCorrect || isStudent ? "bold" : "regular")
					.fontSize(10.5)
					.fillColor(color)
					.text(`${mark}  ${option.harf}) ${option.metin}${note}`, left + 8, doc.y, { width: width - 8 });
				const optionImage = option.gorselUrl ? images.get(option.gorselUrl) : null;
				if (optionImage) image(optionImage, left + 26, 160, 80);
			}
			if (!q.ogrenciCevabi) paragraph("Bu soruyu boş bıraktın.", { color: C.muted, size: 9.5 });
			if (q.cozum) {
				doc.moveDown(0.4);
				doc.font("bold").fontSize(10).fillColor(C.ink).text("Çözüm", left, doc.y);
				paragraph(q.cozum);
			}
			const tip = yorum?.soruIpuclari.find((s) => s.no === q.no)?.ipucu;
			if (tip) {
				doc.moveDown(0.4);
				doc.font("bold").fontSize(10).fillColor(C.ink).text("Hocanın ipucu", left, doc.y);
				paragraph(tip);
			}
			if (q.video) {
				doc.moveDown(0.3);
				link(`▶ Bu konunun dersi: ${q.video.baslik}`, tracked(q.video.url));
			}
			doc.moveDown(1);
		}
	}

	// ── Study plan, closing, call to action ──────────────────────────────────
	if (yorum?.calismaPlani.length) {
		heading("Bir haftalık çalışma planı");
		yorum.calismaPlani.forEach((item, i) => {
			ensureSpace(30);
			paragraph(`${i + 1}. ${item}`);
			doc.moveDown(0.2);
		});
	}
	if (yorum?.kapanis) {
		doc.moveDown(0.6);
		paragraph(yorum.kapanis);
	}

	ensureSpace(130);
	doc.moveDown(1.2);
	const ctaY = doc.y;
	doc.roundedRect(left, ctaY, width, 112, 10).fill(C.soft);
	doc
		.font("bold")
		.fontSize(13)
		.fillColor(C.ink)
		.text("Bu raporu birlikte değerlendirelim", left + 16, ctaY + 14, { width: width - 32 });
	const offer =
		input.yakinlik === "Ogrenci"
			? "Raporu velinle paylaş: velinin numarasını eklersen rapor ona da gider ve Çağlar Hoca raporu velinle 15 dakikada ücretsiz değerlendirebilir."
			: `Çağlar Hoca bu raporu sizinle 15 dakikada ücretsiz değerlendirsin.${input.aramaIzni ? " Sizi bu numaradan arayacağız." : ""}`;
	doc.font("regular").fontSize(10.5).fillColor(C.ink).text(offer, left + 16, ctaY + 36, { width: width - 32, lineGap: 2 });
	const ctaLinkY = ctaY + 84;
	if (input.yakinlik === "Ogrenci") {
		doc
			.font("bold")
			.fillColor(C.link)
			.text("→ Velinin numarasını ekle", left + 16, ctaLinkY, {
				link: `${siteUrl()}/rapor/${input.raporAnahtari}/veli`,
				underline: true,
			});
	} else if (whatsappNumber()) {
		const message = `Merhaba Çağlar Hoca, ${data.deneme.baslik} raporunu sizinle değerlendirmek istiyorum.`;
		doc
			.font("bold")
			.fillColor(C.whatsapp)
			.text("→ WhatsApp'tan yazın", left + 16, ctaLinkY, {
				link: `https://wa.me/${whatsappNumber().replace(/\D/g, "")}?text=${encodeURIComponent(message)}`,
				underline: true,
			});
	}
	doc.y = ctaY + 124;

	// ── Footer with page numbers ─────────────────────────────────────────────
	const range = doc.bufferedPageRange();
	for (let i = 0; i < range.count; i++) {
		doc.switchToPage(range.start + i);
		const bottom = doc.page.margins.bottom;
		doc.page.margins.bottom = 0;
		doc
			.font("regular")
			.fontSize(8)
			.fillColor(C.muted)
			.text(`KetaLearn · ${siteUrl().replace(/^https?:\/\//, "")} · Sayfa ${i + 1}/${range.count}`, MARGIN, doc.page.height - 35, {
				width,
				align: "center",
				lineBreak: false,
			});
		doc.page.margins.bottom = bottom;
	}

	doc.end();
	return done;
}

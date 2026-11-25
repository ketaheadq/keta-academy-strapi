import { siteUrl } from "./config";

/**
 * Report comment writers ("hocanın notu"). The AI returns JSON in a fixed shape; the PDF template
 * places it next to the data the system computed. Numbers, answers and links are never taken from
 * the AI: it only writes sentences.
 *
 * Goes through OpenRouter (one key, any model): OPENROUTER_API_KEY, model from AI_MODEL.
 * Default: DeepSeek V3.2 without reasoning — a data-bound comment needs no strong model.
 *
 * Only exam data goes in. Name, phone number and session id are never sent.
 */

export type CommentInput = {
	denemeBaslik: string;
	sinavTuru: string;
	dogru: number;
	yanlis: number;
	bos: number;
	net: number;
	soruSayisi: number;
	konular: { ad: string; oran: number; dogru: number; toplam: number }[];
	zayifKonular: { ad: string; oran: number }[];
	sorular: {
		no: number;
		konu: string;
		durum: "yanlis" | "bos";
		soru: string;
		ogrenciCevabi: string | null;
		dogruCevap: string;
		/** The teacher's own solution; the hint is grounded on it. */
		cozum: string;
	}[];
};

export type ReportComment = {
	genelDegerlendirme: string;
	konuYorumlari: { konu: string; yorum: string }[];
	soruIpuclari: { no: number; ipucu: string }[];
	calismaPlani: string[];
	kapanis: string;
};

export type CommentResult = { yorum: ReportComment; provider: string; model: string };

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "deepseek/deepseek-v3.2";

const MAX_OUTPUT_TOKENS = 4000;
const TIMEOUT_MS = 90_000;

/** JSON Schema of the comment; given to the model in the prompt and checked again by parseComment. */
export const COMMENT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["genelDegerlendirme", "konuYorumlari", "soruIpuclari", "calismaPlani", "kapanis"],
	properties: {
		genelDegerlendirme: { type: "string", description: "2–4 cümlelik genel değerlendirme" },
		konuYorumlari: {
			type: "array",
			description: "Zayıf konuların her biri için bir yorum",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["konu", "yorum"],
				properties: { konu: { type: "string" }, yorum: { type: "string" } },
			},
		},
		soruIpuclari: {
			type: "array",
			description: "Yalnızca verideki çözüme ve soru metnine dayanarak somut bir ipucu yazılabilen sorular için; emin olunamayan sorular eklenmez",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["no", "ipucu"],
				properties: { no: { type: "integer" }, ipucu: { type: "string" } },
			},
		},
		calismaPlani: {
			type: "array",
			description: "3–5 maddelik bir haftalık çalışma planı",
			items: { type: "string" },
		},
		kapanis: { type: "string", description: "Cesaretlendiren 1–2 cümlelik kapanış" },
	},
} as const;

const SYSTEM_PROMPT = `Sen KetaLearn'de matematik öğretmeni Çağlar Hoca'nın deneme sınavı raporu için yorumları taslak olarak yazıyorsun. Rapor bir PDF olarak öğrenciye ve velisine gidecek; yorumlar makine çıktısı gibi değil, sıcak ama ölçülü bir öğretmen notu gibi okunmalı.

Yanıtı yalnızca şu JSON biçiminde ver:
{
  "genelDegerlendirme": "2–4 cümle: önce güçlü yan, sonra öncelikli eksikler",
  "konuYorumlari": [{ "konu": "zayıf konunun adı, verideki gibi", "yorum": "2–3 cümle: konu neden önemli, nasıl çalışmalı" }],
  "soruIpuclari": [{ "no": soru numarası, "ipucu": "1–2 cümle: bu soruya özgü, çözümdeki kilit adıma dayanan somut ipucu" }],
  "calismaPlani": ["3–5 madde: bir haftalık kısa ve uygulanabilir plan"],
  "kapanis": "1–2 cümle cesaretlendiren kapanış"
}

Kurallar:
- Yalnızca verilen deneme verisine dayan. Tanı koyma, not veya sınav puanı tahmini yapma, kesin sonuç vaat etme.
- konuYorumlari'nda her zayıf konu için bir öğe yaz.
- soruIpuclari isteğe bağlıdır. Bir soruya ipucu yalnızca o sorunun "cozum" alanına ve metnine dayanarak, o soruya özgü somut bir şey söyleyebiliyorsan yaz: çözümdeki kilit adım, sık yapılan işlem hatası, dikkat edilecek kavram. Çözümü olduğu gibi tekrar etme.
- Emin değilsen o soruyu soruIpuclari'na hiç ekleme. "Dikkatli oku", "işlemleri kontrol et", "konuyu tekrar et" gibi her soruya uyan genel cümleler yazma; tahmin yürütme, verilmeyen şekil veya şık içeriği uydurma. Boş dizi geçerli bir yanıttır.
- Hiçbir link, URL, e-posta veya telefon numarası yazma; ders videolarını sistem ekleyecek.
- Sayıları değiştirme; net, doğru ve yanlış sayılarını verideki gibi kullan.
- "Öğrencimiz" diye hitap et, isim kullanma. Türkçe yaz.`;

function buildUserMessage(input: CommentInput) {
	return `Deneme verisi (JSON):\n${JSON.stringify(input, null, 2)}\n\nBu veriye göre raporun JSON yorumunu yaz.`;
}

function requireKey(name: string) {
	const value = process.env[name];
	if (!value) throw new Error(`${name} tanımlı değil`);
	return value;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown) {
	let response: Response;
	try {
		response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...headers },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
	} catch (error) {
		// "fetch failed" alone hides the reason (DNS, TLS, timeout…)
		const cause = (error as { cause?: { message?: string } }).cause?.message;
		throw new Error(`${new URL(url).host} adresine bağlanılamadı${cause ? `: ${cause}` : ""}`);
	}
	const text = await response.text();
	if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
	return JSON.parse(text);
}

/** OpenRouter chat completions in JSON mode; returns the model's raw text. */
async function openRouterComment(model: string, input: CommentInput): Promise<string> {
	const key = process.env.OPENROUTER_API_KEY;
	if (!key) throw new Error("OPENROUTER_API_KEY tanımlı değil");
	const data = await postJson(
		OPENROUTER_URL,
		{
			Authorization: `Bearer ${key}`,
			// Optional app attribution on openrouter.ai
			"HTTP-Referer": siteUrl(),
			"X-Title": "KetaLearn",
		},
		{
			model,
			max_tokens: MAX_OUTPUT_TOKENS,
			// No reasoning step for a data-bound comment: faster and fewer billed tokens.
			reasoning: { enabled: false },
			response_format: { type: "json_object" },
			messages: [
				{ role: "system", content: SYSTEM_PROMPT },
				{ role: "user", content: buildUserMessage(input) },
			],
		},
	);
	if (data.error) throw new Error(`OpenRouter hatası: ${data.error.message ?? JSON.stringify(data.error)}`);
	const choice = data.choices?.[0];
	if (!choice) throw new Error("OpenRouter yanıt vermedi");
	if (choice.finish_reason && choice.finish_reason !== "stop") {
		throw new Error(`Yanıt tamamlanmadı (${choice.finish_reason})`);
	}
	return choice.message?.content ?? "";
}

const URL_PATTERN = /(https?:\/\/|www\.)\S+/gi;

/** Plain sentence: no links (the system places those), trimmed and length-capped. */
function cleanText(value: unknown, max: number): string {
	if (typeof value !== "string") return "";
	return value.replace(URL_PATTERN, "").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Hints that would fit any question ("read carefully", "revise the topic"). They add nothing to
 * the report, so a hint that is short or built only from such advice is dropped.
 */
const GENERIC_HINT =
	/^(?:[^.!?]*\b(?:dikkatli(?:ce)? oku|soruyu (?:iyi|dikkatle)|işlemleri(?:ni)? kontrol|konuyu tekrar|pratik yap|daha fazla soru çöz|acele etme)\b[^.!?]*[.!?]?\s*)+$/i;

function isSpecificHint(hint: string) {
	return hint.length >= 30 && !GENERIC_HINT.test(hint);
}

/**
 * Parses and checks the AI's JSON. Keeps only topics and questions that exist in the input,
 * strips any link, and fails when the essential parts are missing.
 */
export function parseComment(raw: string, input: CommentInput): ReportComment {
	const json = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
	let data: Record<string, unknown>;
	try {
		data = JSON.parse(json);
	} catch {
		throw new Error("Yapay zeka geçerli JSON döndürmedi");
	}
	const topicNames = new Set(input.zayifKonular.map((k) => k.ad));
	const questionNos = new Set(input.sorular.map((s) => s.no));

	const yorum: ReportComment = {
		genelDegerlendirme: cleanText(data.genelDegerlendirme, 900),
		konuYorumlari: (Array.isArray(data.konuYorumlari) ? data.konuYorumlari : [])
			.map((k) => ({ konu: cleanText(k?.konu, 120), yorum: cleanText(k?.yorum, 600) }))
			.filter((k) => topicNames.has(k.konu) && k.yorum),
		soruIpuclari: (Array.isArray(data.soruIpuclari) ? data.soruIpuclari : [])
			.map((s) => ({ no: Number(s?.no), ipucu: cleanText(s?.ipucu, 400) }))
			.filter((s) => questionNos.has(s.no) && isSpecificHint(s.ipucu)),
		calismaPlani: (Array.isArray(data.calismaPlani) ? data.calismaPlani : [])
			.map((m) => cleanText(m, 300))
			.filter(Boolean)
			.slice(0, 6),
		kapanis: cleanText(data.kapanis, 400),
	};
	if (!yorum.genelDegerlendirme) throw new Error("Yapay zeka genel değerlendirmeyi yazmadı");
	return yorum;
}

export async function writeComment(input: CommentInput): Promise<CommentResult> {
	const model = (process.env.AI_MODEL || "").trim() || DEFAULT_MODEL;
	const raw = await openRouterComment(model, input);
	return { yorum: parseComment(raw, input), provider: "openrouter", model };
}

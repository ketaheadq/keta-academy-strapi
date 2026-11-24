import Anthropic from "@anthropic-ai/sdk";

/**
 * Report comment writers ("hocanın notu"). The AI returns JSON in a fixed shape; the PDF template
 * places it next to the data the system computed. Numbers, answers and links are never taken from
 * the AI: it only writes sentences.
 *
 * One adapter per provider, chosen with AI_PROVIDER (deepseek | anthropic | gemini | openai) and
 * AI_MODEL. Default: DeepSeek (deepseek-flash, thinking off) — a data-bound comment needs no strong model.
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

const DEFAULT_MODELS: Record<string, string> = {
	deepseek: "deepseek-flash",
	anthropic: "claude-haiku-5-5",
	gemini: "gemini-2.5-flash",
	openai: "gpt-4.1-mini",
};

const MAX_OUTPUT_TOKENS = 4000;
const TIMEOUT_MS = 90_000;

/** JSON Schema of the comment; used for Anthropic structured outputs and in the prompt for the others. */
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
			description: "Yanlış veya boş bırakılan her soru için bir ipucu",
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
  "soruIpuclari": [{ "no": soru numarası, "ipucu": "1–2 cümle: öğrenci nerede hata yapmış olabilir, neye dikkat etmeli" }],
  "calismaPlani": ["3–5 madde: bir haftalık kısa ve uygulanabilir plan"],
  "kapanis": "1–2 cümle cesaretlendiren kapanış"
}

Kurallar:
- Yalnızca verilen deneme verisine dayan. Tanı koyma, not veya sınav puanı tahmini yapma, kesin sonuç vaat etme.
- konuYorumlari'nda her zayıf konu için bir öğe yaz; soruIpuclari'nda verilen her soru için bir öğe yaz.
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

async function anthropicComment(model: string, input: CommentInput): Promise<string> {
	const client = new Anthropic({ apiKey: requireKey("ANTHROPIC_API_KEY"), timeout: TIMEOUT_MS });
	try {
		const response = await client.messages.create({
			model,
			max_tokens: MAX_OUTPUT_TOKENS,
			// Data-bound writing: low effort keeps it fast and cheap; the schema guarantees valid JSON.
			output_config: { effort: "low", format: { type: "json_schema", schema: COMMENT_SCHEMA } },
			system: SYSTEM_PROMPT,
			messages: [{ role: "user", content: buildUserMessage(input) }],
		});
		if (response.stop_reason === "refusal") {
			throw new Error(`Model yanıtı reddetti (${response.stop_details?.category ?? "kategori yok"})`);
		}
		if (response.stop_reason === "max_tokens") throw new Error("Yanıt max_tokens sınırında kesildi");
		return response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
	} catch (error) {
		if (error instanceof Anthropic.AuthenticationError) throw new Error("Anthropic: API anahtarı geçersiz");
		if (error instanceof Anthropic.RateLimitError) throw new Error("Anthropic: istek sınırı aşıldı");
		if (error instanceof Anthropic.APIError) throw new Error(`Anthropic API hatası ${error.status}: ${error.message}`);
		throw error;
	}
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

/** OpenAI-style chat completions (OpenAI and DeepSeek) with JSON output mode. */
async function chatCompletion(
	url: string,
	keyName: string,
	label: string,
	params: Record<string, unknown>,
	input: CommentInput,
) {
	const data = await postJson(url, { Authorization: `Bearer ${requireKey(keyName)}` }, {
		...params,
		response_format: { type: "json_object" },
		messages: [
			{ role: "system", content: SYSTEM_PROMPT },
			{ role: "user", content: buildUserMessage(input) },
		],
	});
	const choice = data.choices?.[0];
	if (choice?.finish_reason && choice.finish_reason !== "stop") {
		throw new Error(`${label} yanıtı tamamlanmadı (${choice.finish_reason})`);
	}
	return choice?.message?.content ?? "";
}

function deepseekComment(model: string, input: CommentInput) {
	return chatCompletion(
		"https://api.deepseek.com/chat/completions",
		"DEEPSEEK_API_KEY",
		"DeepSeek",
		{
			model,
			max_tokens: MAX_OUTPUT_TOKENS,
			// No reasoning step for a data-bound comment: faster and fewer billed tokens.
			thinking: { type: "disabled" },
		},
		input,
	);
}

function openaiComment(model: string, input: CommentInput) {
	return chatCompletion(
		"https://api.openai.com/v1/chat/completions",
		"OPENAI_API_KEY",
		"OpenAI",
		{ model, max_completion_tokens: MAX_OUTPUT_TOKENS },
		input,
	);
}

async function geminiComment(model: string, input: CommentInput): Promise<string> {
	const data = await postJson(
		`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
		{ "x-goog-api-key": requireKey("GEMINI_API_KEY") },
		{
			systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
			contents: [{ role: "user", parts: [{ text: buildUserMessage(input) }] }],
			generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, responseMimeType: "application/json" },
		},
	);
	const candidate = data.candidates?.[0];
	if (!candidate) throw new Error(`Gemini yanıt vermedi (${data.promptFeedback?.blockReason ?? "neden yok"})`);
	if (candidate.finishReason && !["STOP", "FINISH_REASON_UNSPECIFIED"].includes(candidate.finishReason)) {
		throw new Error(`Gemini yanıtı tamamlanmadı (${candidate.finishReason})`);
	}
	return (candidate.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
}

const ADAPTERS: Record<string, (model: string, input: CommentInput) => Promise<string>> = {
	deepseek: deepseekComment,
	anthropic: anthropicComment,
	gemini: geminiComment,
	openai: openaiComment,
};

const URL_PATTERN = /(https?:\/\/|www\.)\S+/gi;

/** Plain sentence: no links (the system places those), trimmed and length-capped. */
function cleanText(value: unknown, max: number): string {
	if (typeof value !== "string") return "";
	return value.replace(URL_PATTERN, "").replace(/\s+/g, " ").trim().slice(0, max);
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
			.filter((s) => questionNos.has(s.no) && s.ipucu),
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
	const provider = (process.env.AI_PROVIDER || "deepseek").trim().toLowerCase();
	const adapter = ADAPTERS[provider];
	if (!adapter) {
		throw new Error(`Bilinmeyen AI_PROVIDER: ${provider} (deepseek, anthropic, gemini veya openai olmalı)`);
	}
	const model = (process.env.AI_MODEL || "").trim() || DEFAULT_MODELS[provider];
	const raw = await adapter(model, input);
	return { yorum: parseComment(raw, input), provider, model };
}

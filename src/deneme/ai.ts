import Anthropic from "@anthropic-ai/sdk";

/**
 * Report comment ("hocanın notu") writers. One adapter per provider, chosen with
 * AI_PROVIDER (anthropic | gemini | openai) and AI_MODEL, so the three can be compared.
 *
 * Only exam data goes in: net, topic percentages and the video list the system picked.
 * Name, phone number and session id are never sent.
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
	zayifKonular: { ad: string; oran: number; videolar: { baslik: string; url: string }[] }[];
};

export type CommentResult = { text: string; provider: string; model: string };

const DEFAULT_MODELS: Record<string, string> = {
	anthropic: "claude-haiku-5-5",
	gemini: "gemini-2.5-flash",
	openai: "gpt-4.1-mini",
};

const MAX_OUTPUT_TOKENS = 2000;
const TIMEOUT_MS = 60_000;

const SYSTEM_PROMPT = `Sen KetaLearn'de matematik öğretmeni Çağlar Hoca'nın deneme raporu notlarını taslak olarak yazıyorsun. Not, öğrenciye ve velisine hitap eden, sıcak ama ölçülü, kısa bir öğretmen notu gibi okunmalı; makine çıktısı gibi değil.

Kurallar:
- Yalnızca verilen deneme verisine dayan. Tanı koyma, not veya sınav puanı tahmini yapma, kesin sonuç vaat etme.
- 80–150 kelime, düz metin, başlık ve madde işareti kullanma, 2–3 kısa paragraf yaz.
- Önce güçlü yanı bir cümleyle belirt, sonra en zayıf konuları ve neden önemli olduklarını anlat.
- Verilen her video için tam olarak bir kez "şu dersi izle" anlamında bir öneri yaz ve linki Markdown biçiminde ver: [video başlığı](url). Yalnızca verilen URL'leri kullan, başka link yazma, URL'yi değiştirme.
- Video verilmeyen konular için link yazma; sadece o konuya çalışmasını öner.
- "Öğrencimiz" diye hitap et, isim kullanma. Türkçe yaz.`;

function buildUserMessage(input: CommentInput) {
	return `Deneme verisi (JSON):\n${JSON.stringify(input, null, 2)}\n\nBu veriye göre öğretmen notunu yaz.`;
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
			// A short, data-bound note: low effort keeps it fast and cheap.
			output_config: { effort: "low" },
			system: SYSTEM_PROMPT,
			messages: [{ role: "user", content: buildUserMessage(input) }],
		});
		if (response.stop_reason === "refusal") {
			throw new Error(`Model yanıtı reddetti (${response.stop_details?.category ?? "kategori yok"})`);
		}
		if (response.stop_reason === "max_tokens") throw new Error("Yanıt max_tokens sınırında kesildi");
		const text = response.content
			.map((block) => (block.type === "text" ? block.text : ""))
			.join("")
			.trim();
		if (!text) throw new Error("Boş yanıt");
		return text;
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

async function geminiComment(model: string, input: CommentInput): Promise<string> {
	const data = await postJson(
		`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
		{ "x-goog-api-key": requireKey("GEMINI_API_KEY") },
		{
			systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
			contents: [{ role: "user", parts: [{ text: buildUserMessage(input) }] }],
			generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
		},
	);
	const candidate = data.candidates?.[0];
	if (!candidate) throw new Error(`Gemini yanıt vermedi (${data.promptFeedback?.blockReason ?? "neden yok"})`);
	if (candidate.finishReason && !["STOP", "FINISH_REASON_UNSPECIFIED"].includes(candidate.finishReason)) {
		throw new Error(`Gemini yanıtı tamamlanmadı (${candidate.finishReason})`);
	}
	const text = (candidate.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("").trim();
	if (!text) throw new Error("Boş yanıt");
	return text;
}

async function openaiComment(model: string, input: CommentInput): Promise<string> {
	const data = await postJson(
		"https://api.openai.com/v1/chat/completions",
		{ Authorization: `Bearer ${requireKey("OPENAI_API_KEY")}` },
		{
			model,
			max_completion_tokens: MAX_OUTPUT_TOKENS,
			messages: [
				{ role: "system", content: SYSTEM_PROMPT },
				{ role: "user", content: buildUserMessage(input) },
			],
		},
	);
	const choice = data.choices?.[0];
	if (choice?.finish_reason && choice.finish_reason !== "stop") {
		throw new Error(`OpenAI yanıtı tamamlanmadı (${choice.finish_reason})`);
	}
	const text = (choice?.message?.content ?? "").trim();
	if (!text) throw new Error("Boş yanıt");
	return text;
}

const ADAPTERS: Record<string, (model: string, input: CommentInput) => Promise<string>> = {
	anthropic: anthropicComment,
	gemini: geminiComment,
	openai: openaiComment,
};

export async function writeComment(input: CommentInput): Promise<CommentResult> {
	const provider = (process.env.AI_PROVIDER || "anthropic").trim().toLowerCase();
	const adapter = ADAPTERS[provider];
	if (!adapter) throw new Error(`Bilinmeyen AI_PROVIDER: ${provider} (anthropic, gemini veya openai olmalı)`);
	const model = (process.env.AI_MODEL || "").trim() || DEFAULT_MODELS[provider];
	const text = await adapter(model, input);
	return { text, provider, model };
}

/** Every link in the comment must come from the list the system sent (no invented URLs). */
export function findUnknownLinks(text: string, allowedUrls: string[]): string[] {
	const allowed = new Set(allowedUrls);
	const found = text.match(/https?:\/\/[^\s)\]>"']+/g) ?? [];
	return found.map((url) => url.replace(/[.,;:!?]+$/, "")).filter((url) => !allowed.has(url));
}

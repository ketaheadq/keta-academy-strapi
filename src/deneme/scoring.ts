export const LETTERS = ["A", "B", "C", "D", "E"] as const;
export type Letter = (typeof LETTERS)[number];

export type QuestionForScoring = {
	dogruSecenek: Letter;
	secenekler?: unknown[] | null;
	konu?: { id: number; ad: string; slug: string } | null;
};

export type TopicStat = { slug: string; ad: string; toplam: number; dogru: number; oran: number };

export type Score = {
	dogru: number;
	yanlis: number;
	bos: number;
	net: number;
	soruSayisi: number;
	konular: TopicStat[];
};

/** Answers arrive as { "0": "A", "1": null, ... } keyed by question index. */
export function parseAnswers(
	raw: unknown,
	questionCount: number,
): Record<number, Letter | null> | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const answers: Record<number, Letter | null> = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		const index = Number(key);
		if (!Number.isInteger(index) || index < 0 || index >= questionCount) return null;
		if (value === null || value === "") answers[index] = null;
		else if (typeof value === "string" && (LETTERS as readonly string[]).includes(value))
			answers[index] = value as Letter;
		else return null;
	}
	return answers;
}

/**
 * Net = correct − wrong / (options − 1), per question. That is the ÖSYM/MEB rule:
 * 4 options (LGS) → 3 wrong cancel 1 correct, 5 options (TYT) → 4 wrong cancel 1 correct.
 */
export function scoreExam(
	questions: QuestionForScoring[],
	answers: Record<number, Letter | null>,
): Score {
	let dogru = 0;
	let yanlis = 0;
	let bos = 0;
	let net = 0;
	const topics = new Map<string, TopicStat>();

	questions.forEach((question, index) => {
		const optionCount = Math.max(2, question.secenekler?.length ?? 4);
		const answer = answers[index] ?? null;
		const validAnswer = answer && LETTERS.indexOf(answer) < optionCount ? answer : null;
		const correct = validAnswer === question.dogruSecenek;

		if (!validAnswer) bos++;
		else if (correct) {
			dogru++;
			net += 1;
		} else {
			yanlis++;
			net -= 1 / (optionCount - 1);
		}

		const topic = question.konu ?? { id: 0, ad: "Diğer", slug: "diger" };
		const stat = topics.get(topic.slug) ?? {
			slug: topic.slug,
			ad: topic.ad,
			toplam: 0,
			dogru: 0,
			oran: 0,
		};
		stat.toplam++;
		if (correct) stat.dogru++;
		topics.set(topic.slug, stat);
	});

	const konular = [...topics.values()].map((t) => ({
		...t,
		oran: Math.round((t.dogru / t.toplam) * 100),
	}));
	return {
		dogru,
		yanlis,
		bos,
		net: Math.round(net * 100) / 100,
		soruSayisi: questions.length,
		konular,
	};
}

/** Weakest topics first (lowest success, then more questions); fully correct topics are left out. */
export function weakestTopics(konular: TopicStat[], count: number): TopicStat[] {
	return konular
		.filter((t) => t.slug !== "diger" && t.oran < 100)
		.sort((a, b) => a.oran - b.oran || b.toplam - a.toplam)
		.slice(0, count);
}

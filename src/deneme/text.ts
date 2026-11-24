/** Strapi "blocks" rich text → plain text (paragraphs separated by blank lines). */
// biome-ignore lint/suspicious/noExplicitAny: Strapi blocks are a loose JSON tree
export function blocksToText(blocks: any): string {
	if (!Array.isArray(blocks)) return typeof blocks === "string" ? blocks : "";
	// biome-ignore lint/suspicious/noExplicitAny: see above
	const inline = (nodes: any[]): string =>
		(nodes ?? []).map((n) => (typeof n?.text === "string" ? n.text : inline(n?.children ?? []))).join("");
	return blocks
		.map((block) => {
			if (block?.type === "list") {
				// biome-ignore lint/suspicious/noExplicitAny: see above
				return (block.children ?? []).map((item: any) => `• ${inline(item.children ?? [])}`).join("\n");
			}
			return inline(block?.children ?? []);
		})
		.map((t: string) => t.trim())
		.filter(Boolean)
		.join("\n\n");
}

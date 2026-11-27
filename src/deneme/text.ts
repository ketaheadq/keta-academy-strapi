/** Strapi "blocks" rich text → plain text (paragraphs separated by blank lines). */
type BlockNode = { type?: string; text?: unknown; children?: BlockNode[] };

export function blocksToText(blocks: unknown): string {
	if (!Array.isArray(blocks)) return typeof blocks === "string" ? blocks : "";
	const inline = (nodes: BlockNode[]): string =>
		(nodes ?? [])
			.map((n) => (typeof n?.text === "string" ? n.text : inline(n?.children ?? [])))
			.join("");
	return (blocks as BlockNode[])
		.map((block) => {
			if (block?.type === "list") {
				return (block.children ?? []).map((item) => `• ${inline(item.children ?? [])}`).join("\n");
			}
			return inline(block?.children ?? []);
		})
		.map((t) => t.trim())
		.filter(Boolean)
		.join("\n\n");
}

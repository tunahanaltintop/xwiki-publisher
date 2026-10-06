/** Accepts tokens pasted with surrounding whitespace, quotes or an extra "Bearer " prefix. */
export function normalizeToken(token: string): string {
	return token
		.trim()
		.replace(/^["']|["']$/g, "")
		.replace(/^bearer\s+/i, "")
		.trim();
}

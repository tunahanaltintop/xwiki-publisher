import { htmlToMarkdown } from "obsidian";

/**
 * Converts the rendered HTML of an XWiki page (any syntax) into Markdown.
 * Relative links and image sources are made absolute first, so attachments and page links can be recognised
 * and turned into vault files and wiki links afterwards.
 */
export function xwikiHtmlToMarkdown(html: string, baseUrl: string, containerSelector?: string): string | null {
	const doc = new DOMParser().parseFromString(html, "text/html");
	// A full page view carries the skin around the content: keep only the content area.
	const root = containerSelector ? doc.querySelector(containerSelector) : doc.body;
	if (!root) return null;
	root.querySelectorAll("script, style, noscript").forEach((el) => el.remove());

	const base = `${baseUrl.replace(/\/+$/, "")}/`;
	const absolutize = (selector: string, attribute: string) => {
		root.querySelectorAll(selector).forEach((el) => {
			const value = el.getAttribute(attribute);
			if (!value || value.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(value)) return;
			try {
				el.setAttribute(attribute, new URL(value, base).href);
			} catch {
				// leave malformed URLs untouched
			}
		});
	};
	absolutize("a[href]", "href");
	absolutize("img[src]", "src");

	return htmlToMarkdown(root as HTMLElement).trim() + "\n";
}

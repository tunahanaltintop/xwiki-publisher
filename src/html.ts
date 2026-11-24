import { htmlToMarkdown } from "obsidian";

/**
 * Text of rendered HTML as a browser gives it for a selection, which is what XWiki's own comment dialog sends when
 * a comment is added on a text.
 */
export function htmlToText(html: string): string {
	const doc = new DOMParser().parseFromString(html, "text/html");
	doc.querySelectorAll("script, style, noscript, template").forEach((el) => el.remove());
	return doc.body.textContent ?? "";
}

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
	// A rendered mention is a link to the profile of the user, with the anchor of the mention as its id: the link of
	// the note keeps it, so that publishing the note mentions the user at the same anchor instead of anew.
	root.querySelectorAll("a.xwiki-mention[id][href]").forEach((el) => {
		const href = el.getAttribute("href") ?? "";
		if (!href.includes("#")) el.setAttribute("href", `${href}#${encodeURIComponent(el.id)}`);
	});

	return htmlToMarkdown(root as HTMLElement).trim() + "\n";
}

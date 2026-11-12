/**
 * Converts XWiki page content back into Obsidian Markdown. Free of Obsidian imports so it can be unit tested.
 */
import { EMPTY_CELL, transformOutsideCode } from "./converter.ts";
import {
	blockIdsFromMacros,
	commentsFromMacros,
	extractBlockIds,
	extractHeadings,
	footnotesFromMacros,
	highlightsFromHtml,
	macrosToCallouts,
	softenLineBreaks,
	subpathFor,
	tasksFromSymbols,
	unescapeMacros,
	unescapeMarkdown12,
} from "./obsidian-syntax.ts";

export type ReverseTarget =
	/** `linktext` points at the downloaded file when known; the attachment name is used otherwise. */
	| { kind: "attachment"; name: string; linktext?: string }
	/** `headings` and `blocks` of the note let anchors (`#HIntro`) come back as `#Intro` / `#^block` subpaths. */
	| { kind: "note"; linktext: string; basename: string; headings?: string[]; blocks?: string[] }
	/** Something outside the vault, e.g. a page that was not pulled: linked by URL. */
	| { kind: "url"; url: string };

/** Prefixes standing for XWiki references (`[[label|Space.Page]]`, `![[alt|file.png]]`) handed to the resolver. */
export const XWIKI_LINK = "xwiki-link:";
export const XWIKI_IMAGE = "xwiki-image:";

/**
 * Maps a link/image target found in XWiki content to a vault file, or `null` to leave the link as is.
 * Targets starting with `XWIKI_LINK` or `XWIKI_IMAGE` carry an encoded XWiki reference and must be resolved.
 * Fragments (`#anchor`) are removed before the resolver is called.
 */
export type ReverseResolver = (target: string, image: boolean) => ReverseTarget | null;

export interface ReverseOptions {
	/** Single line breaks are line breaks in the vault: hard breaks written on publish are removed. */
	hardLineBreaks?: boolean;
	/** `{{comment}}` macros come back as `%%comments%%` (when publishing writes comments as macros). */
	comments?: "remove" | "macro";
}

export interface ReverseResult {
	markdown: string;
	/** Attachments of the page that the note refers to and that must be downloaded. */
	attachments: Set<string>;
}

/** Returns the Markdown source of a page written in a `markdown/*` syntax, or `null` for any other page. */
export function extractMarkdown(content: string, syntax: string): string | null {
	return /^markdown\//i.test(syntax) ? content : null;
}

function unescapeLabel(label: string): string {
	return label.replace(/\\([[\]])/g, "$1");
}

/** Inside a table the alias separator must be escaped, or it would split the cell. */
function wikiLink(embed: boolean, linktext: string, label: string | undefined, inTable = false): string {
	return `${embed ? "!" : ""}[[${linktext}${label ? `${inTable ? "\\|" : "|"}${label}` : ""}]]`;
}

function isTableLine(text: string, offset: number): boolean {
	return text.slice(text.lastIndexOf("\n", offset) + 1).trimStart().startsWith("|");
}

function decode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

/** Value of a parameter (`anchor="H1"`) in the parameter part of a wiki link. */
function linkParameter(parameters: string, key: string): string | undefined {
	const match = new RegExp(`(?:^|\\s)${key}\\s*=\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|'([^']*)'|(\\S+))`).exec(parameters);
	if (!match) return undefined;
	return match[1] !== undefined ? match[1].replace(/\\(.)/g, "$1") : (match[2] ?? match[3]);
}

/**
 * Splits the inside of a Markdown 1.2 wiki link: `label|reference|parameters`, `reference|parameters`,
 * `label|reference` or `reference`. In tables the separators may be written `\|`.
 */
function splitWikiLink(inner: string): { label?: string; reference: string; parameters: string } {
	const parts = inner.split("|").map((part, i, all) => (i < all.length - 1 ? part.replace(/\\$/, "") : part));
	if (parts.length >= 3) return { label: parts[0], reference: parts[1], parameters: parts.slice(2).join("|") };
	if (parts.length === 2 && /^\s*[A-Za-z]\w*\s*=/.test(parts[1])) return { reference: parts[0], parameters: parts[1] };
	if (parts.length === 2) return { label: parts[0], reference: parts[1], parameters: "" };
	return { reference: parts[0], parameters: "" };
}

export function convertFromXWiki(markdown: string, resolve: ReverseResolver, options: ReverseOptions = {}): ReverseResult {
	const attachments = new Set<string>();
	// Anchors into this page come back as links to its own headings and block ids.
	const headings = extractHeadings(markdown);
	const blocks = extractBlockIds(markdown);
	const footnotes: string[] = [];
	// Converted embeds are kept aside, so the link conversions below do not read them as XWiki wiki links.
	const kept: string[] = [];
	const keep = (text: string) => {
		kept.push(text);
		return `\uE030${kept.length - 1}\uE031`;
	};

	const note = (resolved: Extract<ReverseTarget, { kind: "note" }>, fragment: string | undefined) => {
		const subpath = fragment ? subpathFor(resolved.headings ?? [], resolved.blocks ?? [], fragment) : null;
		return { linktext: subpath ? `${resolved.linktext}#${subpath}` : resolved.linktext, subpath };
	};

	const embeds = (text: string) =>
		text
			// Embedded notes and sections: {{display reference="Space.Note.WebHome" section="HIntro"/}}
			.replace(
				/\{\{display\s+reference=(?:"([^"]*)"|'([^']*)')(?:\s+section=(?:"([^"]*)"|'([^']*)'))?\s*\/\}\}/g,
				(whole, r1?: string, r2?: string, s1?: string, s2?: string) => {
					const resolved = resolve(`${XWIKI_LINK}${encodeURIComponent((r1 ?? r2 ?? "").trim())}`, false);
					if (resolved?.kind !== "note") return whole;
					return keep(`![[${note(resolved, s1 ?? s2).linktext}]]`);
				},
			)
			// Images with a size: {{content syntax="xwiki/2.1"}}[[image:a.png||width="300"]]{{/content}}
			// In tables the separators are written "\|".
			.replace(
				/\{\{content syntax="xwiki\/2\.1"\}\}\[\[image:([^\]|\\]+)\\?\|\\?\|width="(\d+)"(?: height="(\d+)")?\]\]\{\{\/content\}\}/g,
				(whole: string, name: string, width: string, height: string | undefined, offset: number, all: string) => {
					const resolved = resolve(`${XWIKI_IMAGE}${encodeURIComponent(name)}`, true);
					if (resolved?.kind !== "attachment") return whole;
					attachments.add(resolved.name);
					const size = `${width}${height ? `x${height}` : ""}`;
					return keep(`![[${resolved.linktext ?? resolved.name}${isTableLine(all, offset) ? "\\|" : "|"}${size}]]`);
				},
			);

	const withoutBoxes = macrosToCallouts(markdown);
	const converted = transformOutsideCode(withoutBoxes, (text) => {
		let out = options.hardLineBreaks ? softenLineBreaks(text) : text;
		out = embeds(out);
		out = blockIdsFromMacros(out);
		out = tasksFromSymbols(out);
		out = highlightsFromHtml(out);
		if (options.comments === "macro") out = commentsFromMacros(out);
		out = unescapeMacros(unescapeMarkdown12(out));
		// Footnotes last, so their text is converted like the rest of the page.
		return footnotesFromMacros(
			out
				// Cells filled on publish so XWiki keeps the columns are empty again in the note.
				.replace(/^\s*\|.*$/gm, (row) => row.split(`| ${EMPTY_CELL} |`).join("|  |").split(`| ${EMPTY_CELL} |`).join("|  |"))
				// XWiki links an image to its own full-size file: keep just the image, a link around an embed is not valid.
				// Images linking elsewhere (a badge linking to a site) keep their link.
				.replace(/\[(!\[[^\]\n]*\]\((?:<([^>\n]+)>|([^)\s]+))\))\]\((?:<([^>\n]+)>|([^)\s]+))\)/g, (whole, image: string, a1?: string, a2?: string, b1?: string, b2?: string) => {
					const inner = (a1 ?? a2 ?? "").split(/[?#]/)[0];
					const outer = (b1 ?? b2 ?? "").split(/[?#]/)[0];
					return inner === outer ? image : whole;
				})
				// XWiki Markdown 1.2 wiki-style links put the label first: [[label|reference|anchor="H1"]], ![[alt|reference]].
				// Obsidian reads [[x|y]] the other way round, so turn them into regular links resolved below; the anchor
				// becomes the URL fragment. "[[1]](url)" is a regular link whose label is "[1]", not a wiki link.
				.replace(/(!?)\[\[([^\]\n]+)\]\](?!\()/g, (_whole, bang: string, inner: string) => {
					const { label, reference, parameters } = splitWikiLink(inner);
					const prefix = bang ? XWIKI_IMAGE : XWIKI_LINK;
					const anchor = linkParameter(parameters, "anchor");
					const text = (label ?? reference).replace(/&#124;/g, "|");
					// An empty reference is the page itself: `[[label||anchor="H1"]]`.
					if (!reference.trim() && anchor && !bang) return `[${text}](#${encodeURIComponent(anchor)})`;
					return `${bang}[${text}](${prefix}${encodeURIComponent(reference.trim())}${anchor ? `#${encodeURIComponent(anchor)}` : ""})`;
				})
				.replace(
					/(!?)\[((?:\\.|[^\]\\\n])*)\]\((?:<([^>\n]+)>|([^)\s]+))(\s+"[^"\n]*")?\)/g,
					(whole: string, bang: string, rawLabel: string, angled: string | undefined, plain: string | undefined, _title: string | undefined, offset: number, all: string) => {
						const inTable = isTableLine(all, offset);
						const target = angled ?? plain ?? "";
						const image = bang === "!";
						const hash = target.indexOf("#");
						const base = hash >= 0 ? target.slice(0, hash) : target;
						const fragment = hash >= 0 ? decode(target.slice(hash + 1)) : undefined;
						const label = unescapeLabel(rawLabel);
						// A link to an anchor of this page: [[#Heading]] or [[#^block]].
						if (!base) {
							const subpath = fragment && !image ? subpathFor(headings, blocks, fragment) : null;
							if (!subpath) return whole;
							return wikiLink(false, `#${subpath}`, label && label !== subpath ? label : undefined, inTable);
						}
						const resolved = resolve(base, image);
						if (!resolved) return whole;
						if (resolved.kind === "url") {
							const url = fragment !== undefined ? `${resolved.url}#${fragment}` : resolved.url;
							return `${image ? "!" : ""}[${rawLabel}](${/[\s()]/.test(url) ? `<${url}>` : url})`;
						}
						if (resolved.kind === "attachment") {
							attachments.add(resolved.name);
							return wikiLink(image, resolved.linktext ?? resolved.name, label && label !== resolved.name ? label : undefined, inTable);
						}
						const { linktext, subpath } = note(resolved, fragment);
						// The label publish writes for [[Note#Heading]] is "Note > Heading".
						const same =
							!label || label === resolved.basename || label === resolved.linktext || label === linktext || (subpath !== null && label === `${resolved.basename} > ${subpath}`);
						return wikiLink(false, linktext, same ? undefined : label, inTable);
					},
				),
			footnotes,
		);
	});
	const restore = (text: string) => text.replace(/\uE030(\d+)\uE031/g, (_m, i: string) => kept[Number(i)]);
	let result = restore(converted.trim());
	if (footnotes.length > 0) result += `\n\n${footnotes.map((text, i) => `[^${i + 1}]: ${restore(text)}`).join("\n")}`;
	return { markdown: result + "\n", attachments };
}

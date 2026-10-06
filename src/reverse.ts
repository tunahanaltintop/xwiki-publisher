/**
 * Converts XWiki page content back into Obsidian Markdown. Free of Obsidian imports so it can be unit tested.
 */
import { EMPTY_CELL, transformOutsideCode } from "./converter.ts";

export type ReverseTarget =
	/** `linktext` points at the downloaded file when known; the attachment name is used otherwise. */
	| { kind: "attachment"; name: string; linktext?: string }
	| { kind: "note"; linktext: string; basename: string }
	/** Something outside the vault, e.g. a page that was not pulled: linked by URL. */
	| { kind: "url"; url: string };

/** Prefixes standing for XWiki references (`[[label|Space.Page]]`, `![[alt|file.png]]`) handed to the resolver. */
export const XWIKI_LINK = "xwiki-link:";
export const XWIKI_IMAGE = "xwiki-image:";

/**
 * Maps a link/image target found in XWiki content to a vault file, or `null` to leave the link as is.
 * Targets starting with `XWIKI_LINK` or `XWIKI_IMAGE` carry an encoded XWiki reference and must be resolved.
 */
export type ReverseResolver = (target: string, image: boolean) => ReverseTarget | null;

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

export function convertFromXWiki(markdown: string, resolve: ReverseResolver): ReverseResult {
	const attachments = new Set<string>();
	const converted = transformOutsideCode(markdown, (text) =>
		text
			// Cells filled on publish so XWiki keeps the columns are empty again in the note.
			.replace(/^\s*\|.*$/gm, (row) => row.split(`| ${EMPTY_CELL} |`).join("|  |").split(`| ${EMPTY_CELL} |`).join("|  |"))
			// XWiki links an image to its own full-size file: keep just the image, a link around an embed is not valid.
			// Images linking elsewhere (a badge linking to a site) keep their link.
			.replace(/\[(!\[[^\]\n]*\]\((?:<([^>\n]+)>|([^)\s]+))\))\]\((?:<([^>\n]+)>|([^)\s]+))\)/g, (whole, image: string, a1?: string, a2?: string, b1?: string, b2?: string) => {
				const inner = (a1 ?? a2 ?? "").split(/[?#]/)[0];
				const outer = (b1 ?? b2 ?? "").split(/[?#]/)[0];
				return inner === outer ? image : whole;
			})
			// XWiki Markdown 1.2 wiki-style links put the label first: [[label|reference]], ![[alt|reference]].
			// Obsidian reads [[x|y]] the other way round, so turn them into regular links resolved below.
			// "[[1]](url)" is a regular link whose label is "[1]", not a wiki link.
			.replace(/(!?)\[\[(?:([^\]|\n]*)\|)?([^\]|\n]+)\]\](?!\()/g, (_whole, bang: string, label: string | undefined, reference: string) => {
				const prefix = bang ? XWIKI_IMAGE : XWIKI_LINK;
				// In tables the separator is written "\|"; the backslash is not part of the label.
				const text = (label ?? reference).replace(/\\$/, "");
				return `${bang}[${text}](${prefix}${encodeURIComponent(reference.trim())})`;
			})
			.replace(
			/(!?)\[((?:\\.|[^\]\\\n])*)\]\((?:<([^>\n]+)>|([^)\s]+))(\s+"[^"\n]*")?\)/g,
			(whole: string, bang: string, rawLabel: string, angled: string | undefined, plain: string | undefined, _title: string | undefined, offset: number, all: string) => {
				const inTable = isTableLine(all, offset);
				const target = angled ?? plain ?? "";
				const image = bang === "!";
				const resolved = resolve(target, image);
				if (!resolved) return whole;
				const label = unescapeLabel(rawLabel);
				if (resolved.kind === "url") return `${image ? "!" : ""}[${rawLabel}](${/[\s()]/.test(resolved.url) ? `<${resolved.url}>` : resolved.url})`;
				if (resolved.kind === "attachment") {
					attachments.add(resolved.name);
					return wikiLink(image, resolved.linktext ?? resolved.name, label && label !== resolved.name ? label : undefined, inTable);
				}
				const same = label === resolved.basename || label === resolved.linktext || !label;
				return wikiLink(false, resolved.linktext, same ? undefined : label, inTable);
			},
		),
	);
	return { markdown: converted.trim() + "\n", attachments };
}

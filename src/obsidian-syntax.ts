/**
 * Obsidian Markdown features that XWiki Markdown 1.2 does not have, written as XWiki constructs on publish and read
 * back on pull. Every publish mapping has an inverse, so a page that is not edited on XWiki brings back the note it
 * was published from. Free of Obsidian imports so it can be unit tested.
 *
 * What Markdown 1.2 accepts comes from the parser of the XWiki Markdown Syntax extension (xwiki-contrib/syntax-markdown):
 * CommonMark with wiki links, autolinks, tables, `~~strike~~`/`~sub~`, `^sup^`, definition lists, abbreviations,
 * XWiki macros, `<div>` groups and inline HTML (turned into HTML macros).
 */

/* ------------------------------------------------------------------------------------------------ Heading anchors */

/** Characters XWiki keeps in generated ids; see `IdGenerator` in xwiki-rendering. */
const ID_CHAR = /^[A-Za-z0-9:_.-]$/;
/** `Character.isWhitespace` in Java: no-break spaces are not whitespace there. */
function isJavaWhitespace(code: number): boolean {
	return (code >= 0x09 && code <= 0x0d) || (code >= 0x1c && code <= 0x20) || code === 0x1680 || (code >= 0x2000 && code <= 0x2006) ||
		(code >= 0x2008 && code <= 0x200a) || code === 0x2028 || code === 0x2029 || code === 0x205f || code === 0x3000;
}

/**
 * Port of XWiki's `IdGenerator.normalizeId`: allowed characters are kept, whitespace is dropped and any other UTF-16
 * code unit is written as upper-case hex without leading zeros (`ş` → `15F`).
 */
export function normalizeXWikiId(text: string): string {
	let out = "";
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ID_CHAR.test(ch)) out += ch;
		else if (!isJavaWhitespace(text.charCodeAt(i))) out += text.charCodeAt(i).toString(16).toUpperCase();
	}
	return out;
}

/** Plain text of a heading as XWiki renders it, which is what its id is generated from (best effort). */
export function plainHeading(text: string): string {
	return text
		.replace(/!?\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_m, target: string, alias?: string) => alias ?? target.split("#")[0].split("/").pop() ?? "")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/<[^>]+>/g, "")
		.replace(/\*\*|__|~~|==|`|\*/g, "")
		.replace(/\\(.)/g, "$1")
		.trim();
}

/** Ids XWiki gives to these headings (in document order), with its `-1`, `-2`… suffixes for repeated headings. */
export function headingIds(headings: string[]): string[] {
	const used = new Set<string>();
	return headings.map((heading) => {
		const base = `H${normalizeXWikiId(plainHeading(heading))}`;
		let id = base;
		for (let n = 1; used.has(id); n++) id = `${base}-${n}`;
		used.add(id);
		return id;
	});
}

/** Comparable form of a heading or of a link subpath; Obsidian links drop some characters of headings. */
function headingKey(text: string): string {
	return plainHeading(text)
		.replace(/[#|^:[\]]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

/**
 * Text a link uses for a heading: its plain text (`## **1.1 Amaç**` gives `1.1 Amaç`, as the note's own links write
 * it) without the characters Obsidian links cannot contain.
 */
function linkHeading(heading: string): string {
	return plainHeading(heading).replace(/[#|^:[\]]/g, " ").replace(/\s+/g, " ").trim();
}

/** XWiki anchor for an Obsidian link subpath (`Heading` or `^block`) into a note with these headings. */
export function anchorFor(headings: string[], subpath: string): string {
	if (subpath.startsWith("^")) return subpath.slice(1);
	const key = headingKey(subpath);
	const index = headings.findIndex((heading) => headingKey(heading) === key);
	return index >= 0 ? headingIds(headings)[index] : `H${normalizeXWikiId(plainHeading(subpath))}`;
}

/** Obsidian link subpath for an XWiki anchor into a note with these headings and block ids, or `null`. */
export function subpathFor(headings: string[], blocks: string[], anchor: string): string | null {
	const index = headingIds(headings).indexOf(anchor);
	if (index >= 0) return linkHeading(headings[index]);
	return blocks.includes(anchor) ? `^${anchor}` : null;
}

/** ATX headings of a Markdown text, outside fenced code. */
export function extractHeadings(markdown: string): string[] {
	const headings: string[] = [];
	let fence: string | null = null;
	for (const line of markdown.split("\n")) {
		const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
		if (fence !== null) {
			if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length && line.trim() === fenceMatch[1]) fence = null;
			continue;
		}
		if (fenceMatch) {
			fence = fenceMatch[1];
			continue;
		}
		const heading = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
		if (heading) headings.push(heading[1]);
	}
	return headings;
}

/** Block ids published as `{{id}}` macros in XWiki Markdown. */
export function extractBlockIds(markdown: string): string[] {
	return [...markdown.matchAll(/\{\{id name="([A-Za-z0-9-]+)"\/\}\}/g)].map((match) => match[1]);
}

/* ------------------------------------------------------------------------------------------------ Macro parameters */

/** A macro parameter value, quoted so that the Markdown 1.2 macro parser reads it back unchanged. */
export function quoteParameter(value: string): string {
	if (!value.includes('"')) return `"${value}"`;
	if (!value.includes("'")) return `'${value}'`;
	return `"${value.replace(/"/g, "”")}"`;
}

function parseParameters(text: string): Map<string, string> | null {
	const parameters = new Map<string, string>();
	const pattern = /\s*([A-Za-z]\w*)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
	let position = 0;
	while (position < text.length) {
		pattern.lastIndex = position;
		const match = pattern.exec(text);
		if (!match) return text.slice(position).trim() ? null : parameters;
		parameters.set(match[1], match[2] ?? match[3]);
		position = pattern.lastIndex;
	}
	return parameters;
}

function isFenceLine(line: string): RegExpExecArray | null {
	return /^\s*(`{3,}|~{3,})/.exec(line);
}

/* ------------------------------------------------------------------------------------------------ Callouts */

/** XWiki message box used for each Obsidian callout type; other types use the info box. */
const CALLOUT_BOXES: Record<string, string> = {
	tip: "success",
	hint: "success",
	important: "success",
	success: "success",
	check: "success",
	done: "success",
	warning: "warning",
	caution: "warning",
	attention: "warning",
	failure: "error",
	fail: "error",
	missing: "error",
	danger: "error",
	error: "error",
	bug: "error",
};
const CLASS_PREFIX = "obsidian-callout-";
const FOLDED = `${CLASS_PREFIX}folded`;
const OPEN = `${CLASS_PREFIX}open`;

/**
 * Turns top-level callouts (`> [!tip]- Title`) into XWiki message boxes, whose content is parsed as Markdown. The
 * callout type is kept in `cssClass` when it differs from the box name, and so is the fold marker, so that pull
 * restores them. Fenced code inside callouts becomes real fenced code inside the box.
 */
export function calloutsToMacros(text: string): string {
	const lines = text.split("\n");
	const out: string[] = [];
	let fence: string | null = null;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const fenceMatch = isFenceLine(line);
		if (fence !== null) {
			if (fenceMatch && fenceMatch[1][0] === fence[0] && line.trim() === fenceMatch[1]) fence = null;
			out.push(line);
			continue;
		}
		if (fenceMatch) {
			fence = fenceMatch[1];
			out.push(line);
			continue;
		}
		const head = /^>[ \t]?\[!([^\]\s]+)\]([+-]?)[ \t]*(.*)$/.exec(line);
		if (!head) {
			out.push(line);
			continue;
		}
		const body: string[] = [];
		while (i + 1 < lines.length && lines[i + 1].startsWith(">")) body.push(lines[++i].replace(/^> ?/, ""));
		const [, type, fold, title] = head;
		const box = CALLOUT_BOXES[type.toLowerCase()] ?? "info";
		const classes = [type === box ? "" : `${CLASS_PREFIX}${type}`, fold === "-" ? FOLDED : fold === "+" ? OPEN : ""].filter(Boolean);
		const parameters = (title.trim() ? ` title=${quoteParameter(title.trim())}` : "") + (classes.length ? ` cssClass="${classes.join(" ")}"` : "");
		out.push(`{{${box}${parameters}}}`);
		if (body.length > 0) out.push(calloutsToMacros(body.join("\n")));
		out.push(`{{/${box}}}`);
	}
	return out.join("\n");
}

/**
 * Turns standalone message boxes back into callouts. Boxes with parameters other than `title`, or with CSS classes
 * that were not written by publish, are left as macros.
 */
export function macrosToCallouts(text: string): string {
	const lines = text.split("\n");
	const out: string[] = [];
	let fence: string | null = null;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const fenceMatch = isFenceLine(line);
		if (fence !== null) {
			if (fenceMatch && fenceMatch[1][0] === fence[0] && line.trim() === fenceMatch[1]) fence = null;
			out.push(line);
			continue;
		}
		if (fenceMatch) {
			fence = fenceMatch[1];
			out.push(line);
			continue;
		}
		const open = /^\{\{(info|warning|error|success)(\s[^}]*)?\}\}\s*$/.exec(line);
		const parameters = open ? parseParameters(open[2] ?? "") : null;
		const end = open ? closingLine(lines, i, open[1]) : -1;
		const classes = (parameters?.get("cssClass") ?? "").split(/\s+/).filter(Boolean);
		const convertible =
			open && parameters && end > i && [...parameters.keys()].every((key) => key === "title" || key === "cssClass") && classes.every((name) => name.startsWith(CLASS_PREFIX));
		if (!open || !parameters || !convertible) {
			out.push(line);
			continue;
		}
		const typeClass = classes.find((name) => name !== FOLDED && name !== OPEN);
		const type = typeClass ? typeClass.slice(CLASS_PREFIX.length) : open[1];
		const fold = classes.includes(FOLDED) ? "-" : classes.includes(OPEN) ? "+" : "";
		const title = parameters.get("title");
		out.push(`> [!${type}]${fold}${title ? ` ${title}` : ""}`);
		if (end > i + 1) for (const inner of macrosToCallouts(lines.slice(i + 1, end).join("\n")).split("\n")) out.push(inner ? `> ${inner}` : ">");
		i = end;
	}
	return out.join("\n");
}

/** Index of the line closing the box opened at `start`, counting nested boxes of the same kind, or -1. */
function closingLine(lines: string[], start: number, name: string): number {
	const opening = new RegExp(`^\\{\\{${name}(\\s[^}]*)?\\}\\}\\s*$`);
	let depth = 1;
	for (let j = start + 1; j < lines.length; j++) {
		if (opening.test(lines[j])) depth++;
		else if (lines[j].trim() === `{{/${name}}}` && --depth === 0) return j;
	}
	return -1;
}

/* ------------------------------------------------------------------------------------------------ Footnotes */

/** Removes footnote definitions (`[^1]: text`, with indented continuation lines) and records their text. */
export function extractFootnotes(text: string, notes: Map<string, string>): string {
	const lines = text.split("\n");
	const out: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const definition = /^\[\^([^\]\s]+)\]:[ \t]?(.*)$/.exec(lines[i]);
		if (!definition) {
			out.push(lines[i]);
			continue;
		}
		const parts = [definition[2].trim()];
		while (i + 1 < lines.length && /^( {2,}|\t)\S/.test(lines[i + 1])) parts.push(lines[++i].trim());
		notes.set(definition[1], parts.join(" "));
	}
	return out.join("\n");
}

/** Replaces footnote references and inline footnotes (`^[text]`) with XWiki footnote macros. */
export function footnotesToMacros(text: string, notes: Map<string, string>): string {
	const referenced = text.replace(/\[\^([^\]\s]+)\](?!:)/g, (whole, id: string) => {
		const note = notes.get(id);
		return note === undefined ? whole : `{{footnote}}${note}{{/footnote}}`;
	});
	let out = "";
	let i = 0;
	for (;;) {
		const start = referenced.indexOf("^[", i);
		if (start < 0) break;
		let depth = 0;
		let end = -1;
		for (let j = start + 1; j < referenced.length && referenced[j] !== "\n"; j++) {
			if (referenced[j] === "[") depth++;
			else if (referenced[j] === "]" && --depth === 0) {
				end = j;
				break;
			}
		}
		if (end < 0) {
			out += referenced.slice(i, start + 2);
			i = start + 2;
			continue;
		}
		out += `${referenced.slice(i, start)}{{footnote}}${referenced.slice(start + 2, end)}{{/footnote}}`;
		i = end + 1;
	}
	return out + referenced.slice(i);
}

/** Replaces footnote macros with numbered references; their texts are collected in `notes` (in order). */
export function footnotesFromMacros(text: string, notes: string[]): string {
	return text.replace(/\{\{footnote\}\}([\s\S]*?)\{\{\/footnote\}\}/g, (_m, note: string) => {
		notes.push(note.replace(/\s*\n\s*/g, " ").trim());
		return `[^${notes.length}]`;
	});
}

/* ------------------------------------------------------------------------------------------------ Inline features */

/** Block ids (`text ^id`, or `^id` alone on a line) become `{{id}}` anchors, which links can target. */
export function blockIdsToMacros(text: string): string {
	return text
		.replace(/^(.*\S)[ \t]+\^([A-Za-z0-9-]+)[ \t]*$/gm, '$1 {{id name="$2"/}}')
		.replace(/^\^([A-Za-z0-9-]+)[ \t]*$/gm, '{{id name="$1"/}}');
}

export function blockIdsFromMacros(text: string): string {
	return text.replace(/ \{\{id name="([A-Za-z0-9-]+)"\/\}\}$/gm, " ^$1").replace(/^\{\{id name="([A-Za-z0-9-]+)"\/\}\}$/gm, "^$1");
}

const TASK_SYMBOLS: Record<string, string> = { " ": "☐", x: "☑", X: "☒" };
const TASK_MARKS: Record<string, string> = { "☐": " ", "☑": "x", "☒": "X" };

/** Task list items: Markdown 1.2 has no task lists, so the boxes are written as ballot box characters. */
export function tasksToSymbols(text: string): string {
	return text.replace(/^(\s*(?:[-*+]|\d+[.)])[ \t]+)\[([ xX])\](?=[ \t]|$)/gm, (_m, marker: string, state: string) => `${marker}${TASK_SYMBOLS[state]}`);
}

export function tasksFromSymbols(text: string): string {
	return text.replace(/^(\s*(?:[-*+]|\d+[.)])[ \t]+)([☐☑☒])(?=[ \t]|$)/gm, (_m, marker: string, symbol: string) => `${marker}[${TASK_MARKS[symbol]}]`);
}

/**
 * Obsidian's highlight colours: the colour is an emoji at the start of the highlight (`==🟢text==`), which Obsidian
 * hides. Its menu writes circles; squares are read as the same colours. The background is Obsidian's light-theme
 * colour at its highlight opacity (30%).
 */
const HIGHLIGHT_RGB: Record<string, string> = {
	red: "233, 49, 71",
	orange: "236, 117, 0",
	yellow: "224, 172, 0",
	green: "8, 185, 78",
	blue: "8, 109, 221",
	purple: "120, 82, 238",
};
const CIRCLES = ["🔴", "🟠", "🟡", "🟢", "🔵", "🟣"];
const SQUARES = ["🟥", "🟧", "🟨", "🟩", "🟦", "🟪"];
/** Emoji → class suffix; squares get their own suffix so they come back as squares. */
const HIGHLIGHT_CLASSES: Record<string, string> = Object.fromEntries(
	Object.keys(HIGHLIGHT_RGB).flatMap((color, i) => [
		[CIRCLES[i], color],
		[SQUARES[i], `${color}-square`],
	]),
);
const HIGHLIGHT_EMOJI = Object.fromEntries(Object.entries(HIGHLIGHT_CLASSES).map(([emoji, name]) => [name, emoji]));
const HIGHLIGHT_PREFIX = "obsidian-highlight-";

/**
 * `==text==` becomes `<mark>`, which Markdown 1.2 turns into an inline HTML macro. A coloured highlight (`==🟢text==`)
 * gets its colour as a class, for the way back, and as an inline style, so XWiki shows it without extra CSS.
 */
export function highlightsToHtml(text: string): string {
	// No lookbehind: it is a syntax error on iOS before 16.4.
	return text.replace(/(^|[^=])==(?![=\s])([^\n]*?[^=\s])==(?!=)/gm, (_m, before: string, inner: string) => {
		const emoji = Object.keys(HIGHLIGHT_CLASSES).find((key) => inner.startsWith(key) && inner.length > key.length);
		if (!emoji) return `${before}<mark>${inner}</mark>`;
		const name = HIGHLIGHT_CLASSES[emoji];
		const rgb = HIGHLIGHT_RGB[name.replace(/-square$/, "")];
		return `${before}<mark class="${HIGHLIGHT_PREFIX}${name}" style="background-color: rgba(${rgb}, 0.3)">${inner.slice(emoji.length)}</mark>`;
	});
}

export function highlightsFromHtml(text: string): string {
	return text
		.replace(/<mark class="obsidian-highlight-([a-z-]+)"[^>\n]*>([^\n]*?)<\/mark>/g, (match, name: string, inner: string) => {
			const emoji = HIGHLIGHT_EMOJI[name];
			return emoji ? `==${emoji}${inner}==` : match;
		})
		.replace(/<mark>([^\n]*?)<\/mark>/g, "==$1==");
}

/** Obsidian comments are removed, or kept as `{{comment}}` macros, hidden on the page but kept in its source. */
export function convertComments(text: string, mode: "remove" | "macro"): string {
	return mode === "macro" ? text.replace(/%%([\s\S]*?)%%/g, "{{comment}}$1{{/comment}}") : text.replace(/%%[\s\S]*?%%/g, "");
}

export function commentsFromMacros(text: string): string {
	return text.replace(/\{\{comment\}\}([\s\S]*?)\{\{\/comment\}\}/g, "%%$1%%");
}

/* ------------------------------------------------------------------------------------------------ Escapes */

/** Syntax whose text must not be escaped: macro tags, links, images, HTML tags and URLs. */
const PROTECTED = /\{\{[\s\S]*?\}\}|!?\[\[[^\]\n]*\]\]|!?\[[^\]\n]*\]\([^)\n]*\)|<\/?[A-Za-z][^>\n]*>|[a-z][a-z0-9+.-]*:\/\/[^\s<>)\]]+/gi;

/**
 * Escapes what Markdown 1.2 reads as syntax although Obsidian shows it as text: `~sub~`, `^sup^`, a line starting
 * with `:` (definition list) and a line starting with `*[` (abbreviation definition, which hides the line).
 */
export function escapeMarkdown12(text: string): string {
	const kept: string[] = [];
	const masked = text.replace(PROTECTED, (match) => {
		kept.push(match);
		return `\uE020${kept.length - 1}\uE021`;
	});
	return masked
		// Character references, not backslashes: some versions of the Markdown 1.2 parser show backslash escapes as
		// they are. A single tilde is escaped, `~~` (strikethrough) is not; characters already escaped stay as they are.
		.replace(/\\?~+/g, (run) => (run === "~" ? "&#126;" : run))
		.replace(/\\?\^/g, (caret) => (caret === "^" ? "&#94;" : caret))
		.replace(/^([ \t]*):(?=\s)/gm, "$1&#58;")
		.replace(/^([ \t]*)\*\[/gm, "$1&#42;[")
		.replace(/\uE020(\d+)\uE021/g, (_m, i: string) => kept[Number(i)]);
}

export function unescapeMarkdown12(text: string): string {
	// Backslash escapes are what earlier builds wrote, and what the XWiki editor writes.
	return text
		.replace(/&#126;|\\~/g, "~")
		.replace(/&#94;|\\\^/g, "^")
		.replace(/^([ \t]*)(?:&#58;|\\:)(?=\s)/gm, "$1:")
		.replace(/^([ \t]*)(?:&#42;|\\\*)\[/gm, "$1*[");
}

/**
 * Escapes macro tags that would only produce an error on XWiki: an opening tag without its closing tag
 * (`{{title}}` in a template) or a closing tag without its opening one. Obsidian shows them as text, and so does XWiki
 * once its first brace is written `&#123;` (some parser versions show a backslash escape as it is). Self-closing (`{{toc/}}`) and closed (`{{info}}…{{/info}}`) macros are kept, so XWiki macros
 * can still be written in notes.
 */
export function escapeUnclosedMacros(text: string): string {
	const tag = /\\?\{\{(\/)?([A-Za-z][\w.-]*)((?:\s(?:"[^"]*"|'[^']*'|[^}"'])*)?)\}\}/g;
	const tags: { index: number; closing: boolean; name: string; matched: boolean }[] = [];
	const open: number[] = [];
	for (const match of text.matchAll(tag)) {
		if (match[0].startsWith("\\")) continue;
		const selfClosing = !match[1] && match[3].trimEnd().endsWith("/");
		const entry = { index: match.index, closing: Boolean(match[1]), name: match[2], matched: selfClosing };
		tags.push(entry);
		if (selfClosing) continue;
		if (!entry.closing) {
			open.push(tags.length - 1);
			continue;
		}
		// The innermost open tag of the same name closes; tags opened inside it and never closed stay unmatched.
		for (let i = open.length - 1; i >= 0; i--) {
			if (tags[open[i]].name === entry.name) {
				tags[open[i]].matched = true;
				entry.matched = true;
				open.splice(i);
				break;
			}
		}
	}
	let out = text;
	for (const entry of [...tags].reverse()) if (!entry.matched) out = `${out.slice(0, entry.index)}&#123;${out.slice(entry.index + 1)}`;
	return out;
}

export function unescapeMacros(text: string): string {
	return text.replace(/(?:&#123;|\\\{)(\{\/?[A-Za-z])/g, "{$1");
}

/* ------------------------------------------------------------------------------------------------ Line breaks */

/** Lines that start or are a block of their own: no line break is added after or before them. */
const STRUCTURAL = /^\s*(?:\||#{1,6}(?:\s|$)|(?:[-*_][ \t]*){3,}$|=+\s*$|\{\{\/?[A-Za-z][^}]*\}\}\s*$|<\/?[A-Za-z][^>]*>\s*$)/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])(?:\s|$)/;

/**
 * Obsidian shows single line breaks as line breaks unless "Strict line breaks" is on, while Markdown 1.2 reads them
 * as spaces: lines continuing a paragraph get the two-space hard break.
 */
export function hardenLineBreaks(text: string): string {
	const lines = text.split("\n");
	for (let i = 0; i < lines.length - 1; i++) {
		const line = lines[i];
		const next = lines[i + 1];
		if (!line.trim() || !next.trim()) continue;
		if (STRUCTURAL.test(line) || STRUCTURAL.test(next) || LIST_ITEM.test(next)) continue;
		if (/(?: {2,}|\\|<br\s*\/?>)$/i.test(line)) continue;
		if (/^\s*>/.test(next) !== /^\s*>/.test(line)) continue;
		lines[i] = `${line}  `;
	}
	return lines.join("\n");
}

/** Removes hard breaks (two trailing spaces, or a trailing backslash) that are plain line breaks in Obsidian. */
export function softenLineBreaks(text: string): string {
	return text.replace(/(\S) {2,}$/gm, "$1").replace(/([^\s\\])\\$/gm, "$1");
}

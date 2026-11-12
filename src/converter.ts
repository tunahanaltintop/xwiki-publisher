/**
 * Converts Obsidian-flavoured Markdown into Markdown that the XWiki Markdown syntax (markdown/1.2) understands.
 * This module is free of Obsidian imports so it can be unit tested with plain Node.
 */

import {
	anchorFor,
	blockIdsToMacros,
	calloutsToMacros,
	convertComments,
	escapeMarkdown12,
	escapeUnclosedMacros,
	extractFootnotes,
	extractHeadings,
	footnotesToMacros,
	hardenLineBreaks,
	highlightsToHtml,
	tasksToSymbols,
} from "./obsidian-syntax.ts";

export type ResolvedLink =
	| { kind: "attachment"; vaultPath: string; name: string; url: string }
	| {
			kind: "page";
			url: string;
			/** XWiki document reference of the page (`Space.Note.WebHome`), for links XWiki can follow on renames. */
			reference?: string;
			/** Headings of the linked note, in order, to turn `#Heading` subpaths into XWiki anchors. */
			headings?: string[];
	  };

/** Resolves a link path (without `#heading` and `|alias`) relative to the note being converted. */
export type LinkResolver = (linkpath: string) => ResolvedLink | null;

export interface ConvertOptions {
	/** Single line breaks are line breaks, as in Obsidian with "Strict line breaks" off. */
	hardLineBreaks?: boolean;
	/** `%%comments%%` are removed, or kept as hidden `{{comment}}` macros. */
	comments?: "remove" | "macro";
	/**
	 * Write page links and attachments as XWiki references (`[[label|doc:Space.Page.WebHome]]`, `![[alt|file.png]]`)
	 * instead of URLs, so XWiki tracks them as links, updates them on renames and does not depend on its URL scheme.
	 */
	xwikiReferences?: boolean;
}

export interface ConvertResult {
	markdown: string;
	/** Attachments referenced by the note: attachment name -> vault path. */
	attachments: Map<string, string>;
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp", "avif"]);

function isImage(name: string): boolean {
	const dot = name.lastIndexOf(".");
	return dot >= 0 && IMAGE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

function isExternal(url: string): boolean {
	return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("#") || url.startsWith("//");
}

export function stripFrontmatter(content: string): string {
	const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(content);
	return match ? content.slice(match[0].length) : content;
}

function splitTarget(raw: string): { target: string; heading?: string; alias?: string } {
	// Inside tables Obsidian writes the alias separator as `\|`.
	const inner = raw.replace(/\\\|/g, "|");
	const pipe = inner.indexOf("|");
	const ref = pipe >= 0 ? inner.slice(0, pipe) : inner;
	const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() : undefined;
	const hash = ref.indexOf("#");
	const target = (hash >= 0 ? ref.slice(0, hash) : ref).trim();
	const heading = hash >= 0 ? ref.slice(hash + 1).trim() : undefined;
	return { target, heading: heading || undefined, alias: alias || undefined };
}

/** `![[img.png|300]]` / `|300x200` are size hints, not alt texts. */
function isSizeHint(alias: string): boolean {
	return /^\d+(x\d+)?$/.test(alias);
}

function lastSegment(path: string): string {
	const name = path.split("/").pop() ?? path;
	return name.replace(/\.md$/i, "");
}

function escapeLabel(label: string): string {
	return label.replace(/([[\]])/g, "\\$1");
}

function wrapUrl(url: string): string {
	return /[\s()]/.test(url) ? `<${url}>` : url;
}

/**
 * Splits a Markdown table row into trimmed cells; escaped pipes (`\|`) and pipes inside wiki links (`[[a|b]]`) or
 * macros (`{{m p="a|b"/}}`) stay inside their cell, as the Markdown 1.2 parser reads them.
 */
function splitTableRow(line: string): string[] {
	let row = line.trim();
	if (row.startsWith("|")) row = row.slice(1);
	if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
	const cells: string[] = [];
	let cell = "";
	let depth = 0;
	for (let i = 0; i < row.length; i++) {
		const pair = row.slice(i, i + 2);
		if (pair === "[[" || pair === "{{") {
			depth++;
			cell += pair;
			i++;
		} else if ((pair === "]]" || pair === "}}") && depth > 0) {
			depth--;
			cell += pair;
			i++;
		} else if (row[i] === "\\" && row[i + 1] === "|") {
			cell += "\\|";
			i++;
		} else if (row[i] === "|" && depth > 0) {
			cell += "|";
		} else if (row[i] === "|") {
			cells.push(cell);
			cell = "";
		} else {
			cell += row[i];
		}
	}
	cells.push(cell);
	return cells.map((c) => c.trim());
}

/** Text written in empty table cells: XWiki drops empty Markdown cells, which shifts or merges the columns. */
export const EMPTY_CELL = "&nbsp;";

/**
 * Gives every row of every table as many cells as its header and fills empty cells with a non-breaking space,
 * so XWiki keeps the column structure.
 */
function fillTableCells(text: string): string {
	const lines = text.split("\n");
	for (let i = 1; i < lines.length; i++) {
		const header = splitTableRow(lines[i - 1]);
		const delimiter = splitTableRow(lines[i]);
		const isTable =
			lines[i - 1].includes("|") && delimiter.length === header.length && delimiter.every((cell) => /^:?-+:?$/.test(cell));
		if (!isTable) continue;
		const width = header.length;
		const fill = (line: string) => {
			const cells = splitTableRow(line);
			while (cells.length < width) cells.push("");
			return `| ${cells.map((cell) => cell || EMPTY_CELL).join(" | ")} |`;
		};
		lines[i - 1] = fill(lines[i - 1]);
		for (let j = i + 1; j < lines.length && lines[j].includes("|") && lines[j].trim(); j++) lines[j] = fill(lines[j]);
	}
	return lines.join("\n");
}

/** Characters that cannot appear in a wiki link label, reference or attachment name without breaking the syntax. */
const UNSAFE_IN_WIKI_LINK = /[[\]\n]/;
/** Attachment names that an untyped image reference reads as something else (`Page@file`, `wiki:…`, escapes). */
const UNSAFE_ATTACHMENT = /[[\]|@\\:{}"~\n]/;

interface ConvertContext {
	resolve: LinkResolver;
	attachments: Map<string, string>;
	/** Headings of the note being converted, for links to its own headings (`[[#Heading]]`). */
	headings: string[];
	references: boolean;
}

/** Wiki link labels are plain text in which HTML entities are read: a pipe is written `&#124;`. */
function wikiLabel(label: string): string {
	return label.replace(/\|/g, "&#124;");
}

function pageLink(label: string, resolved: Extract<ResolvedLink, { kind: "page" }>, subpath: string | undefined, ctx: ConvertContext): string {
	const anchor = subpath ? anchorFor(resolved.headings ?? [], subpath) : undefined;
	if (ctx.references && resolved.reference && !UNSAFE_IN_WIKI_LINK.test(label) && !/[[\]|\n]/.test(resolved.reference)) {
		return `[[${wikiLabel(label)}|doc:${resolved.reference}${anchor ? `|anchor=${quoteParameterValue(anchor)}` : ""}]]`;
	}
	return `[${escapeLabel(label)}](${wrapUrl(anchor ? `${resolved.url}#${anchor}` : resolved.url)})`;
}

/** A link to an anchor of the page itself: a wiki link with an empty reference, which XWiki shows as a page link. */
function samePageLink(label: string, anchor: string, ctx: ConvertContext): string {
	if (ctx.references && !UNSAFE_IN_WIKI_LINK.test(label)) return `[[${wikiLabel(label)}||anchor=${quoteParameterValue(anchor)}]]`;
	return `[${escapeLabel(label)}](#${anchor})`;
}

function quoteParameterValue(value: string): string {
	return `"${value.replace(/["\\]/g, "\\$&")}"`;
}

function attachmentLink(embed: boolean, label: string, resolved: Extract<ResolvedLink, { kind: "attachment" }>, ctx: ConvertContext): string {
	ctx.attachments.set(resolved.name, resolved.vaultPath);
	const image = embed && isImage(resolved.name);
	if (ctx.references && !UNSAFE_ATTACHMENT.test(resolved.name) && !UNSAFE_IN_WIKI_LINK.test(label)) {
		// Untyped image references are attachments of the page; links need the `attach:` type.
		const reference = image ? resolved.name : `attach:${resolved.name}`;
		return `${image ? "!" : ""}[[${label === resolved.name ? "" : `${wikiLabel(label)}|`}${reference}]]`;
	}
	// A bare file name in a Markdown image is a relative URL for XWiki, not an attachment: use the download URL.
	return `${image ? "!" : ""}[${escapeLabel(label)}](${wrapUrl(resolved.url)})`;
}

/** An image with a size (`![[a.png|300]]`): Markdown 1.2 has no image parameters, XWiki 2.1 has. */
function sizedImage(resolved: Extract<ResolvedLink, { kind: "attachment" }>, size: string, ctx: ConvertContext): string | null {
	if (!ctx.references || UNSAFE_ATTACHMENT.test(resolved.name)) return null;
	ctx.attachments.set(resolved.name, resolved.vaultPath);
	const [width, height] = size.split("x");
	return `{{content syntax="xwiki/2.1"}}[[image:${resolved.name}||width="${width}"${height ? ` height="${height}"` : ""}]]{{/content}}`;
}

function convertText(text: string, ctx: ConvertContext): string {
	const resolve = ctx.resolve;
	// Written syntax is kept aside until the end, so the following passes do not read `![[alt|a.png]]` as a link.
	const kept: string[] = [];
	const keep = (written: string) => {
		kept.push(written);
		return `\uE040${kept.length - 1}\uE041`;
	};
	const restore = (value: string) => value.replace(/\uE040(\d+)\uE041/g, (_m, i: string) => kept[Number(i)]);
	return restore(convertLinks(text, ctx, resolve, keep));
}

function convertLinks(text: string, ctx: ConvertContext, resolve: LinkResolver, keep: (written: string) => string): string {
	let out = text;

	// Wiki embeds: ![[file]], ![[Note]], ![[Note#Heading]]
	out = out.replace(/!\[\[([^\]\n]+)\]\]/g, (whole, inner: string) => {
		const { target, heading, alias } = splitTarget(inner);
		const resolved = resolve(target);
		const label = alias && !isSizeHint(alias) ? alias : lastSegment(target);
		if (resolved?.kind === "page") {
			// The display macro shows the page, or one of its sections, where the note is embedded.
			if (ctx.references && resolved.reference && !resolved.reference.includes('"') && !heading?.startsWith("^")) {
				const section = heading ? ` section="${anchorFor(resolved.headings ?? [], heading)}"` : "";
				return keep(`{{display reference="${resolved.reference}"${section}/}}`);
			}
			return keep(pageLink(heading ? `${label} > ${heading}` : label, resolved, heading, ctx));
		}
		if (resolved?.kind === "attachment") {
			if (alias && isSizeHint(alias) && isImage(resolved.name)) {
				const sized = sizedImage(resolved, alias, ctx);
				if (sized) return keep(sized);
			}
			return keep(attachmentLink(true, label, resolved, ctx));
		}
		return whole;
	});

	// Wiki links: [[Note#Heading|Alias]], [[#Heading]], [[Note#^block]]
	out = out.replace(/\[\[([^\]\n]+)\]\]/g, (_whole, inner: string) => {
		const { target, heading, alias } = splitTarget(inner);
		const label = alias ?? (heading ? (target ? `${lastSegment(target)} > ${heading}` : heading) : lastSegment(target));
		if (!target) return heading ? keep(samePageLink(label, anchorFor(ctx.headings, heading), ctx)) : label;
		const resolved = resolve(target);
		if (!resolved) return label;
		return keep(resolved.kind === "page" ? pageLink(label, resolved, heading, ctx) : attachmentLink(false, label, resolved, ctx));
	});

	// Standard Markdown links/images pointing to local vault files.
	out = out.replace(
		/(!?)\[([^\]\n]*)\]\((?:<([^>\n]+)>|([^)\s]+))(\s+"[^"\n]*")?\)/g,
		(whole, bang: string, label: string, angled?: string, plain?: string) => {
			const raw = angled ?? plain ?? "";
			if (isExternal(raw)) return whole;
			let decoded = raw;
			try {
				decoded = decodeURI(raw);
			} catch {
				// keep raw value
			}
			const hash = decoded.indexOf("#");
			const target = hash >= 0 ? decoded.slice(0, hash) : decoded;
			if (!target) return whole;
			const resolved = resolve(target);
			if (!resolved) return whole;
			const text = label || lastSegment(target);
			if (resolved.kind === "attachment") return keep(attachmentLink(bang === "!", text, resolved, ctx));
			return keep(pageLink(text, resolved, hash >= 0 ? decoded.slice(hash + 1) || undefined : undefined, ctx));
		},
	);

	return out;
}

/**
 * Applies `transform` to every part of `markdown` that is not code: fenced code blocks and inline code spans
 * are passed through untouched.
 */
export function transformOutsideCode(markdown: string, transform: (text: string) => string): string {
	const lines = markdown.split("\n");
	const output: string[] = [];
	let buffer: string[] = [];
	let fence: string | null = null;

	const flush = () => {
		if (buffer.length === 0) return;
		const codeSpans: string[] = [];
		// Code spans are swapped for placeholders built from private-use characters, which never occur in notes.
		const masked = buffer.join("\n").replace(/(`+)[\s\S]*?\1|<!--[\s\S]*?-->/g, (span) => {
			codeSpans.push(span);
			return `\uE000${codeSpans.length - 1}\uE001`;
		});
		output.push(transform(masked).replace(/\uE000(\d+)\uE001/g, (_m, i: string) => codeSpans[Number(i)]));
		buffer = [];
	};

	let previousBlank = true;
	let indentedCode = false;
	let inList = false;
	for (const line of lines) {
		const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
		const listItem = /^\s*([-*+]|\d+[.)])\s/.test(line);
		// An indented code block starts after a blank line with 4 spaces or a tab, but not inside a list, where
		// indented lines continue the list item.
		const indented = /^( {4}|\t)/.test(line) && !listItem;
		if (listItem) inList = true;
		else if (line.trim() && !/^\s/.test(line)) inList = false;
		if (fence === null && !inList && (indentedCode || (previousBlank && indented))) {
			if (indented || !line.trim()) {
				if (!indentedCode) flush();
				indentedCode = true;
				output.push(line);
				previousBlank = !line.trim();
				continue;
			}
			indentedCode = false;
		}
		previousBlank = !line.trim();
		if (fence === null && fenceMatch) {
			flush();
			fence = fenceMatch[1];
			output.push(line);
		} else if (fence !== null) {
			output.push(line);
			if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length && line.trim() === fenceMatch[1]) {
				fence = null;
			}
		} else {
			buffer.push(line);
		}
	}
	flush();
	return output.join("\n");
}

/**
 * Applies `transform` to all the text outside code at once, for transforms that pair things across code blocks
 * (a macro opened before a fenced code block and closed after it). `transform` must keep the separator lines.
 */
function acrossCode(markdown: string, transform: (text: string) => string): string {
	const SEPARATOR = "\n\n";
	const chunks: string[] = [];
	transformOutsideCode(markdown, (text) => {
		chunks.push(text);
		return text;
	});
	const transformed = transform(chunks.join(SEPARATOR)).split(SEPARATOR);
	let next = 0;
	return transformOutsideCode(markdown, (text) => transformed[next++] ?? text);
}

/**
 * Converts a whole note (frontmatter included) into XWiki Markdown. Code is left untouched. Obsidian-only syntax is
 * written as XWiki constructs that `convertFromXWiki` turns back into the same syntax (see `obsidian-syntax.ts`).
 */
export function convertNote(content: string, resolve: LinkResolver, options: ConvertOptions = {}): ConvertResult {
	const ctx: ConvertContext = { resolve, attachments: new Map(), headings: [], references: options.xwikiReferences ?? false };
	const body = stripFrontmatter(content);
	ctx.headings = extractHeadings(body);
	const footnotes = new Map<string, string>();
	// Callouts first, on the whole note: fenced code inside a callout becomes fenced code inside its box.
	const boxed = calloutsToMacros(transformOutsideCode(body, (text) => convertComments(text, options.comments ?? "remove")));
	const safe = acrossCode(boxed, escapeUnclosedMacros);
	const withoutDefinitions = transformOutsideCode(safe, (text) => extractFootnotes(text, footnotes));
	const markdown = transformOutsideCode(withoutDefinitions, (text) => {
		let out = footnotesToMacros(text, footnotes);
		out = blockIdsToMacros(out);
		out = tasksToSymbols(out);
		out = escapeMarkdown12(out);
		out = highlightsToHtml(out);
		out = convertText(out, ctx);
		if (options.hardLineBreaks) out = hardenLineBreaks(out);
		return fillTableCells(out);
	});
	return { markdown: markdown.trim() + "\n", attachments: ctx.attachments };
}

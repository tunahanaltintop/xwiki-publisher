/**
 * Inline comments of an XWiki page (annotations: a comment attached to a selection of the page text), shown in the
 * pulled note. XWiki keeps them in comment objects next to the page, not in its content, so a pull writes marks
 * into the note that stand for them:
 *
 *     Budget of ==💬1.2M for Q3==[^xwiki-3] was approved.
 *
 *     [^xwiki-3]: 💬 **Jane Doe** · 2026-11-20 14:03: Is this still right?<br>↳ **John Roe** · 2026-11-21 09:10: Yes.
 *
 * The marks are never page content: `stripInlineComments` removes them before a note is published or compared with
 * its page, and nothing is written here that it would not remove again. Comments written in Obsidian are sent to
 * XWiki as comments (`selectionOnPage`, `commentAt`), never as marks. Free of Obsidian imports so it can be unit
 * tested.
 */
import { stripFrontmatter, stripInlineComments } from "./converter.ts";
import { xwiki21ToMarkdown } from "./xwiki21.ts";

/** Class of the objects XWiki stores comments in; an inline comment is one with a selection. */
const COMMENT_CLASS = "XWiki.XWikiComments";

/** A comment of a page, as the REST API lists it. */
export interface RemoteComment {
	id: number;
	/** Name of the author as XWiki shows it, or the user id when it reports no name. */
	author: string;
	/** Time of the comment, in milliseconds. */
	date?: number;
	text: string;
	/** Comment this one answers. */
	replyTo?: number;
}

/** Text an inline comment is attached to, with the text around it, which tells equal selections apart. */
export interface CommentSelection {
	selection: string;
	before: string;
	after: string;
}

export interface CommentEntry {
	/** Id of the comment on XWiki: what replies and deletions point at. */
	id?: number;
	/** The comment it answers, for a reply. */
	replyTo?: number;
	author: string;
	date?: number;
	/** Text of the comment, in Markdown. */
	text: string;
}

/**
 * The comment `id` of a thread and the replies below it, at any depth, newest first: what deleting it removes, in an
 * order that never leaves a reply to nothing.
 */
export function commentsBelow(thread: CommentThread, id: number): number[] {
	const below = new Set([id]);
	for (const entry of thread.entries) {
		if (entry.id !== undefined && entry.replyTo !== undefined && below.has(entry.replyTo)) below.add(entry.id);
	}
	return thread.entries
		.map((entry) => entry.id)
		.filter((entryId): entryId is number => entryId !== undefined && below.has(entryId))
		.reverse();
}

/** How deep a comment of a thread is: 0 for the comment, 1 for a reply to it, and so on. */
export function replyDepth(thread: CommentThread, entry: CommentEntry): number {
	const byId = new Map(thread.entries.map((other) => [other.id, other]));
	let depth = 0;
	for (let current = entry; current.replyTo !== undefined && depth < 10; depth++) {
		const parent = byId.get(current.replyTo);
		if (!parent) break;
		current = parent;
	}
	return depth;
}

/** An inline comment followed by its replies, oldest first. */
export interface CommentThread extends CommentSelection {
	id: number;
	entries: CommentEntry[];
	/** Ids of the replies, oldest first: deleting the comment deletes them too. */
	replies: number[];
	/** Who resolved it and when, on an XWiki that has comment resolution; a resolved comment is not shown in the note. */
	resolved?: CommentResolution;
}

/** Who resolved an inline comment and when. */
export interface CommentResolution {
	/** The user's reference: `XWiki.jdoe`. */
	by: string;
	name: string;
	/** Time, in milliseconds. */
	at?: number;
}

/** The resolution state of the comments of a page, on an XWiki that has comment resolution. */
export interface CommentResolutions {
	/** The signed-in user may resolve and reopen comments of the page. */
	canResolve: boolean;
	/** Resolved comments, by comment id. */
	resolved: Map<number, CommentResolution>;
}

/**
 * The answer of the comment resolution service of the wiki (`Tools.CommentResolve`):
 * `{"canResolve": true, "resolved": {"0": {"by": "XWiki.jdoe", "name": "Jane Doe", "at": 1795503080325}}}`.
 * `null` when the answer is not that: the wiki has no such service.
 */
export function parseResolutions(json: unknown): CommentResolutions | null {
	if (!json || typeof json !== "object") return null;
	const answer = json as { canResolve?: unknown; resolved?: unknown };
	if (typeof answer.canResolve !== "boolean" && (typeof answer.resolved !== "object" || answer.resolved === null)) return null;
	const resolved = new Map<number, CommentResolution>();
	const entries = answer.resolved && typeof answer.resolved === "object" ? Object.entries(answer.resolved as Record<string, unknown>) : [];
	for (const [key, value] of entries) {
		const id = integer(key);
		if (id === undefined || !value || typeof value !== "object") continue;
		const item = value as { by?: unknown; name?: unknown; at?: unknown };
		const by = text(item.by);
		resolved.set(id, { by, name: text(item.name).trim() || by.replace(/^(?:[^:.]+:)?XWiki\./, ""), at: time(item.at) });
	}
	return { canResolve: answer.canResolve === true, resolved };
}

/* ------------------------------------------------------------------------------------------------ REST answers */

function text(value: unknown): string {
	return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function integer(value: unknown): number | undefined {
	const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
	return Number.isInteger(number) ? number : undefined;
}

/** Dates come as milliseconds or as ISO text, depending on how the server writes JSON. */
function time(value: unknown): number | undefined {
	const parsed = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
	return Number.isFinite(parsed) ? parsed : undefined;
}

/** Comments in the answer of `…/pages/{page}/comments?prettyNames=true`. */
export function parseComments(json: unknown): RemoteComment[] {
	const list = (json as { comments?: unknown } | null)?.comments;
	if (!Array.isArray(list)) return [];
	const comments: RemoteComment[] = [];
	for (const item of list as (Record<string, unknown> | null)[]) {
		const id = integer(item?.id);
		if (!item || id === undefined) continue;
		// Without a name, the user id (`xwiki:XWiki.jdoe`) is shown without its wiki and space.
		const author = text(item.authorName).trim() || text(item.author).replace(/^(?:[^:.]+:)?XWiki\./, "") || "?";
		comments.push({ id, author, date: time(item.date), text: text(item.text), replyTo: integer(item.replyTo) });
	}
	return comments;
}

/** Selections of the inline comments in the answer of `…/pages/{page}?objects=true`, by comment id. */
export function parseSelections(json: unknown): Map<number, CommentSelection> {
	const selections = new Map<number, CommentSelection>();
	const objects = (json as { objects?: { objectSummaries?: unknown } | null } | null)?.objects?.objectSummaries;
	if (!Array.isArray(objects)) return selections;
	for (const object of objects as ({ className?: unknown; number?: unknown; properties?: unknown } | null)[]) {
		const id = integer(object?.number);
		if (!object || object.className !== COMMENT_CLASS || id === undefined || !Array.isArray(object.properties)) continue;
		const values = new Map<string, string>();
		for (const property of object.properties as ({ name?: unknown; value?: unknown } | null)[]) {
			if (typeof property?.name === "string") values.set(property.name, text(property.value));
		}
		const selection = values.get("selection") ?? "";
		if (!selection.trim()) continue;
		selections.set(id, { selection, before: values.get("selectionLeftContext") ?? "", after: values.get("selectionRightContext") ?? "" });
	}
	return selections;
}

/**
 * Comments are written in the syntax of their page; user mentions are macros in both syntaxes. `mention` shows a
 * mentioned user, by the reference of the macro; without it, or when it has nothing, the user's page name is shown.
 */
function commentMarkdown(source: string, syntax: string, mention?: (reference: string) => string | undefined): string {
	const mentions = source.replace(/\{\{mention\s[^}]*?reference="([^"]+)"[^}]*\/\}\}/g, (_macro, reference: string) => {
		const login = reference.replace(/^[^":]*:/, "").replace(/^XWiki\./, "").replace(/\\(.)/g, "$1");
		return mention?.(reference) ?? `@${login}`;
	});
	return /^xwiki\/2\./i.test(syntax) ? xwiki21ToMarkdown(mentions) : mentions;
}

/**
 * Groups the comments of a page into its inline comments, each followed by the replies to it. Comments that are not
 * attached to a text selection, and the replies to them, are left out.
 */
export function commentThreads(
	comments: RemoteComment[],
	selections: Map<number, CommentSelection>,
	syntax: string,
	mention?: (reference: string) => string | undefined,
	resolutions?: CommentResolutions | null,
): CommentThread[] {
	const byId = new Map(comments.map((comment) => [comment.id, comment]));
	/** The inline comment a comment belongs to, through the comments it answers. */
	const rootOf = (comment: RemoteComment): number | undefined => {
		const seen = new Set<number>();
		for (let current: RemoteComment | undefined = comment; current && !seen.has(current.id); ) {
			if (selections.has(current.id)) return current.id;
			seen.add(current.id);
			current = current.replyTo === undefined ? undefined : byId.get(current.replyTo);
		}
		return undefined;
	};
	const threads = new Map<number, CommentThread>();
	const oldestFirst = [...comments].sort((a, b) => (a.date ?? 0) - (b.date ?? 0) || a.id - b.id);
	for (const comment of oldestFirst) {
		const root = rootOf(comment);
		const selection = root === undefined ? undefined : selections.get(root);
		if (root === undefined || !selection) continue;
		const thread = threads.get(root) ?? { id: root, ...selection, entries: [], replies: [] };
		threads.set(root, thread);
		if (comment.id !== root) thread.replies.push(comment.id);
		const entry: CommentEntry = { id: comment.id, replyTo: comment.replyTo, author: comment.author, date: comment.date, text: commentMarkdown(comment.text, syntax, mention) };
		if (comment.id === root) thread.entries.unshift(entry);
		else thread.entries.push(entry);
	}
	for (const thread of threads.values()) {
		const resolution = resolutions?.resolved.get(thread.id);
		if (resolution) thread.resolved = resolution;
	}
	return [...threads.values()].sort((a, b) => a.id - b.id);
}

/* ------------------------------------------------------------------------------------------------ Finding the text */

const LETTER = /[\p{L}\p{N}]/gu;

/** The letters and digits of a text: what is left of it whatever the markup, spacing and punctuation around. */
function letters(value: string): string {
	return (value.match(LETTER) ?? []).join("");
}

/**
 * Marks what XWiki does not show as page text although it holds letters: link targets, images, tags, the language
 * of a code block, list numbers… A selection is searched in what is left. With `note`, `markdown` is a whole note:
 * its properties and the comments shown in it are not page text either.
 */
function hiddenParts(markdown: string, note: boolean): Uint8Array {
	const hidden = new Uint8Array(markdown.length);
	const hide = (pattern: RegExp) => {
		for (const match of markdown.matchAll(pattern)) hidden.fill(1, match.index ?? 0, (match.index ?? 0) + match[0].length);
	};
	if (note) {
		hidden.fill(1, 0, markdown.length - stripFrontmatter(markdown).length);
		hide(/^\[\^xwiki-\d+\]:.*$/gm); // the comments of the page
	}
	hide(/^[ \t>]*(?:`{3,}|~{3,}).*$/gm); // code fences, with their language
	hide(/!\[\[[^\]\n]*\]\]|!\[[^\]\n]*\]\([^)\n]*\)/g); // embeds and images
	hide(/\[\[[^\]\n|]*?\\?\|/g); // target of a wiki link that has an alias
	hide(/\]\([^)\n]*\)/g); // target of a link
	hide(/\[\^[^\]\s]+\]:?/g); // footnote references
	hide(/<!--[\s\S]*?-->|<\/?[A-Za-z][^>\n]*>/g); // HTML
	hide(/&(?:#\d+|#x[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);/g); // character references
	hide(/^[ \t]*>[ \t>]*\[![^\]\n]+\][+-]?/gm); // callout types
	hide(/^[ \t>]*\d+[.)](?=\s)/gm); // list numbers
	hide(/^[ \t>]*(?:[-*+]|\d+[.)])\s+\[[^\]\n]\](?=\s)/gm); // task boxes
	hide(/(?:^|[ \t])\^[A-Za-z0-9-]+[ \t]*$/gm); // block ids
	hide(/%%[\s\S]*?%%/g); // Obsidian comments
	hide(/\{\{[^{}\n]*\}\}/g); // macro tags
	return hidden;
}

interface Projection {
	/** Letters and digits of the page text, in order. */
	text: string;
	/** Offset in the note of each character of `text`. */
	offsets: number[];
}

/** The letters and digits of `source` that are not `hidden`, with where they are. */
function lettersOf(source: string, hidden?: Uint8Array): Projection {
	const offsets: number[] = [];
	let found = "";
	for (const match of source.matchAll(LETTER)) {
		const index = match.index ?? 0;
		if (hidden?.[index]) continue;
		found += match[0];
		for (let k = 0; k < match[0].length; k++) offsets.push(index + k);
	}
	return { text: found, offsets };
}

function project(markdown: string, note = false): Projection {
	return lettersOf(markdown, hiddenParts(markdown, note));
}

/**
 * Offsets in the note of the first and after the last letter of a selection, or `null` when the selection is not in
 * the note, or is there several times with nothing around it to tell which one was commented.
 */
function locate({ text: page, offsets }: Projection, { selection, before, after }: CommentSelection): [number, number] | null {
	const needle = letters(selection);
	if (!needle) return null;
	const left = letters(before);
	const right = letters(after);
	let best = -1;
	let bestScore = -1;
	let tied = false;
	for (let at = page.indexOf(needle); at >= 0; at = page.indexOf(needle, at + 1)) {
		const end = at + needle.length;
		let score = 0;
		for (let k = 1; k <= left.length && at - k >= 0 && page[at - k] === left[left.length - k]; k++) score++;
		for (let k = 0; k < right.length && end + k < page.length && page[end + k] === right[k]; k++) score++;
		if (score > bestScore) {
			best = at;
			bestScore = score;
			tied = false;
		} else if (score === bestScore) {
			tied = true;
		}
	}
	return best < 0 || tied ? null : [offsets[best], offsets[best + needle.length - 1] + 1];
}

/* ------------------------------------------------------------------------------------------------ Writing the marks */

/** Inline syntax that a mark would break: the reference goes after it, and text ending in it is not highlighted. */
const ATOMIC = /(`+)[^\n]*?\1|!?\[\[[^\]\n]*\]\]|!?\[(?:\\.|[^\]\\\n])*\]\([^)\n]*\)|<\/?[A-Za-z][^>\n]*>|\{\{[^{}\n]*\}\}|\$[^$\n]+\$|%%[^\n]*?%%|\[\^[^\]\s]+\]|[a-z][a-z0-9+.-]*:\/\/[^\s<>)\]]+/gi;
const URL = /^[a-z][a-z0-9+.-]*:\/\//i;
/** Text with syntax in it that a highlight could cut in two, or that would end the highlight early. */
const MARKUP = /[\n`*[\]<>|$\\^{}~]|==|%%|:\/\/|(?:^|[^\p{L}\p{N}])_|_(?:[^\p{L}\p{N}]|$)/u;

interface Place {
	start: number;
	/** Where the reference goes: after the selection, or after the link or code the selection ends in. */
	end: number;
	/** The selection is plain text of one line, which a highlight can wrap. */
	highlight: boolean;
}

/** Where the marks of a selection found at `start`–`end` go, or `null` when no mark can be written there. */
function place(markdown: string, start: number, end: number): Place | null {
	const lineStart = markdown.lastIndexOf("\n", end - 1) + 1;
	const newline = markdown.indexOf("\n", end);
	const line = markdown.slice(lineStart, newline < 0 ? markdown.length : newline);
	// A reference in a heading would be part of the heading's name, which links to the heading are made of.
	if (/^[ \t>]*#{1,6}(?:\s|$)/.test(line)) return null;
	let highlight = start >= lineStart;
	let at = end;
	for (const match of line.matchAll(ATOMIC)) {
		const from = lineStart + (match.index ?? 0);
		const to = from + match[0].length;
		// A reference right after an address would be read as part of the address.
		if (URL.test(match[0]) && from < end && end <= to) return null;
		if (from < end && end < to) {
			at = Math.max(at, to);
			highlight = false;
		}
		if (from < start && start < to) highlight = false;
	}
	if (highlight) {
		const before = markdown.slice(lineStart, start);
		const inHighlight = (before.split("==").length - 1) % 2 === 1 || before.endsWith("=") || markdown.startsWith("=", end);
		highlight = !inHighlight && !MARKUP.test(markdown.slice(start, end));
	}
	return { start, end: at, highlight };
}

interface Mark {
	at: number;
	/** At the same offset, what ends there (0) is written before what starts there (1). */
	order: number;
	text: string;
}

function withMarks(markdown: string, marks: Mark[]): string {
	const sorted = marks.map((mark, index) => ({ mark, index })).sort((a, b) => a.mark.at - b.mark.at || a.mark.order - b.mark.order || a.index - b.index);
	let out = "";
	let from = 0;
	for (const { mark } of sorted) {
		out += markdown.slice(from, mark.at) + mark.text;
		from = mark.at;
	}
	return out + markdown.slice(from);
}

function reference(thread: CommentThread): string {
	return `[^xwiki-${thread.id}]`;
}

function formatDate(time: number): string {
	const date = new Date(time);
	const two = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** Comments of several lines are written on one line: a footnote ends at the first line that is not indented. */
function oneLine(value: string): string {
	return value
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.join("<br>");
}

/** Plain text (a name, the commented text) written so that Markdown shows it as it is. */
function escapePlain(value: string): string {
	return value.replace(/[\\*_[\]<>~=$#|]/g, "\\$&");
}

/**
 * Keeps a footnote from reaching outside its line: a lone backtick, `<!--` or `%%` would pair with one elsewhere in
 * the note, and hide the text in between from Obsidian and from `stripInlineComments`.
 */
function contained(value: string): string {
	return value.replace(/`/g, "'").replace(/<!--/g, "<\\!--").replace(/-->/g, "--\\>").replace(/%%/g, "%\\%");
}

const QUOTE_LENGTH = 80;

/** The footnote of a thread; `quoted` when the commented text is not highlighted in the note, so it is named here. */
function footnote(thread: CommentThread, quoted: boolean): string {
	const selection = thread.selection.replace(/\s+/g, " ").trim();
	const quote = quoted ? `“${escapePlain(selection.length > QUOTE_LENGTH ? `${selection.slice(0, QUOTE_LENGTH)}…` : selection)}” — ` : "";
	const entries = thread.entries.map((entry, index) => {
		const said = oneLine(entry.text);
		const date = entry.date === undefined ? "" : ` · ${formatDate(entry.date)}`;
		return `${index > 0 ? "↳ " : ""}**${escapePlain(entry.author)}**${date}${said ? `: ${said}` : ""}`;
	});
	const resolution = thread.resolved;
	const resolved = resolution ? `Resolved by ${escapePlain(resolution.name)}${resolution.at === undefined ? "" : ` · ${formatDate(resolution.at)}`} — ` : "";
	return `${reference(thread)}: ${icon(thread)} ${contained(resolved + quote + entries.join("<br>"))}`;
}

/** The icon of a comment, before its text and its footnote: ✅ once it is resolved. */
function icon(thread: CommentThread): string {
	return thread.resolved ? "✅" : "💬";
}

/** The comments a note shows as resolved, from their footnotes. */
export function shownResolved(note: string): Set<number> {
	return new Set([...note.matchAll(/^\[\^xwiki-(\d+)\]: ✅ Resolved by /gmu)].map((match) => Number(match[1])));
}

/**
 * Writes the inline comments of a page into its Markdown. The commented text gets a footnote reference, and a
 * highlight when it is plain text; the comments, with their replies, are the footnotes. Comments whose text is not
 * found (it changed, or it is in a heading or in code) are referenced on a line of their own after the text.
 * `stripInlineComments` gives `markdown` back; a mark that it would not remove is not written.
 */
export function addInlineComments(markdown: string, threads: CommentThread[]): string {
	if (threads.length === 0 || !markdown.trim()) return markdown;
	const projection = project(markdown);
	const marks: Mark[] = [];
	const highlighted: [number, number][] = [];
	const quoted = new Set<number>();
	const loose: CommentThread[] = [];
	for (const thread of threads) {
		const found = locate(projection, thread);
		const spot = found && place(markdown, found[0], found[1]);
		if (!spot) {
			loose.push(thread);
			continue;
		}
		const options: Mark[][] = [];
		// Two highlights cannot overlap: the comment found second only gets its reference.
		if (spot.highlight && !highlighted.some(([from, to]) => spot.start < to && from < spot.end)) {
			options.push([
				{ at: spot.start, order: 1, text: `==${icon(thread)}` },
				{ at: spot.end, order: 0, text: `==${reference(thread)}` },
			]);
		}
		options.push([{ at: spot.end, order: 0, text: reference(thread) }]);
		const chosen = options.find((option) => stripInlineComments(withMarks(markdown, [...marks, ...option])) === markdown);
		if (!chosen) {
			loose.push(thread);
			continue;
		}
		marks.push(...chosen);
		if (chosen.length > 1) highlighted.push([spot.start, spot.end]);
		else quoted.add(thread.id);
	}
	const unplaced = loose.length > 0 ? `💬${loose.map(reference).join("")}\n\n` : "";
	const footnotes = threads.map((thread) => footnote(thread, quoted.has(thread.id) || loose.includes(thread)));
	const result = `${withMarks(markdown, marks).replace(/\s+$/, "")}\n\n${unplaced}${footnotes.join("\n")}\n`;
	// Nothing may stay in the note that publishing would send to XWiki: without the comments rather than with a leak.
	return stripInlineComments(result).trim() === markdown.trim() ? result : markdown;
}

/* ------------------------------------------------------------------------------------------------ Writing comments */

/**
 * What XWiki needs to attach a new comment to a text of the page: the text as the page shows it, and that text with
 * as much of the text around it as it takes to be on the page only once.
 */
export interface PageSelection {
	selection: string;
	context: string;
	/** Where `selection` starts in `context`. */
	offset: number;
}

/** Letters around a selection of the note that tell which of several equal texts of the page was selected. */
const NEARBY = 40;
const CONTEXT_STEP = 10;
const CONTEXT_LIMIT = 300;

const isLowSurrogate = (text: string, index: number) => index > 0 && index < text.length && (text.charCodeAt(index) & 0xfc00) === 0xdc00;

/**
 * Finds the text selected in a note (`from`–`to`, offsets in the whole note) in the text of its page as XWiki shows
 * it. Returns `null` when the selection has no text, is not on the page (it was edited since the last publish), or
 * is there several times with the same text around it. The comment is attached from the first to the last letter
 * of the selection; the context grows as in XWiki's own comment dialog, until it is on the page only once.
 */
export function selectionOnPage(note: string, from: number, to: number, pageText: string): PageSelection | null {
	const { text: noteLetters, offsets } = project(note, true);
	const first = offsets.findIndex((offset) => offset >= from);
	if (first < 0) return null;
	let last = first;
	while (last < offsets.length && offsets[last] < to) last++;
	if (last === first) return null;
	const found = locate(lettersOf(pageText), {
		selection: noteLetters.slice(first, last),
		before: noteLetters.slice(Math.max(0, first - NEARBY), first),
		after: noteLetters.slice(last, last + NEARBY),
	});
	if (!found) return null;
	const [start, end] = found;
	// XWiki compares texts without their spacing.
	const squeeze = (value: string) => value.replace(/\s+/g, "");
	const page = squeeze(pageText);
	const repeated = (value: string) => {
		const at = page.indexOf(value);
		return at >= 0 && page.indexOf(value, at + 1) >= 0;
	};
	let left = 0;
	let right = 0;
	const context = () => pageText.slice(start - left, end + right);
	while (repeated(squeeze(context())) && (left < start || end + right < pageText.length) && left < CONTEXT_LIMIT) {
		left = Math.min(start, left + CONTEXT_STEP);
		right = Math.min(pageText.length - end, right + CONTEXT_STEP);
		// Never half of a character that takes two code units.
		if (isLowSurrogate(pageText, start - left)) left++;
		if (isLowSurrogate(pageText, end + right)) right++;
	}
	return { selection: pageText.slice(start, end), context: context(), offset: left };
}

/**
 * Id of the inline comment at a position of a line of a note: the comment whose reference is the nearest on the
 * line, or the comment whose footnote the line is. `null` on a line without comments.
 */
export function commentAt(line: string, ch: number): number | null {
	const footnoteOf = /^\[\^xwiki-(\d+)\]:/.exec(line);
	if (footnoteOf) return Number(footnoteOf[1]);
	let nearest: number | null = null;
	let distance = Infinity;
	for (const match of line.matchAll(/(?:==(?:💬|✅)(?:(?!==)[^\n])*==)?\[\^xwiki-(\d+)\]/gu)) {
		const start = match.index ?? 0;
		const end = start + match[0].length;
		const away = ch < start ? start - ch : ch > end ? ch - end : 0;
		if (away < distance) {
			distance = away;
			nearest = Number(match[1]);
		}
	}
	return nearest;
}

/** Answer of the annotations API: the page rendered for commenting, or the reason of a failure. */
export function parseAnnotationAnswer(json: unknown): { ok: boolean; message: string; html: string } {
	const answer = (json ?? {}) as { responseCode?: unknown; responseMessage?: unknown; annotatedContent?: { content?: unknown } | null };
	return { ok: integer(answer.responseCode) === 0, message: text(answer.responseMessage), html: text(answer.annotatedContent?.content) };
}

/**
 * Whether `after` is the page version that directly follows `before` (`3.4` → `3.5` or `4.1`): the page was saved
 * once in between, which after sending a comment is that comment.
 */
export function isNextVersion(before: string, after: string, saves = 1): boolean {
	const match = /^(\d+)\.(\d+)$/.exec(before);
	if (!match) return false;
	const major = Number(match[1]);
	return after === `${major}.${Number(match[2]) + saves}` || (saves === 1 && after === `${major + 1}.1`);
}

/**
 * The inline comments a selected comment icon stands for. `highlight` is the text of the highlight the icon starts,
 * if it is in one: the comments on that text. Otherwise `around` is the text of the line or cell around it: the line
 * of comments that have no place in the text, or a comment's footnote, which name the comments they show.
 */
export function commentsAtIcon(note: string, highlight: string, around: string): number[] {
	const shown = highlight.replace(/^(?:💬|✅)/u, "").trim();
	const ids = new Set<number>();
	if (shown) {
		for (const match of note.matchAll(/==(?:💬|✅)((?:(?!==)[^\n])*)==\[\^xwiki-(\d+)\]/gu)) {
			if (match[1].trim() === shown) ids.add(Number(match[2]));
		}
	}
	if (ids.size === 0) {
		const known = new Set([...note.matchAll(/^\[\^xwiki-(\d+)\]:/gm)].map((match) => Number(match[1])));
		for (const match of around.matchAll(/xwiki-(\d+)/g)) if (known.has(Number(match[1]))) ids.add(Number(match[1]));
	}
	// The icon alone, its references hidden: the line of comments without a place in the text.
	if (ids.size === 0 && !shown) {
		const line = /^💬((?:\[\^xwiki-\d+\])+)[ \t]*$/mu.exec(note);
		for (const match of line?.[1].matchAll(/xwiki-(\d+)/g) ?? []) ids.add(Number(match[1]));
	}
	return [...ids];
}

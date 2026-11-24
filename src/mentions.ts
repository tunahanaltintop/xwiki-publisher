/**
 * User mentions. On XWiki a mention is a macro that names the user, how the name is shown, and an anchor that tells
 * the mentions of a page apart (XWiki notifies a user for each anchor that is new on the page):
 *
 *     {{mention reference="XWiki.jdoe" style="FULL_NAME" anchor="XWiki-jdoe-k3x9qa"/}}
 *
 * In a note it is a link to the profile of the user, whose text starts with `@`:
 *
 *     [@Jane Doe](https://wiki.example.com/bin/view/XWiki/jdoe#XWiki-jdoe-k3x9qa)
 *
 * The address holds what the macro holds (the user, the anchor after `#`, a style other than the full name in
 * `?style=`), so publishing writes the macro back as it was; the text is the name, for reading only. A link without
 * an anchor is a mention written in Obsidian: publishing gives it one. Free of Obsidian imports so it can be unit
 * tested.
 */
import { contentHash } from "./hash.ts";
import { parseReference, parseXWikiUrl, serializeReference } from "./location.ts";

/** Space of the user profiles. */
const USER_SPACE = "XWiki";
/** How XWiki shows the user: `FULL_NAME` is what its editor writes. */
const STYLES = ["FULL_NAME", "FIRST_NAME", "LOGIN"];
const DEFAULT_STYLE = "FULL_NAME";

export interface Mention {
	/** The user as the macro names it: `XWiki.jdoe`. */
	reference: string;
	style: string;
	/** Missing in a mention written in Obsidian, until it is published. */
	anchor?: string;
}

/** A user of the wiki, as its user search lists it. */
export interface MentionUser {
	reference: string;
	name: string;
}

/** A mention macro as XWiki's editor writes it: nothing else is turned into a link, so nothing else can change. */
const MACRO = /\{\{mention((?:\s+[A-Za-z]+="[^"\n]*")+)\/\}\}/g;
/** A link whose text starts with `@`; whether it is a mention depends on its address. */
const LINK = /\[@((?:\\.|[^\]\\\n])*)\]\((?:<([^>\n]+)>|([^)\s]+))\)/g;

function macroOf(mention: Mention, anchor: string): string {
	return `{{mention reference="${mention.reference}" style="${mention.style}" anchor="${anchor}"/}}`;
}

/**
 * The mention of a macro that is written as XWiki's editor writes it, for a user of this wiki; `null` for any
 * other macro: it stays a macro in the note.
 */
function parseMacro(macro: string, parameters: string): (Mention & { anchor: string }) | null {
	const values = new Map<string, string>();
	for (const match of parameters.matchAll(/([A-Za-z]+)="([^"\n]*)"/g)) values.set(match[1], match[2]);
	const reference = values.get("reference");
	const style = values.get("style");
	const anchor = values.get("anchor");
	if (!reference || !style || !anchor || mentionLogin(reference) === null) return null;
	const mention = { reference, style, anchor };
	return macroOf(mention, anchor) === macro ? mention : null;
}

/**
 * Page name of the mentioned user (`jdoe` for `XWiki.jdoe`), or `null` when the reference is not a user profile of
 * this wiki written the way XWiki writes it: a profile on another wiki, a group, an unusual spelling.
 */
export function mentionLogin(reference: string): string | null {
	const location = parseReference(reference);
	if (!location || location.spaces.length !== 1 || location.spaces[0] !== USER_SPACE || location.page === "WebHome") return null;
	return serializeReference(location) === reference ? location.page : null;
}

/** Address of the profile of the mentioned user, carrying the mention; `null` for what `mentionLogin` leaves out. */
export function mentionUrl(baseUrl: string, mention: Mention): string | null {
	const base = baseUrl.replace(/\/+$/, "");
	const login = mentionLogin(mention.reference);
	if (!base || login === null || !STYLES.includes(mention.style)) return null;
	const style = mention.style === DEFAULT_STYLE ? "" : `?style=${mention.style}`;
	const anchor = mention.anchor ? `#${encodeURIComponent(mention.anchor)}` : "";
	return `${base}/bin/view/${USER_SPACE}/${encodeURIComponent(login)}${style}${anchor}`;
}

/** The mention an address stands for, or `null` when it is not the profile of a user of this wiki. */
export function parseMentionUrl(baseUrl: string, url: string): Mention | null {
	const parts = /^([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(url.trim());
	const page = parts ? parseXWikiUrl(parts[1], baseUrl) : null;
	if (!parts || !page || page.action !== "view" || page.segments.length !== 2 || page.segments[0] !== USER_SPACE) return null;
	const reference = serializeReference({ spaces: [USER_SPACE], page: page.segments[1] });
	if (mentionLogin(reference) === null) return null;
	const asked = /(?:^|&)style=([A-Z_]+)(?:&|$)/.exec(parts[2] ?? "")?.[1];
	let anchor: string | undefined;
	try {
		anchor = parts[3] ? decodeURIComponent(parts[3]) : undefined;
	} catch {
		anchor = parts[3];
	}
	return { reference, style: asked && STYLES.includes(asked) ? asked : DEFAULT_STYLE, anchor };
}

/**
 * Anchor of the `count`-th mention of a user that was written in Obsidian. It is made like those of XWiki's editor
 * (the user, then six characters), but from the user and the count instead of at random: publishing the note again
 * gives the same anchors, so nobody is notified twice for a mention.
 */
function newAnchor(reference: string, count: number): string {
	const user = reference.replace(/\\/g, "").replace(/[^A-Za-z0-9_]+/g, "-");
	const suffix = parseInt(contentHash(`${reference}#${count}`), 16).toString(36).padStart(6, "0").slice(-6);
	return `${user}-${suffix}`;
}

/**
 * A mention macro for a user mentioned in a comment, with a new anchor made like those of the XWiki editor: the user,
 * then six random characters. A comment is written once, so its mentions need no anchor that stays the same.
 */
export function newMentionMacro(reference: string): string {
	const user = reference.replace(/\\/g, "").replace(/[^A-Za-z0-9_]+/g, "-");
	const suffix = Math.floor(Math.random() * 36 ** 6)
		.toString(36)
		.padStart(6, "0");
	return macroOf({ reference, style: DEFAULT_STYLE }, `${user}-${suffix}`);
}

/** The mention links of a text, with their place: links to anything else, images and escaped brackets are not. */
function mentionLinks(text: string, baseUrl: string): { index: number; length: number; label: string; mention: Mention }[] {
	const found: { index: number; length: number; label: string; mention: Mention }[] = [];
	for (const match of text.matchAll(LINK)) {
		const index = match.index ?? 0;
		if (index > 0 && (text[index - 1] === "!" || text[index - 1] === "\\")) continue;
		const mention = parseMentionUrl(baseUrl, match[2] ?? match[3] ?? "");
		if (mention) found.push({ index, length: match[0].length, label: match[1], mention });
	}
	return found;
}

/**
 * Writes the mention links of a note as mention macros, for publishing. A link pulled from XWiki becomes the macro
 * it was. A link without an anchor gets one that no other mention of the note has.
 */
export function linksToMentions(text: string, baseUrl: string): string {
	const links = mentionLinks(text, baseUrl);
	if (links.length === 0) return text;
	const anchors = publishedAnchors(links);
	let out = "";
	let from = 0;
	links.forEach(({ index, length, mention }, i) => {
		out += text.slice(from, index) + macroOf(mention, anchors[i]);
		from = index + length;
	});
	return out + text.slice(from);
}

/** The anchor publishing gives each of `links`, in order: its own, or a new one that no other mention has. */
function publishedAnchors(links: { mention: Mention }[]): string[] {
	const used = new Set(links.map((link) => link.mention.anchor).filter(Boolean));
	const counts = new Map<string, number>();
	return links.map(({ mention }) => {
		let anchor = mention.anchor;
		while (!anchor) {
			const count = (counts.get(mention.reference) ?? 0) + 1;
			counts.set(mention.reference, count);
			const candidate = newAnchor(mention.reference, count);
			if (!used.has(candidate)) anchor = candidate;
		}
		used.add(anchor);
		return anchor;
	});
}

/** Parts of a note that publishing leaves out or keeps as text: code, `%%comments%%` and inline comments' footnotes. */
const NOT_PUBLISHED = /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$|`[^`\n]+`|%%[\s\S]*?%%|^\[\^xwiki-\d+\]:.*$/gm;

/**
 * Writes into the mention links of a note that have no anchor yet the anchor that publishing gave them, as `page`
 * (the Markdown source of its page) shows: a link only gets an anchor when the page has that very mention. The note
 * then stays as it is published, and mentions keep their anchors when other mentions are added before them, so
 * nobody is notified again.
 */
export function anchorMentionLinks(note: string, baseUrl: string, page: string): string {
	if (!page.includes("{{mention")) return note;
	const skipped = new Uint8Array(note.length);
	for (const match of note.matchAll(NOT_PUBLISHED)) skipped.fill(1, match.index ?? 0, (match.index ?? 0) + match[0].length);
	const links = mentionLinks(note, baseUrl).filter((link) => !skipped[link.index]);
	if (!links.some((link) => !link.mention.anchor)) return note;
	const anchors = publishedAnchors(links);
	let out = "";
	let from = 0;
	links.forEach(({ index, length, label, mention }, i) => {
		if (mention.anchor || !page.includes(macroOf(mention, anchors[i]))) return;
		const url = mentionUrl(baseUrl, { ...mention, anchor: anchors[i] });
		if (url === null) return;
		out += `${note.slice(from, index)}[@${label}](${/[\s()<>]/.test(url) ? `<${url}>` : url})`;
		from = index + length;
	});
	return out + note.slice(from);
}

/** Text of a link, with what would end it or split a table cell escaped. */
function escapeLabel(label: string): string {
	return label.replace(/[\\[\]|]/g, "\\$&");
}

/** The link that stands for a mention in a note; `name` is the name of the user, without the `@`. */
export function mentionLink(baseUrl: string, mention: Mention, name: string): string | null {
	const url = mentionUrl(baseUrl, mention);
	if (url === null) return null;
	return `[@${escapeLabel(name)}](${/[\s()<>]/.test(url) ? `<${url}>` : url})`;
}

/**
 * Writes the mention macros of a page as links, for a note. `name` gives the name of a user by reference; without
 * it, and for mentions that show the login, the page name of the user is shown. A macro is only replaced when
 * publishing the link writes that very macro again; `keep` receives each link, to protect it from later passes.
 */
export function mentionsToLinks(
	text: string,
	baseUrl: string,
	name: (reference: string) => string | undefined,
	keep: (link: string) => string = (link) => link,
): string {
	return text.replace(MACRO, (macro: string, parameters: string) => {
		const mention = parseMacro(macro, parameters);
		const login = mention ? mentionLogin(mention.reference) : null;
		if (!mention || login === null) return macro;
		const shown = mention.style === "LOGIN" ? login : name(mention.reference)?.trim() || login;
		const link = mentionLink(baseUrl, mention, shown);
		return link !== null && linksToMentions(link, baseUrl) === macro ? keep(link) : macro;
	});
}

/** Users mentioned in the source of a page, by the macros that become links: the ones whose names are looked up. */
export function mentionReferences(source: string): string[] {
	const references = new Set<string>();
	for (const match of source.matchAll(MACRO)) {
		const mention = parseMacro(match[0], match[1]);
		if (mention) references.add(mention.reference);
	}
	return [...references];
}

/** Names the mentions of a note show, by user: kept when XWiki cannot be asked for the name of a user. */
export function mentionNames(markdown: string, baseUrl: string): Map<string, string> {
	const names = new Map<string, string>();
	for (const { label, mention } of mentionLinks(markdown, baseUrl)) {
		const name = label.replace(/\\(.)/g, "$1").trim();
		if (name && !names.has(mention.reference)) names.set(mention.reference, name);
	}
	return names;
}

/** Users in the answer of XWiki's user search (`uorgsuggest`), which is what its own editor lists after `@`. */
export function parseUsers(json: unknown): MentionUser[] {
	if (!Array.isArray(json)) return [];
	const users: MentionUser[] = [];
	for (const item of json as ({ value?: unknown; label?: unknown } | null)[]) {
		if (typeof item?.value !== "string" || mentionLogin(item.value) === null) continue;
		const name = typeof item.label === "string" ? item.label.trim() : "";
		users.push({ reference: item.value, name: name || (mentionLogin(item.value) ?? item.value) });
	}
	return users;
}

/**
 * OpenProject work packages shown with XWiki's issue macro. On XWiki the macro names the work package by its key:
 *
 *     {{issue key="PROJ-42"/}}
 *
 * In a note it is a link to the work package, whose text is the key and whose address is OpenProject's short one:
 *
 *     [PROJ-42](https://openproject.example.com/wp/PROJ-42)
 *
 * The short address (`/wp/…`) tells these links apart from links written to work packages (`/work_packages/…`),
 * which are published as links: only a link whose text is the key and whose address is the short one is published
 * as the macro. Free of Obsidian imports so it can be unit tested.
 */

/** An issue macro as XWiki writes it: nothing else is turned into a link, so nothing else can change. */
const MACRO = /\{\{issue key="([^"\n]*)"\/\}\}/g;
/** Keys of work packages: project-based (`PROJ-42`) or numerical (`42`). */
const KEY = /^(?:[A-Za-z][A-Za-z0-9_]*-)?\d+$/;
/** A link whose text could be a key; whether it stands for a macro depends on its address. */
const LINK = /\[([A-Za-z0-9_-]+)\]\((?:<([^>\n]+)>|([^)\s]+))\)/g;

function base(openProjectUrl: string): string {
	return openProjectUrl.trim().replace(/\/+$/, "");
}

/** The macro that shows the work package `key` on XWiki. */
export function issueMacro(key: string): string {
	return `{{issue key="${key}"/}}`;
}

/** The link that stands for the macro of the work package `key` in a note; `null` for something that is not a key. */
export function issueLink(openProjectUrl: string, key: string): string | null {
	const root = base(openProjectUrl);
	if (!root || !KEY.test(key)) return null;
	return `[${key}](${root}/wp/${key})`;
}

/**
 * Writes the issue macros of a page as links to the work packages, for a note. `keep` receives each link, to
 * protect it from later passes. A macro is only replaced when publishing the link writes that very macro again.
 */
export function issuesToLinks(text: string, openProjectUrl: string, keep: (link: string) => string = (link) => link): string {
	if (!base(openProjectUrl) || !text.includes("{{issue")) return text;
	return text.replace(MACRO, (macro: string, key: string) => {
		const link = issueLink(openProjectUrl, key);
		return link !== null && linksToIssues(link, openProjectUrl) === macro ? keep(link) : macro;
	});
}

/** Writes the links of a note that stand for issue macros as those macros, for publishing. */
export function linksToIssues(text: string, openProjectUrl: string): string {
	const root = base(openProjectUrl);
	if (!root || !text.includes("/wp/")) return text;
	return text.replace(LINK, (link: string, label: string, angled: string | undefined, plain: string | undefined, offset: number) => {
		// Images and escaped brackets are not links.
		if (offset > 0 && (text[offset - 1] === "!" || text[offset - 1] === "\\")) return link;
		return (angled ?? plain) === `${root}/wp/${label}` && KEY.test(label) ? issueMacro(label) : link;
	});
}

/**
 * The source of a comment for editing: its issue macros shown as `#PROJ-42`, with the macro each stands for, so that
 * sending the text writes them back as they were. Macros written otherwise stay as they are.
 */
export function issuesForEditing(source: string): { text: string; mentions: { shown: string; macro: string }[] } {
	const mentions: { shown: string; macro: string }[] = [];
	const text = source.replace(MACRO, (macro: string, key: string) => {
		if (!KEY.test(key)) return macro;
		const shown = `#${key}`;
		if (!mentions.some((existing) => existing.shown === shown)) mentions.push({ shown, macro });
		return shown;
	});
	return { text, mentions };
}

/** Keys of the work packages that issue macros of `text` show, as written. */
export function issueKeys(text: string): string[] {
	const keys: string[] = [];
	for (const match of text.matchAll(/\{\{issue\s+[^}]*?\bkey\s*=\s*"([^"\n]+)"[^}]*\}\}/g)) {
		if (KEY.test(match[1].trim())) keys.push(match[1].trim());
	}
	return keys;
}

/** A work package as the search of OpenProject lists it. */
export interface WorkPackage {
	/** What the macro and the link name it by: the project-based id (`PROJ-42`) or the number. */
	key: string;
	subject: string;
	project?: string;
	type?: string;
	status?: string;
}

/**
 * Work packages of an OpenProject answer: a collection, or a single work package. The key is `displayId`, which
 * OpenProject 17.4 and later give in the format the instance uses; the number for earlier versions.
 */
export function parseWorkPackages(json: unknown): WorkPackage[] {
	const answer = json as { _type?: unknown; _embedded?: { elements?: unknown } } | null;
	const elements = answer?._type === "WorkPackage" ? [answer] : answer?._embedded?.elements;
	if (!Array.isArray(elements)) return [];
	const found: WorkPackage[] = [];
	for (const element of elements as {
		id?: unknown;
		displayId?: unknown;
		subject?: unknown;
		_links?: { project?: { title?: unknown }; type?: { title?: unknown }; status?: { title?: unknown } };
	}[]) {
		const shown = typeof element.displayId === "string" || typeof element.displayId === "number" ? element.displayId : element.id;
		const key = typeof shown === "string" || typeof shown === "number" ? String(shown).replace(/^#/, "").trim() : "";
		if (!KEY.test(key)) continue;
		const title = (value: unknown) => (typeof value === "string" && value ? value : undefined);
		found.push({
			key,
			subject: typeof element.subject === "string" ? element.subject : "",
			project: title(element._links?.project?.title),
			type: title(element._links?.type?.title),
			status: title(element._links?.status?.title),
		});
	}
	return found;
}

/** The key starts of the setting (`IKN-, PROJ-`), each ending with `-`, without repetitions. */
export function keyPrefixes(setting: string): string[] {
	const prefixes = setting
		.split(/[,\s]+/)
		.map((prefix) => prefix.trim().replace(/-*$/, ""))
		.filter((prefix) => /^[A-Za-z][A-Za-z0-9_]*$/.test(prefix))
		.map((prefix) => `${prefix}-`);
	return [...new Set(prefixes.map((prefix) => prefix.toUpperCase()))];
}

/**
 * The start of a work package key typed just before the caret: one of `prefixes` and at least one digit (`IKN-23`),
 * at the start of a word, not in an address (`/wp/IKN-23`) or a `#key` (asked for otherwise). Returns the key as
 * typed, upper-cased, and where it starts in `before`; `null` when nothing is typed so.
 */
export function typedKey(before: string, prefixes: string[]): { key: string; start: number } | null {
	if (prefixes.length === 0) return null;
	const alternatives = prefixes.map((prefix) => prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
	const match = new RegExp(`(^|[\\s(|>])((?:${alternatives})\\d+)$`, "i").exec(before);
	if (!match) return null;
	return { key: match[2].toUpperCase(), start: (match.index ?? 0) + match[1].length };
}

/** Whether a search text names a work package by its key (`PROJ-42`, `42`, `#42`), so it can be read directly. */
export function searchedKey(input: string): string | null {
	const key = input.trim().replace(/^#/, "");
	return KEY.test(key) ? key.toUpperCase() : null;
}

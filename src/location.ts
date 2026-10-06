/** Where a note lives in XWiki: a chain of nested spaces plus a page name. */
export interface PageLocation {
	spaces: string[];
	page: string;
}

/** Where folder notes live, as in the Folder notes plugin: inside their folder, or next to it. */
export type FolderNoteLocation = "inside" | "parent";

export interface LocationOptions {
	defaultSpace: string;
	mirrorFolders: boolean;
	nestedPages: boolean;
	/** Folder note layout; without it, notes are never treated as folder notes. */
	folderNoteLocation?: FolderNoteLocation;
	/** Folder note file name template, `{{folder_name}}` standing for the folder's name. */
	folderNoteName?: string;
	/**
	 * Vault folder mirroring the XWiki page tree from the wiki root (empty: the vault root). Folders inside a
	 * non-empty sync folder are spaces from the wiki root, not below the default space.
	 */
	syncFolder?: string;
}

const FOLDER_NAME = "{{folder_name}}";

/** File name (without extension) of the folder note of a folder named `folderName`. */
function folderNoteBasename(folderName: string, template: string | undefined): string {
	return sanitizeFileName(template?.includes(FOLDER_NAME) ? template.split(FOLDER_NAME).join(folderName) : (template?.trim() || folderName));
}

/**
 * Path of the folder note of `folderPath`: `A/B/B.md` inside the folder, `A/B.md` next to it.
 * A fixed name without `{{folder_name}}` only makes sense inside the folder; next to it the folder's name is used.
 */
export function folderNotePath(folderPath: string, options: LocationOptions, location: FolderNoteLocation = options.folderNoteLocation ?? "parent"): string {
	const parts = folderPath.split("/");
	const name = parts[parts.length - 1];
	if (location === "inside") return `${folderPath}/${folderNoteBasename(name, options.folderNoteName)}.md`;
	const template = options.folderNoteName?.includes(FOLDER_NAME) ? options.folderNoteName : undefined;
	const parent = parts.slice(0, -1).join("/");
	return `${parent ? `${parent}/` : ""}${folderNoteBasename(name, template)}.md`;
}

/**
 * When folder notes are stored inside their folder, the folder a note is the folder note of, or `null`.
 * Such a note stands for its folder: it is published as the folder's page, not as a page below it.
 */
export function ownFolder(filePath: string, options: LocationOptions): string | null {
	if (options.folderNoteLocation !== "inside") return null;
	const slash = filePath.lastIndexOf("/");
	if (slash < 0) return null;
	const folder = filePath.slice(0, slash);
	return folderNotePath(folder, options, "inside") === filePath ? folder : null;
}

/** Page name of a note: its folder's name for a folder note stored inside the folder, its file name otherwise. */
export function noteName(filePath: string, basename: string, options: LocationOptions): string {
	const folder = ownFolder(filePath, options);
	return folder ? folder.slice(folder.lastIndexOf("/") + 1) : basename;
}

export type Frontmatter = Record<string, unknown> | undefined;

export const FM_SPACE = "xwiki-space";
export const FM_PAGE = "xwiki-page";
export const FM_TITLE = "xwiki-title";
export const FM_URL = "xwiki-url";
/** Syntax of the XWiki page when it is not Markdown; the note was converted from its rendered HTML. */
export const FM_SYNTAX = "xwiki-syntax";
/** Full page reference (`Space.Sub.WebHome`); set on pulled notes so they always map back to the same page. */
export const FM_REFERENCE = "xwiki-reference";

/** Splits an XWiki space reference such as `Docs.Team\.A` into `["Docs", "Team.A"]`. */
export function splitSpaceReference(reference: string): string[] {
	const parts: string[] = [];
	let current = "";
	for (let i = 0; i < reference.length; i++) {
		const ch = reference[i];
		if (ch === "\\" && i + 1 < reference.length) {
			current += reference[++i];
		} else if (ch === ".") {
			parts.push(current);
			current = "";
		} else {
			current += ch;
		}
	}
	parts.push(current);
	return parts.map((p) => decodePercent(p).trim()).filter((p) => p.length > 0);
}

/** Space names copied from an XWiki URL are percent-encoded (`Ekip%20Alan%C4%B1`); store them decoded. */
function decodePercent(value: string): string {
	if (!/%[0-9a-f]{2}/i.test(value)) return value;
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function stringValue(fm: Frontmatter, key: string): string | undefined {
	const value = fm?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Looks up the XWiki page a vault folder stands for, from the note named after the folder (`A/B.md` for folder
 * `A/B`) when that note was pulled from XWiki. Returns `null` for other folders.
 */
export type FolderAnchor = (folderPath: string) => PageLocation | null;

/**
 * Splits the note's folders into the space chain they are published below and the folders mirrored as spaces:
 * below the deepest folder that stands for an XWiki page (a pulled folder note), or below the default space.
 */
function mirroredFolders(filePath: string, options: LocationOptions, anchor?: FolderAnchor): { base: string[]; folders: string[] } {
	const folders = filePath.split("/").slice(0, -1).filter((s) => s.length > 0);
	if (anchor) {
		for (let k = folders.length; k > 0; k--) {
			const page = anchor(folders.slice(0, k).join("/"));
			if (page) return { base: pageChain(page), folders: folders.slice(k) };
		}
	}
	// Inside a dedicated sync folder, folders mirror the page tree from the wiki root.
	const syncFolder = (options.syncFolder ?? "").replace(/^\/+|\/+$/g, "");
	if (syncFolder && filePath.startsWith(`${syncFolder}/`)) {
		return { base: [], folders: folders.slice(syncFolder.split("/").length) };
	}
	return { base: splitSpaceReference(options.defaultSpace), folders };
}

/**
 * Computes the XWiki location of a note from its vault path, its frontmatter and the plugin settings.
 * Frontmatter (`xwiki-reference`, `xwiki-space`, `xwiki-page`) always wins over the computed defaults.
 * A note created inside a folder pulled from XWiki is placed below that folder's page.
 */
export function locateNote(filePath: string, basename: string, fm: Frontmatter, options: LocationOptions, anchor?: FolderAnchor): PageLocation {
	const reference = stringValue(fm, FM_REFERENCE);
	const parsed = reference ? parseReference(reference) : null;
	if (parsed) return parsed;

	// A folder note stored inside its folder is located as if it were the note next to the folder.
	const own = ownFolder(filePath, options);
	if (own) {
		basename = noteName(filePath, basename, options);
		filePath = `${own}.md`;
	}
	const pageName = stringValue(fm, FM_PAGE) ?? basename;
	const explicitSpace = stringValue(fm, FM_SPACE);

	let spaces: string[];
	if (explicitSpace) {
		spaces = splitSpaceReference(explicitSpace);
	} else {
		if (options.mirrorFolders) {
			const { base, folders } = mirroredFolders(filePath, options, anchor);
			spaces = [...base, ...folders];
		} else {
			spaces = splitSpaceReference(options.defaultSpace);
		}
	}

	if (options.nestedPages) {
		return { spaces: [...spaces, pageName], page: "WebHome" };
	}
	return { spaces: spaces.length > 0 ? spaces : ["Main"], page: pageName };
}

export function noteTitle(basename: string, fm: Frontmatter): string {
	return stringValue(fm, FM_TITLE) ?? basename;
}

function escapeName(name: string): string {
	return name.replace(/\\/g, "\\\\").replace(/\./g, "\\.");
}

/** Serialises a space chain as a local XWiki space reference, e.g. `Docs.Team\.A`. */
export function serializeSpaceReference(spaces: string[]): string {
	return spaces.map(escapeName).join(".");
}

/** Serialises a location as an XWiki document reference, e.g. `Docs.Team\.A.WebHome`. */
export function serializeReference(location: PageLocation): string {
	return [...location.spaces, location.page].map(escapeName).join(".");
}

/** Parses `Space.Sub.Page`; a single name is treated as the nested page `Name.WebHome`. */
export function parseReference(reference: string): PageLocation | null {
	const parts = splitSpaceReference(reference);
	if (parts.length === 0) return null;
	if (parts.length === 1) return { spaces: parts, page: "WebHome" };
	return { spaces: parts.slice(0, -1), page: parts[parts.length - 1] };
}

/** Human readable page name: the last space for nested pages, the page name otherwise. */
export function pageDisplayName(location: PageLocation): string {
	return location.page === "WebHome" ? (location.spaces[location.spaces.length - 1] ?? "WebHome") : location.page;
}

export function isUnder(spaces: string[], root: string[]): boolean {
	return root.length <= spaces.length && root.every((name, i) => spaces[i] === name);
}

export function sanitizeFileName(name: string): string {
	return name.replace(/[\\/:*?"<>|#^[\]]/g, "-").trim() || "Untitled";
}

/** Page names from the wiki root down to the page itself (`A.B.WebHome` → `[A, B]`, `A.P` → `[A, P]`). */
export function pageChain(location: PageLocation): string[] {
	return location.page === "WebHome" ? [...location.spaces] : [...location.spaces, location.page];
}

/**
 * Vault path for a pulled page: the sync folder mirrors the whole XWiki page tree from the wiki root, whatever
 * space the sync started from. `A.WebHome` maps to `<folder>/A.md`, `A.B.WebHome` to `<folder>/A/B.md` and the
 * terminal page `A.P` to `<folder>/A/P.md`.
 * `titles`, aligned with `pageChain(location)`, replaces technical page names with page titles where known.
 */
export function vaultPathFor(
	location: PageLocation,
	folder: string,
	titles: (string | undefined)[] = [],
	folderNote?: LocationOptions,
): string {
	const relative = pageChain(location).map((name, i) => sanitizeFileName(titles[i]?.trim() || name));
	const prefix = folder.replace(/^\/+|\/+$/g, "");
	const path = `${prefix ? `${prefix}/` : ""}${relative.join("/")}`;
	// A page with children is the folder note of the folder holding its children.
	return folderNote ? folderNotePath(path, folderNote) : `${path}.md`;
}

/**
 * Pages standing for the note's vault folders when the folder structure is mirrored, outermost first,
 * e.g. `Docs.Projects.WebHome` and `Docs.Projects.Alpha.WebHome` for `Projects/Alpha/Note.md`.
 * Folders that already stand for an XWiki page (see `FolderAnchor`) are left out, and the list is empty when the
 * note's location is set explicitly in its frontmatter.
 */
export function folderPages(filePath: string, fm: Frontmatter, options: LocationOptions, anchor?: FolderAnchor): { location: PageLocation; title: string }[] {
	if (!options.mirrorFolders || stringValue(fm, FM_REFERENCE) || stringValue(fm, FM_SPACE)) return [];
	// A folder note is its folder's page itself: only the folders above it need pages.
	const own = ownFolder(filePath, options);
	const { base, folders } = mirroredFolders(own ? `${own}.md` : filePath, options, anchor);
	return folders.map((title, i) => ({ location: { spaces: [...base, ...folders.slice(0, i + 1)], page: "WebHome" }, title }));
}

/** A link into an XWiki instance, decoded into path segments after `/bin/view/` or `/bin/download/`. */
export interface XWikiUrl {
	action: "view" | "download";
	segments: string[];
}

/** Recognises view and download URLs of the XWiki instance at `baseUrl`. */
export function parseXWikiUrl(url: string, baseUrl: string): XWikiUrl | null {
	const base = baseUrl.replace(/\/+$/, "");
	const clean = url.trim().split(/[?#]/)[0];
	for (const action of ["view", "download"] as const) {
		const prefix = `${base}/bin/${action}/`;
		if (!base || !clean.startsWith(prefix)) continue;
		try {
			const segments = clean.slice(prefix.length).split("/").filter(Boolean).map(decodeURIComponent);
			return segments.length > 0 ? { action, segments } : null;
		} catch {
			return null;
		}
	}
	return null;
}

/**
 * Reads the space chain from what the user typed: an XWiki page URL
 * (`…/bin/view/A/B/` or `…/bin/view/A/B/WebHome`) or a space reference (`A.B`).
 */
export function parseSpaceInput(input: string, baseUrl: string): string[] {
	const url = parseXWikiUrl(input, baseUrl);
	if (url?.action === "view") {
		const segments = url.segments;
		return segments[segments.length - 1] === "WebHome" ? segments.slice(0, -1) : segments;
	}
	if (/^https?:\/\//i.test(input.trim())) return [];
	return splitSpaceReference(input);
}

/** What an XWiki link or image reference found in page content points at. */
export type XWikiTarget =
	| { kind: "url"; url: string }
	/** `pages` lists the possible owner pages, or is `null` for an attachment of the current page. */
	| { kind: "attachment"; pages: PageLocation[] | null; name: string }
	/** Possible pages, most likely first: XWiki resolves some references either as terminal or as nested page. */
	| { kind: "page"; candidates: PageLocation[] };

const REFERENCE_TYPES = new Set(["doc", "page", "space", "attach", "url", "path", "mailto"]);

/** Candidate pages for a document reference, relative to the page it appears on. */
function documentCandidates(reference: string, current: PageLocation): PageLocation[] {
	// Drop a wiki prefix such as "xwiki:".
	const local = /^[^.:]+:/.test(reference) ? reference.slice(reference.indexOf(":") + 1) : reference;
	const parts = splitSpaceReference(local);
	if (parts.length === 0) return [current];
	if (parts.length === 1) {
		const name = parts[0];
		return [
			{ spaces: current.spaces, page: name },
			{ spaces: [...current.spaces, name], page: "WebHome" },
			{ spaces: [...current.spaces.slice(0, -1), name], page: "WebHome" },
		];
	}
	const location = parseReference(local) as PageLocation;
	return location.page === "WebHome" ? [location] : [location, { spaces: [...location.spaces, location.page], page: "WebHome" }];
}

/**
 * Interprets an XWiki resource reference (`Space.Page`, `doc:…`, `page:A/B`, `attach:file.png`,
 * `Space.Page@file.png`, `https://…`) found on the page at `current`. Untyped image references are attachments.
 */
export function parseXWikiTarget(reference: string, current: PageLocation, image: boolean): XWikiTarget {
	const ref = reference.trim();
	if (/^(https?|ftp|mailto):/i.test(ref)) return { kind: "url", url: ref };
	const typed = /^([a-z]+):([\s\S]*)$/i.exec(ref);
	const type = typed && REFERENCE_TYPES.has(typed[1].toLowerCase()) ? typed[1].toLowerCase() : null;
	const value = type && typed ? typed[2] : ref;
	if (type === "url" || type === "path") return { kind: "url", url: value };
	if (type === "attach" || (image && !type)) {
		const at = value.lastIndexOf("@");
		if (at < 0) return { kind: "attachment", pages: null, name: value };
		return { kind: "attachment", pages: documentCandidates(value.slice(0, at), current), name: value.slice(at + 1) };
	}
	if (type === "space") return { kind: "page", candidates: [{ spaces: splitSpaceReference(value), page: "WebHome" }] };
	if (type === "page") {
		const parts = value.split("/").map((p) => p.trim()).filter(Boolean);
		// "./" and "../" are relative to the current page: "../C" is a sibling of the current page.
		const relative = /^\.\.?(\/|$)/.test(value.trim());
		const chain = relative ? [...pageChain(current)] : [];
		for (const part of parts) {
			if (part === "..") chain.pop();
			else if (part !== ".") chain.push(part);
		}
		return { kind: "page", candidates: [{ spaces: chain.length > 0 ? chain : current.spaces, page: "WebHome" }] };
	}
	return { kind: "page", candidates: documentCandidates(value, current) };
}

/** Folder for the attachments of the note at `notePath`: a `folderName` subfolder next to the note. */
export function attachmentFolderFor(notePath: string, folderName: string): string {
	const slash = notePath.lastIndexOf("/");
	const noteFolder = slash < 0 ? "" : notePath.slice(0, slash);
	const name = folderName.trim().replace(/^\/+|\/+$/g, "");
	return noteFolder ? `${noteFolder}/${name}` : name;
}

/** `name 2.ext`, `name 3.ext`… for a file path whose name is taken. */
export function numberedPath(path: string, n: number): string {
	const slash = path.lastIndexOf("/");
	const dot = path.lastIndexOf(".");
	return dot > slash + 1 ? `${path.slice(0, dot)} ${n}${path.slice(dot)}` : `${path} ${n}`;
}

/** Whether `fileName` is `name` numbered to avoid a clash, e.g. `img 1.png` or `img 2.png` for `img.png`. */
export function numberedMatch(name: string, fileName: string): boolean {
	const dot = name.lastIndexOf(".");
	const stem = dot > 0 ? name.slice(0, dot) : name;
	const extension = dot > 0 ? name.slice(dot) : "";
	return new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\d+${extension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`).test(fileName);
}

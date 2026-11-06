/**
 * Finds OpenProject work package links in published pages and keeps the wiki page links of those work packages up to
 * date. This module is free of Obsidian imports so it can be unit tested with plain Node.
 */
import { transformOutsideCode } from "./converter.ts";

/** Type of the links shown as linked pages in the Wikis tab of a work package. */
export const RELATION_LINK_TYPE = "urn:openproject-org:api:v3:wikiPageLinks:Relation";

export class OpenProjectError extends Error {
	/** HTTP status of the answer; absent when the server did not answer. */
	readonly status?: number;

	constructor(message: string, status?: number) {
		super(message);
		this.name = "OpenProjectError";
		this.status = status;
	}
}

/** The wiki page link calls of the OpenProject API; `link` identifies the XWiki page on the wiki provider. */
export interface WikiLinkApi {
	/** ID of the link between the work package and the page, or `null` when they are not linked. */
	findLink(workPackage: string, link: PageLink): Promise<number | null>;
	createLink(workPackage: string, link: PageLink): Promise<void>;
	deleteLink(id: number): Promise<void>;
}

export interface PageLink {
	/** Universal identifier of the wiki provider: the XWiki instance id. */
	provider: string;
	/** Stable identifier of the page on XWiki. */
	identifier: string;
}

export interface LinkFailure {
	workPackage: string;
	action: "link" | "remove";
	message: string;
}

/** What publishing a note changed in OpenProject. */
export interface LinkReport {
	linked: string[];
	/** Already linked: nothing was added, so a work package never gets the same page twice. */
	existing: string[];
	removed: string[];
	/** Removed from the note, but the work package was not linked to the page. */
	notLinked: string[];
	failed: LinkFailure[];
}

const UNREADABLE_LINKS =
	"OpenProject could not list the links of the work package; the OpenProject account of the token may not be connected to XWiki";

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isServerError(error: unknown): boolean {
	return error instanceof OpenProjectError && error.status !== undefined && error.status >= 500;
}

/**
 * Work packages linked in `text`, in order of appearance, without repetitions. Only links to the OpenProject at
 * `baseUrl` count, with either scheme; links in code are examples, not references. Semantic ids (`PROJ-42`) are
 * upper-cased, because OpenProject does not distinguish their case.
 */
export function workPackagesIn(text: string, baseUrl: string): string[] {
	const host = baseUrl
		.trim()
		.replace(/^https?:\/\//i, "")
		.replace(/\/+$/, "")
		.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	if (!host) return [];
	const pattern = new RegExp(
		// No lookbehind for the start of the URL: older iOS versions cannot parse it.
		`(?:^|[^\\w+.-])https?://${host}(?:/projects/[^/\\s()<>\\]]+)?/(?:work_packages(?:/details)?|wp)/(\\d+|[a-z][a-z0-9_]*-\\d+)(?![\\w-])`,
		"gim",
	);
	const found = new Set<string>();
	transformOutsideCode(text, (part) => {
		for (const match of part.matchAll(pattern)) found.add(match[1].toUpperCase());
		return part;
	});
	return [...found];
}

/** The link between a page and a work package among the elements of a wiki page link collection, if there is one. */
export function relationLinkIn(collection: unknown, link: PageLink): number | null {
	const elements = (collection as { _embedded?: { elements?: unknown } } | null)?._embedded?.elements;
	if (!Array.isArray(elements)) return null;
	for (const element of elements as {
		id?: unknown;
		identifier?: unknown;
		wikiPageLinkType?: unknown;
		_links?: { provider?: { href?: unknown } };
	}[]) {
		const href = element._links?.provider?.href;
		if (
			typeof element.id === "number" &&
			element.identifier === link.identifier &&
			element.wikiPageLinkType === RELATION_LINK_TYPE &&
			(typeof href !== "string" || href.endsWith(`/${encodeURIComponent(link.provider)}`))
		) {
			return element.id;
		}
	}
	return null;
}

async function removeLink(api: WikiLinkApi, workPackage: string, link: PageLink, report: LinkReport): Promise<void> {
	try {
		const id = await api.findLink(workPackage, link);
		if (id === null) {
			report.notLinked.push(workPackage);
			return;
		}
		await api.deleteLink(id);
		report.removed.push(workPackage);
	} catch (error) {
		report.failed.push({ workPackage, action: "remove", message: isServerError(error) ? `${UNREADABLE_LINKS} (${message(error)})` : message(error) });
	}
}

async function addLink(api: WikiLinkApi, workPackage: string, link: PageLink, report: LinkReport): Promise<void> {
	let unreadable = false;
	try {
		try {
			if ((await api.findLink(workPackage, link)) !== null) {
				report.existing.push(workPackage);
				return;
			}
		} catch (error) {
			// OpenProject refuses a duplicate link by itself, so the link can still be attempted safely.
			if (!isServerError(error)) throw error;
			unreadable = true;
		}
		await api.createLink(workPackage, link);
		report.linked.push(workPackage);
	} catch (error) {
		report.failed.push({ workPackage, action: "link", message: unreadable ? `${message(error)} ${UNREADABLE_LINKS}.` : message(error) });
	}
}

/**
 * Makes OpenProject follow the links of a page: work packages whose link left the page lose their wiki page link,
 * and those linked on the page get one unless they have it. Links added by hand in OpenProject, to work packages
 * the page never mentioned, are left alone. Removals run first: when `/work_packages/1` became `/work_packages/P-1`,
 * the same work package is removed and linked again instead of ending up without a link.
 */
export async function syncPageLinks(api: WikiLinkApi, link: PageLink, previous: string[], current: string[]): Promise<LinkReport> {
	const report: LinkReport = { linked: [], existing: [], removed: [], notLinked: [], failed: [] };
	for (const workPackage of previous) {
		if (!current.includes(workPackage)) await removeLink(api, workPackage, link, report);
	}
	for (const workPackage of current) await addLink(api, workPackage, link, report);
	return report;
}

/** A report for when nothing could be done because the page could not be identified: every link failed the same way. */
export function failedReport(previous: string[], current: string[], reason: string): LinkReport {
	const failed: LinkFailure[] = [
		...previous.filter((workPackage) => !current.includes(workPackage)).map((workPackage) => ({ workPackage, action: "remove" as const, message: reason })),
		...current.map((workPackage) => ({ workPackage, action: "link" as const, message: reason })),
	];
	return { linked: [], existing: [], removed: [], notLinked: [], failed };
}

function label(workPackage: string): string {
	return /^\d+$/.test(workPackage) ? `#${workPackage}` : workPackage;
}

function labels(workPackages: string[]): string {
	return workPackages.map(label).join(", ");
}

/** One line for the activity list: what happened to each work package linked from a note. */
export function describeLinks(noteName: string, report: LinkReport): string {
	const parts = [
		report.linked.length > 0 ? `linked ${labels(report.linked)}` : "",
		report.existing.length > 0 ? `already linked ${labels(report.existing)}` : "",
		report.removed.length > 0 ? `removed ${labels(report.removed)}` : "",
		report.notLinked.length > 0 ? `was not linked ${labels(report.notLinked)}` : "",
	].filter(Boolean);
	// A missing right or a bad token fails every work package the same way.
	const failures = new Map<string, string[]>();
	for (const { workPackage, action, message } of report.failed) {
		const key = `could not ${action === "link" ? "link" : "remove"}|${message}`;
		failures.set(key, [...(failures.get(key) ?? []), workPackage]);
	}
	for (const [key, workPackages] of failures) {
		const separator = key.indexOf("|");
		parts.push(`${key.slice(0, separator)} ${labels(workPackages)}: ${key.slice(separator + 1)}`);
	}
	return `OpenProject links of "${noteName}": ${parts.join("; ")}`;
}

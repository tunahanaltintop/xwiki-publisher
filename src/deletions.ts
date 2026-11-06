import { type PageLocation, pageChain, parseReference } from "./location.ts";

/** A note deleted from the vault whose XWiki page was not deleted yet. */
export interface DeletedNote {
	/** Where the note was in the vault. */
	path: string;
	/** Serialized `location`. */
	reference: string;
	location: PageLocation;
	/** Version of the page at the last sync of the note. */
	version: string;
}

/**
 * The notes to show as deleted, from the sync records kept for them, ordered by path. A page that another note still
 * belongs to (`livePages`, by reference) is not offered for deletion: a note copied with its `xwiki-reference` shares
 * the page with the original, and deleting the copy must not take the page away from it.
 */
export function deletedNotes(records: Record<string, { version: string; reference?: string }>, livePages: ReadonlySet<string>): DeletedNote[] {
	const pages = new Map<string, DeletedNote>();
	for (const path of Object.keys(records).sort((a, b) => a.localeCompare(b))) {
		const { version, reference } = records[path];
		if (!reference || livePages.has(reference) || pages.has(reference)) continue;
		const location = parseReference(reference);
		if (location) pages.set(reference, { path, reference, location, version });
	}
	return [...pages.values()];
}

/** Children first, so that a parent page is never missing while the pages below it are still being deleted. */
export function deletionOrder(notes: DeletedNote[]): DeletedNote[] {
	return [...notes].sort((a, b) => pageChain(b.location).length - pageChain(a.location).length || a.path.localeCompare(b.path));
}

/** Why the page must not be deleted without being told to overwrite it, or `null` when it may be; same rules as publishing. */
export function deletionBlocker(remote: { syntax: string; version: string }, syncedVersion: string): string | null {
	if (!/^markdown\//i.test(remote.syntax)) return `written in ${remote.syntax}`;
	return remote.version === syncedVersion ? null : "changed on XWiki";
}

/** File name of a vault path, without its extension. */
export function noteBasename(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
}

import { App, getLinkpath, normalizePath, Notice, TAbstractFile, TFile, TFolder } from "obsidian";
import { stripFrontmatter } from "./converter";
import { DeletedNote, deletedNotes } from "./deletions";
import { contentHash } from "./hash";
import { xwikiHtmlToMarkdown } from "./html";
import {
	attachmentFolderFor,
	FM_REFERENCE,
	FM_SYNTAX,
	FM_TITLE,
	FM_URL,
	folderNotePath,
	FolderNoteLocation,
	isUnder,
	locateNote,
	numberedMatch,
	numberedPath,
	ownFolder,
	PageLocation,
	pageChain,
	pageDisplayName,
	parseReference,
	parseXWikiTarget,
	sanitizeFileName,
	serializeReference,
	vaultPathFor,
} from "./location";
import { choose } from "./modals";
import { convertFromXWiki, extractMarkdown, ReverseTarget, XWIKI_IMAGE, XWIKI_LINK } from "./reverse";
import { hardLineBreaks, type XWikiPublisherSettings } from "./settings";
import { RemoteAttachment, RemotePage, XWikiClient } from "./xwiki-client";
import { xwiki21ToMarkdown } from "./xwiki21";

/** What the vault and XWiki agreed on at the last successful publish or pull of a note. */
export interface SyncRecord {
	version: string;
	/** Hash of the note body, frontmatter excluded, so editing properties is not a content change. */
	bodyHash?: string;
	/** Hash of the whole file, written by earlier versions; still read until the note is synced again. */
	hash?: string;
	/**
	 * Path where the plugin last placed a pulled note. While the note is still there, the plugin may move it when
	 * its page moves; once the user put it elsewhere, it stays where the user put it. Empty: placed by the user.
	 */
	placedAt?: string;
	/** Page the note was last synced with, kept so that the page can still be found once the note is deleted. */
	reference?: string;
	/** Attachments of the page that could not be downloaded at the last pull; the next pull or sync tries them again. */
	missingAttachments?: string[];
}

export type SyncState = Record<string, SyncRecord>;

/** Vault path of each attachment downloaded from XWiki, by `<page reference>|<attachment name>`. */
export type AttachmentPaths = Record<string, string>;

/** XWiki version of each downloaded attachment, by the same key, so unchanged files are not downloaded again. */
export type AttachmentVersions = Record<string, string>;

/** Keys of attachments that are the user's own files, uploaded on publish: they are never moved. */
export type UploadedAttachments = Record<string, true>;

export interface SpaceSyncResult {
	counts: Record<PullOutcome, number>;
	/** Pages that are not written in Markdown and were converted from their rendered HTML. */
	converted: number;
	/** Pages that could not be pulled, with the reason. */
	failures: string[];
}

export type PullOutcome = "created" | "updated" | "unchanged" | "conflict" | "missing" | "cancelled";

export interface PullResult {
	outcome: PullOutcome;
	/** The page is not in Markdown syntax and was converted from its rendered HTML. */
	converted: boolean;
}

/** Host services the sync logic needs from the plugin. */
export interface SyncHost {
	app: App;
	settings: XWikiPublisherSettings;
	syncState: SyncState;
	/** Sync records of notes deleted from the vault, by their last path, until their pages are deleted or kept. */
	deletedNotes: SyncState;
	attachmentPaths: AttachmentPaths;
	attachmentVersions: AttachmentVersions;
	uploadedAttachments: UploadedAttachments;
	saveSettings(): Promise<void>;
}

interface PullOptions {
	/** Existing note to update; otherwise looked up in the index or created. */
	file?: TFile;
	/** Ask the user what to do on conflicts instead of writing a conflict copy. */
	interactive: boolean;
	index: Map<string, TFile>;
	/** Already fetched page, to avoid reading it twice. */
	remote?: RemotePage | null;
	/** Titles of ancestor pages already looked up during this run, by reference. */
	titleCache?: Map<string, string>;
	/** References of the pages known to have children in this run; they become folder notes. */
	parents?: Set<string>;
	/** Vault names given to pages during this run, by path: two pages with the same title get distinct names. */
	claims?: Map<string, string>;
}

/** Attachment names can contain characters that are not allowed in vault file names. */
function sanitizeAttachmentName(name: string): string {
	return name.replace(/[\\/:*?"<>|]/g, "-").trim() || "attachment";
}

/** During a long sync, the progress made so far is saved this often, so an interrupted sync resumes where it stopped. */
const CHECKPOINT_MS = 10_000;

function bodyHash(text: string): string {
	return contentHash(stripFrontmatter(text).trim());
}

export class SyncService {
	/** While a space sync runs, saving is deferred to its end instead of rewriting the data file for every page. */
	private batchDepth = 0;
	private unsaved = false;
	private lastSave = 0;

	constructor(private readonly host: SyncHost) {}

	private get app(): App {
		return this.host.app;
	}

	private async save(): Promise<void> {
		if (this.batchDepth > 0) {
			this.unsaved = true;
			return;
		}
		await this.host.saveSettings();
	}

	/** Runs `task` with saving deferred; saves once at the end, also when the task fails or is cancelled. */
	async batch<T>(task: () => Promise<T>): Promise<T> {
		if (this.batchDepth++ === 0) this.lastSave = Date.now();
		try {
			return await task();
		} finally {
			this.batchDepth--;
			if (this.batchDepth === 0 && this.unsaved) {
				this.unsaved = false;
				try {
					await this.host.saveSettings();
				} catch (error) {
					// Do not hide the task's own error; the state is saved again with the next change.
					console.error("XWiki Publisher: could not save the sync state", error);
				}
			}
		}
	}

	/**
	 * Inside a batch, saves the changes made so far when the last save is a few seconds old. A sync that is
	 * interrupted (Obsidian closed or crashed) then keeps the pages and attachments it already pulled, and the next
	 * run skips them instead of downloading them again.
	 */
	async checkpoint(): Promise<void> {
		if (this.batchDepth === 0 || !this.unsaved || Date.now() - this.lastSave < CHECKPOINT_MS) return;
		this.unsaved = false;
		this.lastSave = Date.now();
		try {
			await this.host.saveSettings();
		} catch (error) {
			this.unsaved = true;
			console.error("XWiki Publisher: could not save the sync state", error);
		}
	}

	locate(file: TFile): PageLocation {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		return locateNote(file.path, file.basename, fm, this.host.settings, this.folderAnchor);
	}

	/**
	 * The XWiki page a vault folder stands for: the reference of the folder's pulled folder note. The configured
	 * layout is tried first, then the other one, so folders keep working while notes move after a layout change.
	 */
	readonly folderAnchor = (folderPath: string): PageLocation | null => {
		const settings = this.host.settings;
		const layouts: FolderNoteLocation[] = settings.folderNoteLocation === "inside" ? ["inside", "parent"] : ["parent", "inside"];
		for (const layout of layouts) {
			const reference = this.referenceOf(this.app.vault.getFileByPath(normalizePath(folderNotePath(folderPath, settings, layout))));
			if (reference) return reference;
		}
		return null;
	};

	/** Page a pulled note belongs to, from its `xwiki-reference` property. */
	private referenceOf(file: TFile | null): PageLocation | null {
		const reference: unknown = file ? this.app.metadataCache.getFileCache(file)?.frontmatter?.[FM_REFERENCE] : undefined;
		return typeof reference === "string" ? parseReference(reference) : null;
	}

	/**
	 * Maps the XWiki location of each note that was published or pulled to the note, so pulled pages land on the note
	 * they came from. Only notes known from the sync records are read, never a listing of the whole vault.
	 */
	buildIndex(): Map<string, TFile> {
		const index = new Map<string, TFile>();
		for (const path of Object.keys(this.host.syncState)) {
			const file = this.app.vault.getFileByPath(path);
			if (file && file.extension === "md") index.set(serializeReference(this.locate(file)), file);
		}
		return index;
	}

	/**
	 * Records that the note and the page at `location` agree, at the page's `version`. The location is given, not read
	 * from the note, because the properties of a note that was just written are not in the metadata cache yet.
	 */
	async recordSync(file: TFile, version: string, location: PageLocation, placed = false, missing?: string[]): Promise<void> {
		const previous = this.host.syncState[file.path];
		const reference = serializeReference(location);
		this.dropDeleted(reference);
		this.host.syncState[file.path] = {
			version,
			bodyHash: bodyHash(await this.app.vault.read(file)),
			reference,
			// Notes synced before placement was recorded count as placed where they are now.
			placedAt: placed ? file.path : (previous?.placedAt ?? file.path),
			// A publish does not download anything: it keeps the attachments still to fetch.
			missingAttachments: missing === undefined ? previous?.missingAttachments : missing.length > 0 ? missing : undefined,
		};
		await this.save();
	}

	/** Notes deleted from the vault whose pages are not used by any of `notes`, the live notes of the vault. */
	pendingDeletions(notes: TFile[]): DeletedNote[] {
		const records = this.host.deletedNotes;
		if (Object.keys(records).length === 0) return [];
		const live = new Set<string>();
		for (const file of notes) {
			live.add(serializeReference(this.locate(file)));
			const reference = this.host.syncState[file.path]?.reference;
			if (reference) live.add(reference);
		}
		return deletedNotes(records, live);
	}

	/** Stops tracking the deleted notes of the page: it was deleted, or the user keeps it. */
	async forgetDeleted(reference: string): Promise<void> {
		this.dropDeleted(reference);
		await this.save();
	}

	private dropDeleted(reference: string): void {
		for (const [path, record] of Object.entries(this.host.deletedNotes)) {
			if (record.reference === reference) delete this.host.deletedNotes[path];
		}
	}

	/**
	 * Brings the records up to date with the vault. Records written by earlier versions get the page of their note,
	 * once its properties are known. Notes that left the vault while Obsidian was closed count as deleted.
	 */
	reconcileRecords(): void {
		if (!this.app.workspace.layoutReady) return;
		let changed = false;
		for (const [path, record] of Object.entries(this.host.syncState)) {
			const file = this.app.vault.getFileByPath(path);
			if (!file) {
				if (!record.reference) continue;
				this.host.deletedNotes[path] = record;
				delete this.host.syncState[path];
				changed = true;
			} else if (!record.reference && this.app.metadataCache.getFileCache(file)) {
				record.reference = serializeReference(this.locate(file));
				changed = true;
			}
		}
		if (changed) void this.save();
	}

	/** Whether the note was edited since it was last published or pulled. */
	isLocallyChanged(file: TFile, text: string): boolean {
		const record = this.host.syncState[file.path];
		if (!record) return true;
		if (record.bodyHash !== undefined) return record.bodyHash !== bodyHash(text);
		return record.hash !== contentHash(text);
	}

	/** Version of the page at the last sync of the note, if any. */
	lastSyncedVersion(file: TFile): string | undefined {
		return this.host.syncState[file.path]?.version;
	}

	private attachmentKey(location: PageLocation, name: string): string {
		return `${serializeReference(location)}|${name}`;
	}

	/** Attachments downloaded for a page: XWiki name → vault file. */
	private trackedAttachments(location: PageLocation): Map<string, TFile> {
		const prefix = `${serializeReference(location)}|`;
		const files = new Map<string, TFile>();
		for (const [key, path] of Object.entries(this.host.attachmentPaths)) {
			if (!key.startsWith(prefix)) continue;
			const file = this.app.vault.getFileByPath(path);
			if (file) files.set(key.slice(prefix.length), file);
		}
		return files;
	}

	/** XWiki name of a vault file that was downloaded as an attachment of the page, if it was. */
	attachmentNameFor(location: PageLocation, path: string): string | undefined {
		for (const [name, file] of this.trackedAttachments(location)) if (file.path === path) return name;
		return undefined;
	}

	/** Remembers a file uploaded as an attachment of the page, so pulling the page reuses it instead of a copy. */
	trackUpload(location: PageLocation, name: string, path: string): void {
		const key = this.attachmentKey(location, name);
		// A file the plugin downloaded for this page and the user published back stays a downloaded attachment.
		if (this.host.attachmentPaths[key] === path && !this.host.uploadedAttachments[key]) return;
		this.host.attachmentPaths[key] = path;
		this.host.uploadedAttachments[key] = true;
		// The uploaded file is the current one; its new XWiki version is recorded on the next pull without a download.
		delete this.host.attachmentVersions[key];
	}

	/** Resolves a page URL or reference typed by the user, trying the nested page first. */
	async findPage(client: XWikiClient, input: string): Promise<{ location: PageLocation; remote: RemotePage } | null> {
		const parsed = client.parseUrl(input);
		const candidates: PageLocation[] = [];
		if (parsed?.action === "view") {
			const segments = parsed.segments;
			if (segments[segments.length - 1] === "WebHome") {
				candidates.push({ spaces: segments.slice(0, -1), page: "WebHome" });
			} else {
				candidates.push({ spaces: segments, page: "WebHome" });
				if (segments.length > 1) candidates.push({ spaces: segments.slice(0, -1), page: segments[segments.length - 1] });
			}
		} else {
			const location = parseReference(input);
			if (location) {
				candidates.push(location);
				if (location.page !== "WebHome") candidates.push({ spaces: [...location.spaces, location.page], page: "WebHome" });
			}
		}
		for (const location of candidates) {
			const remote = await client.getPage(location);
			if (remote) return { location, remote };
		}
		return null;
	}

	private resolver(client: XWikiClient, location: PageLocation, sourcePath: string, index: Map<string, TFile>, saved: Map<string, string>) {
		const current = serializeReference(location);
		const attachment = (name: string): ReverseTarget => ({ kind: "attachment", name, linktext: saved.get(name) });
		const note = (file: TFile): ReverseTarget => {
			const cache = this.app.metadataCache.getFileCache(file);
			return {
				kind: "note",
				linktext: this.app.metadataCache.fileToLinktext(file, sourcePath, true),
				basename: file.basename,
				headings: cache?.headings?.map((heading) => heading.heading) ?? [],
				blocks: Object.keys(cache?.blocks ?? {}),
			};
		};
		return (target: string, image: boolean): ReverseTarget | null => {
			// XWiki references from wiki-style links ([[label|Space.Page]]) always resolve: to a note, an attachment or a URL.
			if (target.startsWith(XWIKI_LINK) || target.startsWith(XWIKI_IMAGE)) {
				let reference = target.slice(target.indexOf(":") + 1);
				try {
					reference = decodeURIComponent(reference);
				} catch {
					// keep the encoded form
				}
				const resolved = parseXWikiTarget(reference, location, target.startsWith(XWIKI_IMAGE));
				if (resolved.kind === "url") return resolved;
				if (resolved.kind === "attachment") {
					if (!resolved.pages || resolved.pages.some((page) => serializeReference(page) === current)) return attachment(resolved.name);
					return { kind: "url", url: client.attachmentUrl(resolved.pages[0], resolved.name) };
				}
				for (const candidate of resolved.candidates) {
					const file = index.get(serializeReference(candidate));
					if (file) return note(file);
				}
				return { kind: "url", url: client.viewUrl(resolved.candidates[0]) };
			}
			if (target.startsWith("attach:")) return attachment(target.slice("attach:".length));
			// Bare names in images refer to attachments of the current page.
			if (image && !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.includes("/")) {
				try {
					return attachment(decodeURIComponent(target));
				} catch {
					return attachment(target);
				}
			}
			const url = client.parseUrl(target);
			if (!url) return null;
			const segments = url.segments;
			if (url.action === "download") {
				if (segments.length < 2) return null;
				const owner = serializeReference({ spaces: segments.slice(0, -2), page: segments[segments.length - 2] });
				return owner === current ? attachment(segments[segments.length - 1]) : null;
			}
			const candidates: PageLocation[] =
				segments[segments.length - 1] === "WebHome"
					? [{ spaces: segments.slice(0, -1), page: "WebHome" }]
					: [
							{ spaces: segments, page: "WebHome" },
							{ spaces: segments.slice(0, -1), page: segments[segments.length - 1] },
						];
			for (const candidate of candidates) {
				const file = index.get(serializeReference(candidate));
				if (file) return note(file);
			}
			return null;
		};
	}

	private async ensureFolder(path: string): Promise<void> {
		const parts = path.split("/").slice(0, -1);
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (!this.app.vault.getFolderByPath(current)) await this.app.vault.createFolder(current);
		}
	}

	private replaceBody(data: string, body: string): string {
		const frontmatter = data.slice(0, data.length - stripFrontmatter(data).length);
		return frontmatter + body;
	}

	/**
	 * Moves a file, letting Obsidian update the links to it. Notes that were in sync and only change because their
	 * links are rewritten stay in sync, so the move does not look like a local edit on the next pull.
	 */
	private async move(file: TAbstractFile, target: string): Promise<void> {
		const inSync: TFile[] = [];
		for (const [source, targets] of Object.entries(this.app.metadataCache.resolvedLinks)) {
			if (!targets[file.path] && !(file instanceof TFolder && Object.keys(targets).some((t) => t.startsWith(`${file.path}/`)))) continue;
			const note = this.app.vault.getFileByPath(source);
			if (note && this.host.syncState[source] && !this.isLocallyChanged(note, await this.app.vault.read(note))) inSync.push(note);
		}
		// Creates the parent folders only: a moved folder must not exist yet at its target.
		await this.ensureFolder(target);
		const from = file.path;
		await this.app.fileManager.renameFile(file, target);
		// Notes the plugin placed stay placed after its own moves (the user's moves are not made here).
		for (const record of Object.values(this.host.syncState)) {
			if (record.placedAt === from) record.placedAt = target;
			else if (file instanceof TFolder && record.placedAt?.startsWith(`${from}/`)) record.placedAt = target + record.placedAt.slice(from.length);
		}
		for (const note of inSync) {
			const record = this.host.syncState[note.path];
			if (record) this.host.syncState[note.path] = { ...record, bodyHash: bodyHash(await this.app.vault.read(note)), hash: undefined };
		}
	}

	/**
	 * Downloads attachments of a page. A file downloaded earlier for the same page and name is updated in place, and
	 * skipped when its XWiki version did not change; anything else gets a new file, so files of other notes that share
	 * the name are never overwritten. Fills `links` with the link text of each saved file, by attachment name.
	 * Returns the attachments that failed, and among them those worth trying again: the ones that exist on the page.
	 */
	private async downloadAttachments(
		client: XWikiClient,
		location: PageLocation,
		names: Set<string>,
		notePath: string,
		links: Map<string, string>,
	): Promise<{ failed: string[]; retry: string[] }> {
		const failed: string[] = [];
		if (names.size === 0) return { failed, retry: [] };
		let remote: RemoteAttachment[] = [];
		let listed = false;
		try {
			remote = await client.listAttachments(location);
			listed = true;
		} catch (error) {
			console.debug("XWiki Publisher: could not list attachments, downloading all", error);
		}
		const versions = new Map(remote.map((attachment) => [attachment.name, attachment.version]));
		for (const name of names) {
			const key = this.attachmentKey(location, name);
			const previous = this.host.attachmentPaths[key];
			let file = previous ? this.app.vault.getFileByPath(previous) : null;
			const version = versions.get(name) ?? "";
			try {
				const known = this.host.attachmentVersions[key];
				if (file && version && known === undefined) {
					// First sight of a file that is already in the vault (downloaded by an earlier version, or uploaded):
					// trust it and remember the version instead of overwriting possible local edits.
					this.host.attachmentVersions[key] = version;
				} else if (!file || !version || known !== version) {
					const data = await client.getAttachment(location, name);
					if (file) {
						await this.app.vault.modifyBinary(file, data);
					} else {
						const folder = this.attachmentFolder(notePath);
						const path =
							folder === null
								? await this.app.fileManager.getAvailablePathForAttachment(sanitizeAttachmentName(name), notePath)
								: this.availablePath(normalizePath(`${folder}/${sanitizeAttachmentName(name)}`));
						await this.ensureFolder(path);
						file = await this.app.vault.createBinary(path, data);
						this.host.attachmentPaths[key] = file.path;
					}
					if (version) this.host.attachmentVersions[key] = version;
					// Pages can have many large attachments: remember each download, so an interrupted sync does not
					// download it again as a copy.
					await this.save();
					await this.checkpoint();
				}
				links.set(name, this.app.metadataCache.fileToLinktext(file, notePath, true));
			} catch (error) {
				console.error(`XWiki Publisher: failed to download attachment ${name}`, error);
				failed.push(name);
			}
		}
		// A link to an attachment the page does not have fails every time; only the others are tried again.
		return { failed, retry: listed ? failed.filter((name) => versions.has(name)) : failed };
	}

	private async writeMetadata(file: TFile, client: XWikiClient, location: PageLocation, remote: RemotePage, isNew: boolean): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			if (isNew) fm[FM_REFERENCE] = serializeReference(location);
			// Keep the XWiki title only when the file name cannot carry it, and never leave an outdated one behind.
			if (remote.title && remote.title !== file.basename) fm[FM_TITLE] = remote.title;
			else delete fm[FM_TITLE];
			if (extractMarkdown(remote.content, remote.syntax) === null) fm[FM_SYNTAX] = remote.syntax;
			else delete fm[FM_SYNTAX];
			if (this.host.settings.writeUrlToFrontmatter) fm[FM_URL] = client.viewUrl(location);
		});
	}

	/**
	 * Markdown of a page: its source when written in Markdown, otherwise its rendered HTML converted to Markdown
	 * (macros are executed by XWiki, so their output is kept as plain content).
	 */
	private async remoteMarkdown(client: XWikiClient, location: PageLocation, remote: RemotePage): Promise<{ source: string; converted: boolean }> {
		const markdown = extractMarkdown(remote.content, remote.syntax);
		if (markdown !== null) return { source: await this.withAttachmentList(client, location, markdown), converted: false };

		// Optionally, XWiki syntax pages are converted from their source so macros stay macros. Pages whose content
		// comes from a sheet (empty source) are always converted from their view.
		if (this.host.settings.preserveMacros && /^xwiki\/2\./i.test(remote.syntax) && remote.content.trim()) {
			return { source: await this.withAttachmentList(client, location, xwiki21ToMarkdown(remote.content)), converted: true };
		}

		const base = this.host.settings.baseUrl;
		// What the user sees: the content area of the page view, sheets included.
		const view = await client.getViewHtml(location);
		let source = xwikiHtmlToMarkdown(view, base, "#xwikicontent");
		// Skins without #xwikicontent: fall back to rendering the page content alone.
		if (source === null || !source.trim()) source = xwikiHtmlToMarkdown(await client.getRenderedHtml(location), base) ?? "";
		source = await this.withAttachmentList(client, location, source);
		if (!source.trim()) {
			console.debug("XWiki Publisher: page converted to empty Markdown", {
				page: serializeReference(location),
				syntax: remote.syntax,
				contentLength: remote.content.length,
				viewLength: view.length,
				hasContentArea: view.includes('id="xwikicontent"'),
			});
		}
		return { source, converted: true };
	}

	/** Pages without text whose documents are attachments become a list of those attachments. */
	private async withAttachmentList(client: XWikiClient, location: PageLocation, source: string): Promise<string> {
		if (source.trim()) return source;
		const attachments = await client.listAttachments(location);
		if (attachments.length === 0) return source;
		const items = attachments.map(({ name }) => `- [${name}](${client.attachmentUrl(location, name)})`);
		return `## Attachments\n\n${items.join("\n")}\n`;
	}

	/**
	 * Titles along the page chain: the page's own title and those of its ancestor pages, which become folders.
	 * Notes and folders are named after titles, which stay readable when a page was renamed in XWiki without being
	 * moved (its technical name keeps the old value).
	 */
	private async pathTitles(client: XWikiClient, location: PageLocation, remote: RemotePage, cache: Map<string, string>): Promise<(string | undefined)[]> {
		const chain = pageChain(location);
		const titles = Array.from<string | undefined>({ length: chain.length });
		titles[chain.length - 1] = remote.title || undefined;
		for (let k = 0; k < chain.length - 1; k++) {
			const ancestor: PageLocation = { spaces: chain.slice(0, k + 1), page: "WebHome" };
			const key = serializeReference(ancestor);
			if (!cache.has(key)) {
				try {
					cache.set(key, (await client.getPage(ancestor))?.title ?? "");
				} catch {
					cache.set(key, "");
				}
			}
			titles[k] = cache.get(key) || undefined;
		}
		return titles;
	}

	/** First free path, adding " 2", " 3"… when the name is taken. */
	private availablePath(path: string, self?: TFile): string {
		const free = (candidate: string) => {
			const found = this.app.vault.getAbstractFileByPath(candidate);
			return !found || found === self;
		};
		if (free(path)) return path;
		for (let n = 2; ; n++) {
			if (free(numberedPath(path, n))) return numberedPath(path, n);
		}
	}

	/** Page that already uses a vault name (as a note or a folder note), if any. */
	private ownerOf(base: string): string | undefined {
		const settings = this.host.settings;
		for (const path of [`${base}.md`, folderNotePath(base, settings, "inside"), folderNotePath(base, settings, "parent")]) {
			const reference = this.referenceOf(this.app.vault.getFileByPath(normalizePath(path)));
			if (reference) return serializeReference(reference);
		}
		return undefined;
	}

	/**
	 * Vault name for a page in the folder `parent`: its title, numbered when another page already uses that name, so
	 * two sibling pages with the same title also get separate folders for their children.
	 */
	private claimName(parent: string, title: string, page: string, claims: Map<string, string>): string {
		for (let n = 1; ; n++) {
			const name = n === 1 ? title : `${title} ${n}`;
			const path = parent ? `${parent}/${name}` : name;
			const owner = claims.get(path) ?? this.ownerOf(path);
			if (!owner || owner === page) {
				claims.set(path, page);
				return name;
			}
		}
	}

	/** Folder for the attachments of a pulled note, or `null` to follow Obsidian's attachment setting. */
	private attachmentFolder(notePath: string): string | null {
		const name = this.host.settings.attachmentFolder.trim();
		return name ? normalizePath(attachmentFolderFor(notePath, name)) : null;
	}

	/**
	 * Keeps the attachments downloaded for a page in the attachment folder of its note, also after the note moved
	 * or the setting changed. Obsidian updates the links to moved files.
	 */
	private async relocateAttachments(client: XWikiClient, location: PageLocation, note: TFile): Promise<void> {
		const folder = this.attachmentFolder(note.path);
		if (folder === null) return;
		await this.adoptLinkedAttachments(client, location, note);
		const attachmentFolderName = this.host.settings.attachmentFolder.trim();
		const page = serializeReference(location);
		for (const [name, file] of this.trackedAttachments(location)) {
			// The user's own files that were uploaded on publish stay where the user keeps them.
			if (file.parent?.path === folder || this.host.uploadedAttachments[`${page}|${name}`]) continue;
			const oldParent = file.parent;
			await this.move(file, this.availablePath(normalizePath(`${folder}/${file.name}`), file));
			// Only an attachment folder left empty is removed, never the folders around it.
			if (oldParent && !oldParent.isRoot() && oldParent.name === attachmentFolderName && oldParent.children.length === 0) {
				await this.app.fileManager.trashFile(oldParent);
			}
		}
	}

	/**
	 * Takes over files that a pulled note links to but that were saved before attachments were tracked (for example in
	 * the vault root), so they can be moved to the note's attachment folder. Only files named like an attachment of the
	 * page that no other note links to are taken over; notes created in the vault are left alone.
	 */
	private async adoptLinkedAttachments(client: XWikiClient, location: PageLocation, note: TFile): Promise<void> {
		const cache = this.app.metadataCache.getFileCache(note);
		if (!cache?.frontmatter?.[FM_REFERENCE]) return;
		const tracked = new Set(Object.values(this.host.attachmentPaths));
		const candidates = new Map<string, TFile>();
		for (const reference of [...(cache.embeds ?? []), ...(cache.links ?? [])]) {
			const file = this.app.metadataCache.getFirstLinkpathDest(getLinkpath(reference.link), note.path);
			if (file && file.extension !== "md" && !tracked.has(file.path)) candidates.set(file.path, file);
		}
		if (candidates.size === 0) return;
		// One pass over the vault's links finds the candidates other notes use too.
		for (const [source, targets] of Object.entries(this.app.metadataCache.resolvedLinks)) {
			if (source === note.path) continue;
			for (const path of Object.keys(targets)) candidates.delete(path);
		}
		if (candidates.size === 0) return;
		const remote = new Set((await client.listAttachments(location)).map((attachment) => attachment.name));
		let adopted = false;
		for (const file of candidates.values()) {
			// Earlier downloads may have been renamed to avoid a clash ("img 1.png"): match the name before the number.
			const name = [...remote].find((n) => n === file.name || sanitizeAttachmentName(n) === file.name || numberedMatch(n, file.name));
			if (!name) continue;
			const key = this.attachmentKey(location, name);
			if (this.host.attachmentPaths[key]) continue;
			this.host.attachmentPaths[key] = file.path;
			adopted = true;
		}
		if (adopted) await this.save();
	}

	/**
	 * Where a pulled page belongs in the vault. A page with children (known from the pages of the current sync, or
	 * because its folder already exists in the vault) is written as the folder note of that folder.
	 */
	private async expectedPath(client: XWikiClient, location: PageLocation, remote: RemotePage, options: PullOptions, current?: TFile): Promise<string> {
		const titles = await this.pathTitles(client, location, remote, options.titleCache ?? new Map<string, string>());
		const chain = pageChain(location);
		const claims = options.claims ?? new Map<string, string>();
		const names: string[] = [];
		let parent = this.syncFolder;
		chain.forEach((name, k) => {
			const page = k === chain.length - 1 ? serializeReference(location) : serializeReference({ spaces: chain.slice(0, k + 1), page: "WebHome" });
			const claimed = this.claimName(parent, sanitizeFileName(titles[k]?.trim() || name), page, claims);
			names.push(claimed);
			parent = parent ? `${parent}/${claimed}` : claimed;
		});
		const leaf = normalizePath(vaultPathFor(location, this.syncFolder, names));
		const hasChildren =
			options.parents?.has(serializeReference(location)) ||
			this.app.vault.getFolderByPath(leaf.replace(/\.md$/, "")) !== null ||
			(current !== undefined && this.isFolderNote(current));
		return hasChildren ? normalizePath(vaultPathFor(location, this.syncFolder, names, this.host.settings)) : leaf;
	}

	/** Sync folder path, or "" for the vault root. */
	private get syncFolder(): string {
		const folder = this.host.settings.syncFolder.trim();
		return folder ? normalizePath(folder) : "";
	}

	private inSyncFolder(path: string): boolean {
		return !this.syncFolder || path.startsWith(`${this.syncFolder}/`);
	}

	/** Folder a note is the folder note of, in either layout, or `null`. */
	private folderOf(path: string): string | null {
		const inside = ownFolder(path, this.host.settings);
		if (inside) return inside;
		const next = path.replace(/\.md$/, "");
		return this.app.vault.getFolderByPath(next) ? next : null;
	}

	/** Whether a note is the folder note of a folder, in either layout. */
	private isFolderNote(file: TFile): boolean {
		return this.folderOf(file.path) !== null;
	}

	/**
	 * Keeps a pulled note where its page is in the XWiki tree: while the note is where the plugin placed it inside the
	 * sync folder, it is moved to the mirrored path (and renamed after the title). A pulled note the user moved is only
	 * renamed after the title, folder notes keep the name of their folder, and notes created in the vault are never
	 * moved or renamed.
	 */
	private async followLocation(file: TFile, client: XWikiClient, location: PageLocation, remote: RemotePage, options: PullOptions): Promise<void> {
		if (!this.app.metadataCache.getFileCache(file)?.frontmatter?.[FM_REFERENCE]) return;
		const placedAt = this.host.syncState[file.path]?.placedAt;
		const managed = this.inSyncFolder(file.path) && (placedAt === undefined || placedAt === file.path);
		let target: string;
		if (managed) {
			target = this.availablePath(await this.expectedPath(client, location, remote, options, file), file);
		} else {
			if (!remote.title || this.isFolderNote(file)) return;
			const folder = file.parent && !file.parent.isRoot() ? `${file.parent.path}/` : "";
			target = this.availablePath(normalizePath(`${folder}${sanitizeFileName(remote.title)}.md`), file);
		}
		if (target === file.path) return;
		// A folder note moves together with its folder, so the child pages stay below it.
		const oldFolder = managed ? this.folderOf(file.path) : null;
		if (oldFolder) {
			const newFolder = ownFolder(target, this.host.settings) ?? target.replace(/\.md$/, "");
			const folder = this.app.vault.getFolderByPath(oldFolder);
			if (folder && newFolder !== oldFolder && !this.app.vault.getAbstractFileByPath(newFolder)) {
				await this.move(folder, newFolder);
				// The folder move changed the note's path and may have brought a file to the target: look again.
				target = this.availablePath(target, file);
				if (target === file.path) return;
			}
		}
		const oldParent = file.parent;
		await this.move(file, target);
		// When the children were already placed in the new folder, the old folder is left empty.
		const leftFolder = oldFolder ? this.app.vault.getFolderByPath(oldFolder) : null;
		if (leftFolder && leftFolder.children.length === 0) await this.removeEmptyFolders(leftFolder);
		const record = this.host.syncState[file.path];
		if (record && managed) this.host.syncState[file.path] = { ...record, placedAt: file.path };
		// The old folder was created by the sync for this note; remove it when the move left it empty.
		if (managed) await this.removeEmptyFolders(oldParent);
	}

	/** Removes folders of the sync folder that a move left empty. */
	private async removeEmptyFolders(folder: TFolder | null): Promise<void> {
		while (folder && !folder.isRoot() && folder.path !== this.syncFolder && this.inSyncFolder(folder.path) && folder.children.length === 0) {
			const parent = folder.parent;
			await this.app.fileManager.trashFile(folder);
			folder = parent;
		}
	}

	/** Pulls one page into the vault, protecting local edits made since the last sync. */
	async pull(client: XWikiClient, location: PageLocation, options: PullOptions): Promise<PullResult> {
		const remote = options.remote !== undefined ? options.remote : await client.getPage(location);
		if (!remote) return { outcome: "missing", converted: false };

		const vault = this.app.vault;
		const reference = serializeReference(location);
		let existing = options.file ?? options.index.get(reference);
		let expected: string | undefined;
		if (!existing) {
			// A note that was never synced but sits where the page belongs, and maps to it, is that page's note.
			expected = await this.expectedPath(client, location, remote, options);
			const candidate = vault.getFileByPath(expected);
			if (candidate && serializeReference(this.locate(candidate)) === reference) existing = candidate;
		}
		// Cheap check first: converting a page costs an extra request.
		// Records from earlier versions do not know where the plugin placed the note: if it is where the page belongs,
		// it counts as placed; anywhere else the user put it there, and it stays.
		const legacy = existing ? this.host.syncState[existing.path] : undefined;
		if (existing && legacy && legacy.placedAt === undefined && this.app.metadataCache.getFileCache(existing)?.frontmatter?.[FM_REFERENCE]) {
			const expected = this.availablePath(await this.expectedPath(client, location, remote, options, existing), existing);
			legacy.placedAt = expected === existing.path ? existing.path : "";
		}
		const record = existing ? this.host.syncState[existing.path] : undefined;
		// Attachments that failed last time are tried again, even when the page did not change.
		const retry = record?.missingAttachments ?? [];
		if (existing && record?.version === remote.version && retry.length === 0) {
			await this.followLocation(existing, client, location, remote, options);
			await this.relocateAttachments(client, location, existing);
			return { outcome: "unchanged", converted: false };
		}

		const { source, converted } = await this.remoteMarkdown(client, location, remote);
		const result = (outcome: PullOutcome): PullResult => ({ outcome, converted });

		// A note without a record was written by a sync that was interrupted before it could save: take over the files
		// already downloaded for it, so they are linked as before instead of downloaded again as copies.
		if (existing && !record) await this.adoptLinkedAttachments(client, location, existing);
		const path = existing?.path ?? this.availablePath(expected ?? (await this.expectedPath(client, location, remote, options)));
		// Attachments already in the vault are linked right away; new ones once they are downloaded.
		const links = new Map<string, string>();
		for (const [name, file] of this.trackedAttachments(location)) links.set(name, this.app.metadataCache.fileToLinktext(file, path, true));
		const convert = () =>
			convertFromXWiki(source, this.resolver(client, location, path, options.index, links), {
				hardLineBreaks: hardLineBreaks(this.host.settings, this.app),
				comments: this.host.settings.obsidianComments,
			});
		const first = convert();

		if (existing) {
			const local = await vault.read(existing);
			if (stripFrontmatter(local).trim() === first.markdown.trim() && retry.length === 0) {
				await this.followLocation(existing, client, location, remote, options);
				await this.writeMetadata(existing, client, location, remote, false);
				await this.relocateAttachments(client, location, existing);
				await this.recordSync(existing, remote.version, location);
				return result("unchanged");
			}
			// Decide about conflicts before downloading anything, so the local note's files are never touched first.
			if (this.isLocallyChanged(existing, local)) {
				if (record?.version === remote.version) {
					// Only attachments are missing and the page did not change: fetch them, and leave the edited note alone.
					const { retry: still } = await this.downloadAttachments(client, location, new Set(retry), existing.path, new Map());
					record.missingAttachments = still.length > 0 ? still : undefined;
					await this.save();
					await this.followLocation(existing, client, location, remote, options);
					await this.relocateAttachments(client, location, existing);
					return result("unchanged");
				}
				const action = options.interactive
					? await choose(this.app, "Note changed locally", `"${existing.basename}" has local changes that are not on XWiki, and the XWiki page changed too.`, [
							{ label: "Keep both", value: "copy" as const, cta: true },
							{ label: "Overwrite local note", value: "overwrite" as const, warning: true },
						])
					: "copy";
				if (action === null) return result("cancelled");
				if (action === "copy") {
					const copyPath = existing.path.replace(/\.md$/, " (XWiki conflict).md");
					const copy = vault.getFileByPath(copyPath);
					if (copy) await vault.modify(copy, first.markdown);
					else await vault.create(copyPath, first.markdown);
					return result("conflict");
				}
			}
		}

		const { failed, retry: missing } = await this.downloadAttachments(client, location, first.attachments, path, links);
		if (failed.length > 0) new Notice(`Could not download from "${pageDisplayName(location)}": ${failed.join(", ")}`);
		const { markdown } = convert();

		let file: TFile;
		if (existing) {
			await vault.process(existing, (data) => this.replaceBody(data, markdown));
			file = existing;
			// Move first, so the metadata compares the title with the final file name.
			await this.followLocation(file, client, location, remote, options);
			await this.writeMetadata(file, client, location, remote, false);
		} else {
			await this.ensureFolder(path);
			file = await vault.create(path, markdown);
			options.index.set(serializeReference(location), file);
			await this.writeMetadata(file, client, location, remote, true);
		}
		await this.relocateAttachments(client, location, file);
		await this.recordSync(file, remote.version, location, !existing, missing);
		return result(existing ? "updated" : "created");
	}

	/** Lists pages at or below `root`: from the space listing first, then with a query as a fallback. */
	private async findPagesUnder(client: XWikiClient, root: string[], progress: (message: string) => void): Promise<PageLocation[]> {
		progress("Listing XWiki spaces…");
		const all = await client.listSpaces();
		const spaces = all.filter((space) => isUnder(space, root));
		console.debug("XWiki Publisher: space listing", { root, total: all.length, matching: spaces.length });

		const locations: PageLocation[] = [];
		for (const space of spaces) {
			for (const page of await client.listPages(space)) locations.push({ spaces: space, page });
		}
		if (locations.length > 0) return locations;

		progress("Space not in the listing, searching the XWiki index…");
		try {
			const found = (await client.queryPagesUnder(root)).filter((location) => isUnder(location.spaces, root));
			console.debug("XWiki Publisher: query fallback", { root, pages: found.length });
			return found;
		} catch (error) {
			console.warn("XWiki Publisher: query fallback failed", error);
			return [];
		}
	}

	/** Pulls every page at or below `root`, converting pages that are not written in Markdown. */
	async pullSpace(
		client: XWikiClient,
		root: string[],
		progress: (message: string) => void,
		isCancelled: () => boolean,
	): Promise<SpaceSyncResult> {
		return this.batch(() => this.pullSpaceBatched(client, root, progress, isCancelled));
	}

	private async pullSpaceBatched(
		client: XWikiClient,
		root: string[],
		progress: (message: string) => void,
		isCancelled: () => boolean,
	): Promise<SpaceSyncResult> {
		const counts: Record<PullOutcome, number> = {
			created: 0,
			updated: 0,
			unchanged: 0,
			conflict: 0,
			missing: 0,
			cancelled: 0,
		};
		const locations = await this.findPagesUnder(client, root, progress);
		if (locations.length === 0) throw new Error(`No page found at or below "${root.join(".")}" on XWiki, or no view right on it.`);
		console.debug("XWiki Publisher: pages to sync", { root, count: locations.length });

		const index = this.buildIndex();
		let converted = 0;
		const titleCache = new Map<string, string>();
		const claims = new Map<string, string>();
		// Every ancestor of a listed page has children; those pages become folder notes.
		const parents = new Set<string>();
		for (const location of locations) {
			const chain = pageChain(location);
			for (let k = 1; k < chain.length; k++) parents.add(serializeReference({ spaces: chain.slice(0, k), page: "WebHome" }));
		}
		const failures: string[] = [];
		let done = 0;
		for (const location of locations) {
			if (isCancelled()) {
				counts.cancelled = locations.length - done;
				break;
			}
			progress(`Syncing ${++done}/${locations.length}: ${pageDisplayName(location)}`);
			try {
				const result = await this.pull(client, location, { interactive: false, index, titleCache, parents, claims });
				counts[result.outcome]++;
				if (result.outcome === "missing") failures.push(`${serializeReference(location)} (no longer on XWiki)`);
				if (result.converted && (result.outcome === "created" || result.outcome === "updated")) converted++;
			} catch (error) {
				console.error(`XWiki Publisher: failed to pull ${serializeReference(location)}`, error);
				counts.missing++;
				failures.push(`${serializeReference(location)} (${error instanceof Error ? error.message : String(error)})`);
			}
			await this.checkpoint();
		}
		return { counts, converted, failures };
	}

	/** Keeps sync records and attachment paths attached to files and folders that are renamed or moved. */
	onRename(file: TAbstractFile, oldPath: string): void {
		const moved = (path: string): string | null => {
			if (path === oldPath) return file.path;
			if (file instanceof TFolder && path.startsWith(`${oldPath}/`)) return file.path + path.slice(oldPath.length);
			return null;
		};
		let changed = false;
		for (const path of Object.keys(this.host.syncState)) {
			const target = moved(path);
			if (target === null) continue;
			this.host.syncState[target] = this.host.syncState[path];
			delete this.host.syncState[path];
			changed = true;
		}
		for (const [key, path] of Object.entries(this.host.attachmentPaths)) {
			const target = moved(path);
			if (target === null) continue;
			this.host.attachmentPaths[key] = target;
			changed = true;
		}
		if (file instanceof TFile) changed = this.restoreDeleted(file.path) || changed;
		if (changed) void this.save();
	}

	/** A note back at the path of a deleted note, such as one restored from the trash, is that note again. */
	onCreate(file: TAbstractFile): void {
		if (file instanceof TFile && this.restoreDeleted(file.path)) void this.save();
	}

	private restoreDeleted(path: string): boolean {
		const record = this.host.deletedNotes[path];
		if (!record) return false;
		delete this.host.deletedNotes[path];
		this.host.syncState[path] ??= record;
		return true;
	}

	/**
	 * Forgets attachments of deleted files, including everything inside a deleted folder. The sync records of deleted
	 * notes are kept apart, so that the source control tab can offer to delete their pages.
	 */
	onDelete(file: TAbstractFile): void {
		const gone = (path: string) => path === file.path || path.startsWith(`${file.path}/`);
		let changed = false;
		for (const path of Object.keys(this.host.syncState)) {
			if (!gone(path)) continue;
			const record = this.host.syncState[path];
			if (record.reference) this.host.deletedNotes[path] = record;
			delete this.host.syncState[path];
			changed = true;
		}
		for (const [key, path] of Object.entries(this.host.attachmentPaths)) {
			if (!gone(path)) continue;
			delete this.host.attachmentPaths[key];
			delete this.host.attachmentVersions[key];
			delete this.host.uploadedAttachments[key];
			changed = true;
		}
		if (changed) void this.save();
	}
}

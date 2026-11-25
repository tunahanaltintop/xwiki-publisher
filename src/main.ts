import { Editor, MarkdownView, Menu, normalizePath, Notice, Plugin, TAbstractFile, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { convertNote, ResolvedLink, stripFrontmatter } from "./converter";
import {
	contentReference,
	folderPages,
	FM_URL,
	FolderNoteLocation,
	noteName,
	noteTitle,
	PageLocation,
	pageChain,
	pageDisplayName,
	parseSpaceInput,
	serializeReference,
} from "./location";
import { choose, chooseFolder, MentionInput, prompt, promptText } from "./modals";
import { DeletedNote, deletionBlocker, deletionOrder, noteBasename } from "./deletions";
import { FolderNotes } from "./folder-notes";
import { commentReferences, tidyCommentReferences } from "./comment-display";
import { CommentPopover, CommentPopoverHost, ResolvedCommentsModal } from "./comment-popover";
import { DiffHunk, lines, replaceLines, sameText } from "./diff";
import { DiffBlockAction, DiffModal, DiffSide } from "./diff-modal";
import { htmlToText } from "./html";
import { commentAt, commentsBelow, CommentThread, selectionOnPage } from "./inline-comments";
import { issueLink, issueMacro, issuesForEditing, keyPrefixes, WorkPackage } from "./issues";
import { WorkPackageModal, WorkPackageSuggest, WorkPackageSuggestHost } from "./issue-modal";
import { MentionHost, MentionModal, MentionSuggest } from "./mention-suggest";
import { anchorMentionLinks, mentionLink, mentionReferences, mentionsForEditing, MentionUser, newMentionMacro } from "./mentions";
import { describeLinks, failedReport, LinkReport, syncPageLinks, workPackagesIn } from "./openproject";
import { OpenProjectClient } from "./openproject-client";
import { DEFAULT_SETTINGS, hardLineBreaks, XWikiPublisherSettings, XWikiPublisherSettingTab } from "./settings";
import { AttachmentPaths, AttachmentVersions, IncomingState, pageBrokenMentions, PullOutcome, PullResult, SyncService, SyncState, UploadedAttachments } from "./sync";
import { VIEW_TYPE_XWIKI, XWikiPanelView } from "./view";
import { RemotePage, XWikiClient } from "./xwiki-client";

interface PluginData extends Partial<XWikiPublisherSettings> {
	syncState?: SyncState;
	deletedNotes?: SyncState;
	attachmentPaths?: AttachmentPaths;
	attachmentVersions?: AttachmentVersions;
	uploadedAttachments?: UploadedAttachments;
}

/** How publishing treats a page that changed on XWiki or is not Markdown: ask, leave it, or overwrite it. */
type OverwriteMode = "ask" | "skip" | "overwrite";

interface NotePublishResult {
	outcome: "created" | "updated" | "unchanged" | "skipped";
	/** Why the page was not overwritten, for `skipped`. */
	reason?: string;
	uploaded: number;
	/** Attachments that could not be uploaded. */
	failed: string[];
	/** What changed in OpenProject; `null` when the page has no work package links or OpenProject is not set up. */
	links: LinkReport | null;
}

/** A note with local changes to publish: never synced with XWiki (`added`), edited since its last sync (`modified`), or removed from the vault (`deleted`). */
export type NoteChange = { path: string; status: "added" | "modified"; file: TFile } | { path: string; status: "deleted"; file: null; note: DeletedNote };

/** A note that pulling would change: its page on XWiki is newer than the note, or gone. */
export interface IncomingChange {
	path: string;
	file: TFile;
	state: IncomingState;
	/** Version of the page at the last sync of the note. */
	version: string;
	/** Version of the page on XWiki now; missing when the page is gone. */
	remoteVersion?: string;
}

/** Result of the last check of the notes of the vault against their pages. */
export interface IncomingCheck {
	time: number;
	/** Notes compared with their page. */
	checked: number;
	/** Notes with a sync record, which a check compares. */
	total: number;
	changes: IncomingChange[];
	/** Notes that could not be compared, with the reason. */
	failures: string[];
	cancelled: boolean;
}

/** A note opened again within this time is not compared with its page again. */
const REFRESH_INTERVAL_MS = 2 * 60_000;

/** A note and its page, as compared: the page as a pull would write it into the note. `null` for a side that is missing. */
interface Comparison {
	remote: RemotePage | null;
	page: string | null;
	/** Attachments the page links to. */
	attachments: Set<string>;
	note: string | null;
}

/** The lines of the note and of the page that a block of a comparison covers. */
interface BlockRanges {
	note: [number, number];
	page: [number, number];
}

/** Pages read at the same time by a check: fast enough for large vaults, gentle enough for the server. */
const CHECK_CONCURRENCY = 4;

/** What deleting the page of a deleted note did. */
interface PageDeletionResult {
	outcome: "deleted" | "gone" | "skipped";
	/** Why the page was kept, for `skipped`. */
	reason?: string;
	links: LinkReport | null;
}

export interface ActivityEntry {
	time: number;
	message: string;
	error: boolean;
}

/** A pull after which the note is what its page is: nothing left to pull for it. */
function isSettled(outcome: PullOutcome): boolean {
	return outcome === "created" || outcome === "updated" || outcome === "unchanged";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Copies of a page that sync writes next to a note when both changed; they are never published. */
function isConflictCopy(file: TFile): boolean {
	return file.basename.endsWith(" (XWiki conflict)");
}

export default class XWikiPublisherPlugin extends Plugin implements MentionHost, CommentPopoverHost, WorkPackageSuggestHost {
	settings: XWikiPublisherSettings = { ...DEFAULT_SETTINGS };
	syncState: SyncState = {};
	deletedNotes: SyncState = {};
	attachmentPaths: AttachmentPaths = {};
	attachmentVersions: AttachmentVersions = {};
	uploadedAttachments: UploadedAttachments = {};
	private sync = new SyncService(this);
	readonly folderNotes = new FolderNotes(this);
	/** Recent results, newest first, shown in the side panel. */
	activity: ActivityEntry[] = [];
	/** Label of the operation in progress, if any. */
	busy: string | null = null;
	/** Whether the running operation can be stopped from the panel (space sync, folder publish). */
	cancellable = false;
	/** Part of the source control tab the running operation belongs to, where the panel shows its progress. */
	busySection: "incoming" | null = null;
	private cancelRequested = false;
	/** Notes behind their pages, from the last check against XWiki; `null` until the first check. */
	incoming: IncomingCheck | null = null;
	/** When each note was last compared with its page on opening, by path. */
	private readonly refreshedAt = new Map<string, number>();
	/** Page version the user was last told to pull, by note path: told once per version. */
	private readonly announced = new Map<string, string>();
	private listeners = new Set<() => void>();
	/** XWiki URL whose server was seen to support the configured Markdown syntax, so publishing need not ask again. */
	private syntaxCheckedFor: string | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new XWikiPublisherSettingTab(this.app, this));
		this.folderNotes.register();
		this.registerView(VIEW_TYPE_XWIKI, (leaf: WorkspaceLeaf) => new XWikiPanelView(leaf, this));

		this.addRibbonIcon("book-open", "Open XWiki panel", () => void this.activateView());
		this.addCommand({
			id: "open-panel",
			name: "Open panel",
			callback: () => void this.activateView(),
		});

		this.addCommand({
			id: "publish-current-note",
			name: "Publish current note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) void this.publish(file);
				return true;
			},
		});

		this.addCommand({
			id: "publish-folder",
			name: "Publish folder to XWiki",
			callback: () => void this.publishFolder(),
		});

		this.addCommand({
			id: "pull-current-note",
			name: "Pull current note from XWiki",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) void this.pullNote(file);
				return true;
			},
		});

		this.addCommand({
			id: "import-page",
			name: "Import page from XWiki",
			callback: () => void this.importPage(),
		});

		this.addCommand({
			id: "sync-space",
			name: "Sync space from XWiki",
			callback: () => void this.syncSpace(),
		});

		this.addCommand({
			id: "open-published-page",
			name: "Open published page in browser",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const url = file ? this.publishedUrl(file) : undefined;
				if (!url) return false;
				if (!checking) window.open(url);
				return true;
			},
		});

		this.addCommand({
			id: "comment-selection",
			name: "Comment on the selected text on XWiki",
			editorCheckCallback: (checking, editor, ctx) => {
				const file = ctx.file;
				if (!file || !this.syncState[file.path] || !editor.somethingSelected()) return false;
				if (!checking) void this.commentOnSelection(editor, file);
				return true;
			},
		});

		this.addCommand({
			id: "reply-to-comment",
			name: "Reply to the XWiki comment at the cursor",
			editorCheckCallback: (checking, editor, ctx) => {
				const file = ctx.file;
				const comment = file && this.syncState[file.path] ? this.commentAtCursor(editor) : null;
				if (!file || comment === null) return false;
				if (!checking) void this.replyToComment(editor, file, comment);
				return true;
			},
		});

		this.addCommand({
			id: "resolved-comments",
			name: "Show resolved XWiki comments of the note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md" || !this.syncState[file.path]) return false;
				if (!checking) void this.showResolvedComments(file);
				return true;
			},
		});

		this.addCommand({
			id: "mention-user",
			name: "Mention an XWiki user",
			editorCheckCallback: (checking, editor, ctx) => {
				const file = ctx.file;
				if (!file || !this.hasPage(file)) return false;
				if (!checking) this.mentionUser(editor, file);
				return true;
			},
		});
		this.registerEditorSuggest(new MentionSuggest(this));
		this.registerEditorSuggest(new WorkPackageSuggest(this));

		this.addCommand({
			id: "insert-work-package",
			name: "Insert OpenProject work package",
			editorCheckCallback: (checking, editor) => {
				if (!this.settings.openProjectUrl) return false;
				if (!checking) this.insertWorkPackage(editor);
				return true;
			},
		});

		// The references of inline comments are hidden where notes are shown; the 💬 icon stands for them.
		this.registerEditorExtension(commentReferences);
		this.registerMarkdownPostProcessor((el) => tidyCommentReferences(el));
		// Tables in Live Preview are rendered outside the editor's text, and not always through post processors.
		const pending = new Set<HTMLElement>();
		const observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				for (const node of Array.from(mutation.addedNodes)) {
					const text = node.textContent ?? "";
					if (!text.includes("💬") && !text.includes("✅")) continue;
					if (node.instanceOf(HTMLElement)) pending.add(node);
					else if (node.instanceOf(Text) && node.parentElement) pending.add(node.parentElement);
				}
			}
			if (pending.size === 0) return;
			window.requestAnimationFrame(() => {
				for (const el of pending) if (el.isConnected) tidyCommentReferences(el.closest(".cm-table-widget, .cm-embed-block, td, th") ?? el);
				pending.clear();
			});
		});
		this.app.workspace.onLayoutReady(() => observer.observe(this.app.workspace.containerEl, { childList: true, subtree: true }));
		this.register(() => observer.disconnect());

		// Selecting the icon of an inline comment shows the comment, wherever the note is shown.
		const popover = new CommentPopover(this);
		this.register(() => popover.close());
		// On the window and while capturing, so that the editor never sees a press on the icon.
		for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "dblclick"] as const) {
			this.registerDomEvent(window, type, (event) => popover.handle(event), { capture: true });
		}
		this.registerDomEvent(document, "keydown", (event) => {
			if (event.key === "Escape") popover.close();
		});
		this.registerDomEvent(window, "resize", () => popover.close());

		// Comments and mentions are written on notes that have a page: the ones published or pulled.
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, info) => {
				const file = info.file;
				// Work packages are published as issue macros, and link the page in OpenProject.
				if (file && this.settings.openProjectUrl) {
					menu.addItem((item) =>
						item
							.setTitle("Add OpenProject work package")
							.setIcon("square-check-big")
							.onClick(() => this.insertWorkPackage(editor)),
					);
				}
				if (!file || !this.syncState[file.path]) return;
				menu.addItem((item) =>
					item
						.setTitle("Mention XWiki user")
						.setIcon("at-sign")
						.onClick(() => this.mentionUser(editor, file)),
				);
				menu.addItem((item) =>
					item
						.setTitle("Resolved XWiki comments")
						.setIcon("check-check")
						.onClick(() => void this.showResolvedComments(file)),
				);
				if (editor.somethingSelected()) {
					menu.addItem((item) =>
						item
							.setTitle("Comment on XWiki")
							.setIcon("message-square-plus")
							.onClick(() => void this.commentOnSelection(editor, file)),
					);
				}
				const comment = this.commentAtCursor(editor);
				if (comment !== null) {
					menu.addItem((item) =>
						item
							.setTitle("Reply to XWiki comment")
							.setIcon("reply")
							.onClick(() => void this.replyToComment(editor, file, comment)),
					);
				}
			}),
		);

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
				if (file instanceof TFolder) {
					menu.addItem((item) =>
						item
							.setTitle("Publish folder to XWiki")
							.setIcon("upload-cloud")
							.onClick(() => void this.publishFolder(file)),
					);
					return;
				}
				if (!(file instanceof TFile) || file.extension !== "md") return;
				menu.addItem((item) =>
					item
						.setTitle("Publish to XWiki")
						.setIcon("upload-cloud")
						.onClick(() => void this.publish(file)),
				);
				menu.addItem((item) =>
					item
						.setTitle("Pull from XWiki")
						.setIcon("download-cloud")
						.onClick(() => void this.pullNote(file)),
				);
			}),
		);

		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				this.sync.onRename(file, oldPath);
				// The incoming notes follow their files; a moved folder moves the notes in it.
				for (const change of this.incoming?.changes ?? []) change.path = change.file.path;
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				this.sync.onDelete(file);
				if (this.incoming) this.incoming.changes = this.incoming.changes.filter((change) => this.app.vault.getFileByPath(change.file.path) === change.file);
			}),
		);
		this.registerEvent(this.app.vault.on("create", (file) => this.sync.onCreate(file)));
		this.app.workspace.onLayoutReady(() => {
			this.sync.reconcileRecords();
			const active = this.app.workspace.getActiveFile();
			if (active) void this.refreshOpened(active);
		});
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (file && this.app.workspace.layoutReady) void this.refreshOpened(file);
			}),
		);
	}

	/** Opens the side panel in the right sidebar, or reveals it when already open. */
	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_XWIKI)[0];
		if (!leaf) {
			const right = workspace.getRightLeaf(false);
			if (!right) return;
			await right.setViewState({ type: VIEW_TYPE_XWIKI, active: true });
			leaf = right;
		}
		await workspace.revealLeaf(leaf);
	}

	/** Subscribes to state changes (activity, busy flag, sync state); returns the unsubscribe function. */
	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private changed(): void {
		this.listeners.forEach((listener) => listener());
	}

	/** Shows a result to the user and keeps it in the panel's activity list. */
	report(message: string, error = false, timeout?: number): void {
		new Notice(message, timeout);
		this.log(message, error);
	}

	/** Adds a line to the panel's activity list without a notice, for details of an operation on many notes. */
	private log(message: string, error = false): void {
		this.activity.unshift({ time: Date.now(), message, error });
		this.activity.length = Math.min(this.activity.length, 100);
		this.changed();
	}

	/** Runs one XWiki operation at a time, so the panel can show progress and disable its buttons. */
	private async exclusive(label: string, task: () => Promise<void>, section: "incoming" | null = null): Promise<void> {
		if (this.busy) {
			new Notice(`XWiki Publisher is busy: ${this.busy}`);
			return;
		}
		this.busy = label;
		this.busySection = section;
		this.cancelRequested = false;
		this.changed();
		try {
			await task();
		} finally {
			this.busy = null;
			this.busySection = null;
			this.cancellable = false;
			this.changed();
		}
	}

	/** Updates the label of the running operation, e.g. with a progress counter. */
	private progress(message: string): void {
		if (!this.busy) return;
		this.busy = message;
		this.changed();
	}

	/** Asks the running space sync or folder publish to stop after the current page. */
	cancel(): void {
		if (!this.cancellable) return;
		this.cancelRequested = true;
		this.progress("Cancelling after the current page…");
	}

	locate(file: TFile): PageLocation {
		return this.sync.locate(file);
	}

	targetReference(file: TFile): string {
		return serializeReference(this.locate(file));
	}

	/** Local view of the sync state: never synced, in sync, or edited since the last publish/pull. */
	async localStatus(file: TFile): Promise<{ synced: boolean; version?: string; localChanges: boolean }> {
		const record = this.syncState[file.path];
		if (!record) return { synced: false, localChanges: false };
		const changed = this.sync.hasBrokenMentions(file) || this.sync.isLocallyChanged(file, await this.app.vault.cachedRead(file));
		return { synced: true, version: record.version, localChanges: changed };
	}

	/**
	 * Notes that publishing would change on XWiki: never synced, edited since their last sync, or deleted from the vault.
	 * Only notes with a sync record are read, to compare them with their fingerprint. Ordered by path.
	 */
	async localChanges(): Promise<NoteChange[]> {
		this.sync.reconcileRecords();
		const changes: NoteChange[] = [];
		const notes = this.publishableNotes();
		for (const file of notes) {
			if (!this.syncState[file.path]) changes.push({ path: file.path, file, status: "added" });
			// A page whose mentions XWiki's editor broke is repaired by publishing its note.
			else if (this.sync.hasBrokenMentions(file) || this.sync.isLocallyChanged(file, await this.app.vault.cachedRead(file))) {
				changes.push({ path: file.path, file, status: "modified" });
			}
		}
		for (const note of this.sync.pendingDeletions(notes)) changes.push({ path: note.path, file: null, status: "deleted", note });
		return changes.sort((a, b) => a.path.localeCompare(b.path));
	}

	private publishableNotes(): TFile[] {
		return this.app.vault.getMarkdownFiles().filter((file) => !isConflictCopy(file));
	}

	/** Leaves the page of a deleted note on XWiki and stops listing the note. */
	keepDeletedPage(note: DeletedNote): Promise<void> {
		return this.sync.forgetDeleted(note.reference);
	}

	/** Compares the note's last synced version with the page on XWiki. */
	async checkRemote(file: TFile): Promise<string> {
		const client = this.createClient();
		const remote = await client.getPage(this.locate(file));
		if (!remote) return "Page does not exist on XWiki yet.";
		const synced = this.sync.lastSyncedVersion(file);
		if (!synced) return `Page exists on XWiki (version ${remote.version}); this note was never synced with it.`;
		return remote.version === synced
			? `XWiki page is unchanged since the last sync (version ${remote.version}).`
			: `XWiki page changed: version ${synced} → ${remote.version}. Pull to get the changes.`;
	}

	/**
	 * Sets or removes (empty value) a frontmatter property of a note, and waits until Obsidian has indexed the change,
	 * so an action started right after it sees the new value.
	 */
	async setNoteProperty(file: TFile, key: string, value: string): Promise<void> {
		const indexed = new Promise<void>((resolve) => {
			const ref = this.app.metadataCache.on("changed", (changed) => {
				if (changed.path !== file.path) return;
				this.app.metadataCache.offref(ref);
				window.clearTimeout(timer);
				resolve();
			});
			const timer = window.setTimeout(() => {
				this.app.metadataCache.offref(ref);
				resolve();
			}, 2000);
		});
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			if (value.trim()) fm[key] = value.trim();
			else delete fm[key];
		});
		await indexed;
	}

	/** Layout settings of the Folder notes plugin, read from its data file; `null` when it is not installed. */
	private async readFolderNotesSettings(): Promise<{ location: FolderNoteLocation | null; name: string; type: string } | null> {
		const path = normalizePath(`${this.app.vault.configDir}/plugins/folder-notes/data.json`);
		try {
			if (!(await this.app.vault.adapter.exists(path))) return null;
			const data = JSON.parse(await this.app.vault.adapter.read(path)) as Record<string, unknown>;
			const storage = data.storageLocation;
			return {
				location: storage === "insideFolder" ? "inside" : storage === "parentFolder" ? "parent" : null,
				name: typeof data.folderNoteName === "string" && data.folderNoteName.trim() ? data.folderNoteName : "{{folder_name}}",
				type: typeof data.folderNoteType === "string" ? data.folderNoteType : ".md",
			};
		} catch (error) {
			console.debug("XWiki Publisher: could not read the Folder notes settings", error);
			return null;
		}
	}

	/** Copies the Folder notes layout into the plugin settings; returns a message for the user. */
	async adoptFolderNotesSettings(): Promise<string> {
		const folderNotes = await this.readFolderNotesSettings();
		if (!folderNotes) return "The Folder notes plugin is not installed in this vault.";
		if (!folderNotes.location) return "The Folder notes storage location is not supported; use inside or next to the folder.";
		this.settings.folderNoteLocation = folderNotes.location;
		this.settings.folderNoteName = folderNotes.name;
		await this.saveSettings();
		const typeNote = folderNotes.type === ".md" ? "" : " Folder notes creates other file types by default; pulled folder notes are always Markdown.";
		return `Folder note settings copied. Notes pulled from XWiki move to the new layout on the next sync.${typeNote}`;
	}

	/** Whether the Folder notes community plugin is enabled in this vault (its features overlap with ours). */
	isFolderNotesPluginEnabled(): boolean {
		// The list of enabled plugins is not part of the public API; this is only used to show a warning.
		const plugins = (this.app as unknown as { plugins?: { enabledPlugins?: Set<string> } }).plugins;
		return plugins?.enabledPlugins?.has("folder-notes") ?? false;
	}

	/** Describes how the plugin's folder note settings differ from the Folder notes plugin, if they do. */
	async folderNotesMismatch(): Promise<string | null> {
		const folderNotes = await this.readFolderNotesSettings();
		if (!folderNotes?.location) return null;
		if (folderNotes.location === this.settings.folderNoteLocation && folderNotes.name === this.settings.folderNoteName) return null;
		return "These settings differ from the Folder notes plugin in this vault.";
	}

	async loadSettings(): Promise<void> {
		const { syncState, deletedNotes, attachmentPaths, attachmentVersions, uploadedAttachments, ...settings } = ((await this.loadData()) as PluginData | null) ?? {};
		this.settings = { ...DEFAULT_SETTINGS, ...settings };
		// Removed options: pages are always written in Markdown, and XWiki syntax pages are converted from their view.
		delete (this.settings as Partial<Record<"contentMode" | "xwikiConversion", unknown>>).contentMode;
		delete (this.settings as Partial<Record<"contentMode" | "xwikiConversion", unknown>>).xwikiConversion;
		this.syncState = syncState ?? {};
		this.deletedNotes = deletedNotes ?? {};
		this.attachmentPaths = attachmentPaths ?? {};
		this.attachmentVersions = attachmentVersions ?? {};
		this.uploadedAttachments = uploadedAttachments ?? {};
	}

	async saveSettings(): Promise<void> {
		await this.saveData({
			...this.settings,
			syncState: this.syncState,
			deletedNotes: this.deletedNotes,
			attachmentPaths: this.attachmentPaths,
			attachmentVersions: this.attachmentVersions,
			uploadedAttachments: this.uploadedAttachments,
		});
		this.changed();
	}

	createClient(): XWikiClient {
		if (!this.settings.baseUrl) throw new Error("Set the XWiki URL in the plugin settings.");
		if (!/^https?:\/\//i.test(this.settings.baseUrl)) throw new Error("The XWiki URL must start with https://.");
		const token = this.settings.tokenSecretId ? this.app.secretStorage.getSecret(this.settings.tokenSecretId) : null;
		if (!token) throw new Error("Select an XWiki token in the plugin settings.");
		return new XWikiClient({
			baseUrl: this.settings.baseUrl,
			wiki: this.settings.wiki,
			token,
			authScheme: this.settings.authScheme,
			username: this.settings.username,
			headerName: this.settings.headerName,
		});
	}

	createOpenProjectClient(): OpenProjectClient {
		const baseUrl = this.settings.openProjectUrl;
		if (!baseUrl) throw new Error("Set the OpenProject URL in the plugin settings.");
		if (!/^https?:\/\//i.test(baseUrl)) throw new Error("The OpenProject URL must start with https://.");
		const token = this.settings.openProjectTokenSecretId ? this.app.secretStorage.getSecret(this.settings.openProjectTokenSecretId) : null;
		if (!token) throw new Error("Select an OpenProject token in the plugin settings.");
		return new OpenProjectClient({ baseUrl, token });
	}

	/** Checks the OpenProject token and whether pages of the configured XWiki can be linked; returns a message for the user. */
	async testOpenProject(): Promise<string> {
		const openProject = this.createOpenProjectClient();
		let message = `Connected to OpenProject as ${await openProject.testConnection()}.`;
		if (/^http:\/\//i.test(this.settings.openProjectUrl)) message += " Warning: the URL uses plain HTTP, so the token is sent unencrypted. Use HTTPS.";
		try {
			await openProject.checkWikiProvider(await this.createClient().getOpenProjectInstanceId());
			return `${message} XWiki is one of its wiki providers, so published pages can be linked.`;
		} catch (error) {
			return `${message} Published pages cannot be linked yet: ${errorMessage(error)}`;
		}
	}

	/**
	 * Makes the work packages linked from a page follow its links, comparing them with the links of the page before
	 * this publish. The page is already saved, so a failure here is reported and does not fail the publish.
	 */
	private async syncWorkPackageLinks(client: XWikiClient, location: PageLocation, previousPage: string, page: string, status: (message: string) => void): Promise<LinkReport | null> {
		const baseUrl = this.settings.openProjectUrl;
		if (!baseUrl) return null;
		const previous = workPackagesIn(previousPage, baseUrl);
		const current = workPackagesIn(page, baseUrl);
		if (previous.length === 0 && current.length === 0) return null;
		status("Updating OpenProject links…");
		try {
			const openProject = this.createOpenProjectClient();
			const provider = await client.getOpenProjectInstanceId();
			const identifier = await client.getOpenProjectPageId(location);
			return await syncPageLinks(openProject, { provider, identifier }, previous, current);
		} catch (error) {
			console.error("XWiki Publisher: could not update the OpenProject links", error);
			return failedReport(previous, current, errorMessage(error));
		}
	}

	/** Creates the client, or shows why it cannot be created. */
	private clientOrNotice(): XWikiClient | null {
		try {
			return this.createClient();
		} catch (error) {
			this.report(errorMessage(error), true);
			return null;
		}
	}

	private publishedUrl(file: TFile): string | undefined {
		const url: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.[FM_URL];
		return typeof url === "string" && url ? url : undefined;
	}

	/** Refuses to write a page in a syntax the server cannot parse, which would leave the page broken. */
	private async ensureSyntaxAvailable(client: XWikiClient, syntax: string): Promise<void> {
		const key = `${this.settings.baseUrl}|${syntax}`;
		if (this.syntaxCheckedFor === key) return;
		let available: string[];
		try {
			available = await client.getSyntaxes();
		} catch (error) {
			console.warn("XWiki Publisher: could not list server syntaxes, publishing anyway", error);
			return;
		}
		if (available.includes(syntax)) this.syntaxCheckedFor = key;
		if (available.length === 0 || available.includes(syntax)) return;
		const markdown = available.filter((s) => s.startsWith("markdown"));
		throw new Error(
			`XWiki cannot parse "${syntax}". ` +
				(markdown.length > 0
					? `Available Markdown syntaxes: ${markdown.join(", ")}.`
					: "No Markdown syntax is installed; ask an XWiki admin to install the Markdown Syntax extension."),
		);
	}

	/**
	 * Decides whether to publish over an existing page that is not written in Markdown (its syntax would change and
	 * XWiki-only content such as macros would be lost), or that was edited on XWiki since the note was last synced.
	 * `ask` asks the user; `skip` and `overwrite` decide without asking, for folder publishing.
	 * Returns why the page must not be overwritten, or `null` when it may be.
	 */
	private async overwriteBlocker(file: TFile, location: PageLocation, remote: RemotePage | null, mode: OverwriteMode): Promise<string | null> {
		if (!remote || mode === "overwrite") return null;
		if (!/^markdown\//i.test(remote.syntax)) {
			if (mode === "skip") return `written in ${remote.syntax}`;
			const convert = await choose(
				this.app,
				"XWiki page is not Markdown",
				`"${pageDisplayName(location)}" is written in ${remote.syntax} on XWiki. Publishing replaces it with Markdown (${this.settings.syntax}): ${
					this.settings.preserveMacros
						? "macros written in the note are kept, XWiki formatting without a Markdown equivalent is lost."
						: "macros and XWiki-specific formatting on the page will be lost."
				}`,
				[
					{ label: "Convert and publish", value: true, warning: true },
					{ label: "Cancel", value: false },
				],
			);
			if (convert !== true) return "cancelled";
		}
		const synced = this.sync.lastSyncedVersion(file);
		if (!synced || remote.version === synced) return null;
		if (mode === "skip") return "changed on XWiki";
		const answer = await choose(
			this.app,
			"XWiki page changed",
			`"${pageDisplayName(location)}" was changed on XWiki (version ${synced} → ${remote.version}) since this note was last synced. Publishing will overwrite those changes.`,
			[
				{ label: "Publish anyway", value: true, warning: true },
				{ label: "Cancel", value: false },
			],
		);
		return answer === true ? null : "cancelled";
	}

	/**
	 * Creates missing pages for the note's folders; existing pages are never touched.
	 * `known` holds references of pages known to exist, so a folder publish checks each folder only once.
	 */
	private async ensureFolderPages(client: XWikiClient, file: TFile, known?: Set<string>): Promise<void> {
		if (!this.settings.createFolderPages) return;
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		for (const { location, title } of folderPages(file.path, fm, this.settings, this.sync.folderAnchor)) {
			const reference = serializeReference(location);
			if (known?.has(reference)) continue;
			if (!(await client.getPage(location))) await client.putPage(location, { title, content: "", syntax: "xwiki/2.1" });
			known?.add(reference);
		}
	}

	publish(file: TFile): Promise<void> {
		return this.exclusive(`publishing "${file.basename}"`, () => this.doPublish(file));
	}

	private async doPublish(file: TFile): Promise<void> {
		const client = this.clientOrNotice();
		if (!client) return;

		const notice = new Notice(`Publishing "${file.basename}" to XWiki…`, 0);
		try {
			await this.ensureSyntaxAvailable(client, this.settings.syntax);
			const result = await this.publishNote(client, file, { mode: "ask", status: (message) => notice.setMessage(message) });
			notice.hide();
			if (result.outcome === "skipped") return;
			let message = `${result.outcome === "created" ? "Created" : "Updated"} XWiki page "${file.basename}".`;
			if (result.uploaded > 0) message += ` ${result.uploaded} attachment(s) uploaded.`;
			if (result.failed.length > 0) message += ` Failed to upload: ${result.failed.join(", ")}.`;
			this.report(message, result.failed.length > 0);
			if (result.links) this.report(describeLinks(file.basename, result.links), result.links.failed.length > 0, 10000);
		} catch (error) {
			notice.hide();
			console.error("XWiki Publisher: publish failed", error);
			this.report(`Publishing to XWiki failed: ${errorMessage(error)}`, true);
		}
	}

	/**
	 * Publishes one note: creates or updates its page, uploads its attachments and records the sync.
	 * With `skipUnchanged`, a note that is in sync with its page is left alone.
	 */
	private async publishNote(
		client: XWikiClient,
		file: TFile,
		options: {
			mode: OverwriteMode;
			status: (message: string) => void;
			skipUnchanged?: boolean;
			knownPages?: Set<string>;
			/** Text to publish instead of the note: the page with one block of the note's changes. */
			body?: string;
			/** The page must be at this version, the one `body` was made from; a newer one is not overwritten. */
			expectedVersion?: string;
			/** Record the note as in sync with the page (the default); not when the note and the page still differ in ways the record cannot tell. */
			record?: boolean;
		},
	): Promise<NotePublishResult> {
		const location = this.sync.locate(file);
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const content = options.body ?? (await this.app.vault.cachedRead(file));

		const resolve = (linkpath: string): ResolvedLink | null => {
			const target = this.app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
			if (!target) return null;
			if (target.extension === "md") {
				const page = this.sync.locate(target);
				const headings = this.app.metadataCache.getFileCache(target)?.headings?.map((heading) => heading.heading) ?? [];
				return { kind: "page", url: client.viewUrl(page), reference: contentReference(page), headings };
			}
			// Files downloaded from this page keep their XWiki name, even when the vault file was renamed to avoid a clash.
			const name = this.sync.attachmentNameFor(location, target.path) ?? target.name;
			return { kind: "attachment", vaultPath: target.path, name, url: client.attachmentUrl(location, name) };
		};

		const { markdown, attachments } = convertNote(content, resolve, {
			hardLineBreaks: hardLineBreaks(this.settings, this.app),
			comments: this.settings.obsidianComments,
			xwikiReferences: true,
			mentions: { baseUrl: this.settings.baseUrl },
			openProjectUrl: this.settings.openProjectUrl,
		});

		const remote = await client.getPage(location);
		if (options.expectedVersion !== undefined) {
			if (!remote || remote.version !== options.expectedVersion) throw new Error("The page changed on XWiki since the comparison was opened. It was compared again: check the change and try once more.");
			if (!/^markdown\//i.test(remote.syntax)) throw new Error(`The page is written in ${remote.syntax}. Publish the whole note to turn it into Markdown first.`);
		}
		// A page whose mentions XWiki's editor broke is published although the note did not change: that repairs them.
		const unchanged = remote && remote.version === this.sync.lastSyncedVersion(file) && !this.sync.isLocallyChanged(file, content) && !this.sync.hasBrokenMentions(file);
		if (options.skipUnchanged && remote && unchanged) {
			options.knownPages?.add(serializeReference(location));
			// The page stays as it is, but its work packages may not be linked yet: OpenProject may have been set up since.
			return { outcome: "unchanged", uploaded: 0, failed: [], links: await this.syncWorkPackageLinks(client, location, remote.content, markdown, options.status) };
		}
		// A block is published over the version it was compared with, which is checked above.
		const blocker = options.expectedVersion !== undefined ? null : await this.overwriteBlocker(file, location, remote, options.mode);
		if (blocker) return { outcome: "skipped", reason: blocker, uploaded: 0, failed: [], links: null };

		await this.ensureFolderPages(client, file, options.knownPages);
		const created = await client.putPage(location, {
			title: noteTitle(noteName(file.path, file.basename, this.settings), fm),
			content: markdown,
			syntax: this.settings.syntax,
		});
		options.knownPages?.add(serializeReference(location));

		let uploaded = 0;
		const failed: string[] = [];
		if (this.settings.uploadAttachments) {
			for (const [name, vaultPath] of attachments) {
				const attachment = this.app.vault.getFileByPath(vaultPath);
				if (!attachment) continue;
				options.status(`Uploading ${name}…`);
				try {
					await client.putAttachment(location, name, await this.app.vault.readBinary(attachment));
					this.sync.trackUpload(location, name, vaultPath);
					uploaded++;
				} catch (error) {
					console.error(`XWiki Publisher: failed to upload ${name}`, error);
					failed.push(name);
				}
			}
		}

		const url = client.viewUrl(location);
		if (this.settings.writeUrlToFrontmatter) {
			await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
				frontmatter[FM_URL] = url;
			});
		}
		// Mentions written in the note keep the anchors this publish gave them: published again, they are the same.
		let published = options.body;
		if (published === undefined) {
			const sent = anchorMentionLinks(stripFrontmatter(content), this.settings.baseUrl, markdown);
			if (sent !== stripFrontmatter(content)) {
				published = sent;
				await this.changeNote(file, (whole) => {
					const body = stripFrontmatter(whole);
					const next = anchorMentionLinks(body, this.settings.baseUrl, markdown);
					return next === body ? whole : whole.slice(0, whole.length - body.length) + next;
				});
			}
		}
		// Attachment uploads create page versions too, so read the version once everything is saved.
		const saved = await client.getPage(location);
		if (options.record !== false) {
			if (saved) await this.sync.recordSync(file, saved.version, location, { content: saved.content, syntax: saved.syntax, body: published });
			// The page is now what the note is: nothing to pull for it anymore.
			this.settleIncoming(file);
		}
		const links = await this.syncWorkPackageLinks(client, location, remote?.content ?? "", markdown, options.status);
		return { outcome: created ? "created" : "updated", uploaded, failed, links };
	}

	/**
	 * Notes published by a folder publish: every Markdown note in the folder and its subfolders, plus the folder's
	 * own folder note when it is stored next to the folder. Conflict copies written by sync are left out.
	 * Notes are ordered from the outermost page inwards, so folder notes are published before the pages below them.
	 */
	private notesToPublish(folder: TFolder): TFile[] {
		const files: TFile[] = [];
		const collect = (item: TAbstractFile) => {
			if (item instanceof TFolder) item.children.forEach(collect);
			else if (item instanceof TFile && item.extension === "md") files.push(item);
		};
		collect(folder);
		const own = folder.isRoot() ? null : this.folderNotes.noteOf(folder.path);
		if (own && !files.includes(own)) files.push(own);
		return this.publishOrder(files);
	}

	/** Orders notes from the outermost page inwards, so folder notes are published before the pages below them. */
	private publishOrder(files: TFile[]): TFile[] {
		const depth = new Map(files.filter((file) => !isConflictCopy(file)).map((file) => [file, pageChain(this.locate(file)).length]));
		return [...depth.keys()].sort((a, b) => (depth.get(a) ?? 0) - (depth.get(b) ?? 0) || a.path.localeCompare(b.path));
	}

	/** Publishes a vault folder with its subfolders and notes; asks for the folder when it is not given. */
	async publishFolder(folder?: TFolder | string): Promise<void> {
		if (typeof folder === "string") {
			const path = normalizePath(folder.trim());
			const found = path === "/" ? this.app.vault.getRoot() : this.app.vault.getFolderByPath(path);
			if (!found) {
				this.report(`"${folder.trim()}" is not a folder of this vault.`, true);
				return;
			}
			folder = found;
		}
		folder ??= (await chooseFolder(this.app, "Folder to publish to XWiki")) ?? undefined;
		if (!folder) return;
		const name = folder.isRoot() ? "the vault" : folder.path;
		const files = this.notesToPublish(folder);
		if (files.length === 0) {
			this.report(`There are no notes in "${name}" to publish.`, true);
			return;
		}
		await this.publishMany(files, `"${name}"`, "Publish folder to XWiki", `Publish ${files.length} note(s) from "${name}" and its subfolders to XWiki?`);
	}

	/**
	 * Publishes the changes selected in the panel's source control tab, with the same rules as a folder publish.
	 * The pages of deleted notes among them are deleted.
	 */
	async publishNotes(changes: NoteChange[]): Promise<void> {
		const ordered = this.publishOrder(changes.flatMap((change) => (change.file ? [change.file] : [])));
		const deleted = deletionOrder(changes.flatMap((change) => (change.status === "deleted" ? [change.note] : [])));
		const total = ordered.length + deleted.length;
		if (total === 0) return;
		const label = total === 1 ? `"${ordered[0]?.basename ?? noteBasename(deleted[0].path)}"` : `${total} selected notes`;
		await this.publishMany(ordered, label, "Publish to XWiki", `Publish ${label} to XWiki?`, deleted);
	}

	/**
	 * Asks how to treat pages changed on XWiki, then publishes `files` in order and deletes the pages of `deleted`;
	 * `label` names them in messages.
	 */
	private async publishMany(files: TFile[], label: string, title: string, question: string, deleted: DeletedNote[] = []): Promise<void> {
		if (this.busy) {
			new Notice(`XWiki Publisher is busy: ${this.busy}`);
			return;
		}
		const deleting = deleted.length > 0;
		const pages = deleted.slice(0, 10).map((note) => note.reference);
		if (deleted.length > pages.length) pages.push(`and ${deleted.length - pages.length} more`);
		const mode = await choose<OverwriteMode | null>(
			this.app,
			title,
			`${question} ` +
				(deleting ? `Their notes were deleted, so ${deleted.length} page(s) will be deleted from XWiki with their attachments: ${pages.join(", ")}. Pages below them stay. ` : "") +
				"Notes already in sync with their page are skipped. " +
				"Pages changed on XWiki since the last sync, or not written in Markdown, are skipped too, unless you choose to overwrite them.",
			[
				{ label: deleting ? "Publish and delete" : "Publish", value: "skip", cta: !deleting, warning: deleting },
				{ label: deleting ? "Overwrite and delete" : "Publish and overwrite", value: "overwrite", warning: true },
				{ label: "Cancel", value: null },
			],
		);
		if (!mode) return;
		await this.exclusive(`publishing ${label}`, () => this.doPublishMany(label, files, mode, deleted));
	}

	/**
	 * Deletes the page of a deleted note. The links go first, while OpenProject can still read the page: if the page
	 * cannot be deleted, publishing a note to it links it again, while links left behind a deleted page have no way back.
	 */
	private async deleteNotePage(client: XWikiClient, note: DeletedNote, mode: OverwriteMode, status: (message: string) => void): Promise<PageDeletionResult> {
		const remote = await client.getPage(note.location);
		if (!remote) {
			await this.sync.forgetDeleted(note.reference);
			return { outcome: "gone", links: null };
		}
		const reason = mode === "overwrite" ? null : deletionBlocker(remote, note.version);
		if (reason) return { outcome: "skipped", reason, links: null };
		const links = await this.syncWorkPackageLinks(client, note.location, remote.content, "", status);
		await client.deletePage(note.location);
		await this.sync.forgetDeleted(note.reference);
		return { outcome: "deleted", links };
	}

	private async doPublishMany(label: string, files: TFile[], mode: OverwriteMode, deleted: DeletedNote[] = []): Promise<void> {
		const client = this.clientOrNotice();
		if (!client) return;
		const notice = new Notice(`Publishing ${label} to XWiki…`, 0);
		const counts = { created: 0, updated: 0, unchanged: 0, deleted: 0, gone: 0, skipped: 0, failed: 0, cancelled: 0 };
		const skipped: string[] = [];
		// Notes that failed, grouped by error message: a missing right or a bad token fails every note the same way.
		const failures = new Map<string, string[]>();
		const attachmentFailures: string[] = [];
		const linkCounts = { linked: 0, existing: 0, removed: 0, failed: 0 };
		const status = (message: string) => {
			notice.setMessage(message);
			this.progress(message);
		};
		const countLinks = (name: string, links: LinkReport | null) => {
			if (!links) return;
			linkCounts.linked += links.linked.length;
			linkCounts.existing += links.existing.length;
			linkCounts.removed += links.removed.length;
			linkCounts.failed += links.failed.length;
			this.log(describeLinks(name, links), links.failed.length > 0);
		};
		const countFailure = (name: string, error: unknown) => {
			counts.failed++;
			const message = errorMessage(error);
			failures.set(message, [...(failures.get(message) ?? []), name]);
		};
		try {
			this.cancellable = true;
			await this.ensureSyntaxAvailable(client, this.settings.syntax);
			const knownPages = new Set<string>();
			await this.sync.batch(async () => {
				for (const [i, file] of files.entries()) {
					if (this.cancelRequested) {
						counts.cancelled = files.length - i;
						break;
					}
					status(`Publishing ${i + 1}/${files.length}: ${file.basename}`);
					try {
						const result = await this.publishNote(client, file, { mode, status, skipUnchanged: true, knownPages });
						counts[result.outcome]++;
						if (result.reason) skipped.push(`${file.basename} (${result.reason})`);
						attachmentFailures.push(...result.failed.map((attachment) => `${file.basename}/${attachment}`));
						countLinks(file.basename, result.links);
					} catch (error) {
						console.error(`XWiki Publisher: failed to publish ${file.path}`, error);
						countFailure(file.basename, error);
					}
					await this.sync.checkpoint();
				}
				// Checked after publishing: a note published just now may have taken over the page.
				const pending = new Set(deleted.length > 0 ? this.sync.pendingDeletions(this.publishableNotes()).map((note) => note.reference) : []);
				for (const [i, note] of deleted.entries()) {
					if (this.cancelRequested) {
						counts.cancelled += deleted.length - i;
						break;
					}
					const name = noteBasename(note.path);
					if (!pending.has(note.reference)) {
						counts.skipped++;
						skipped.push(`${name} (page used by another note)`);
						continue;
					}
					status(`Deleting ${i + 1}/${deleted.length}: ${name}`);
					try {
						const result = await this.deleteNotePage(client, note, mode, status);
						counts[result.outcome]++;
						if (result.reason) skipped.push(`${name} (${result.reason})`);
						if (result.outcome === "deleted") this.log(`Deleted XWiki page ${note.reference}.`);
						countLinks(name, result.links);
					} catch (error) {
						console.error(`XWiki Publisher: failed to delete ${note.reference}`, error);
						countFailure(name, error);
					}
				}
			});
			notice.hide();
			const parts = [
				`${counts.created} created`,
				`${counts.updated} updated`,
				`${counts.unchanged} unchanged`,
				counts.deleted > 0 ? `${counts.deleted} deleted` : "",
				counts.gone > 0 ? `${counts.gone} already gone from XWiki` : "",
				counts.skipped > 0 ? `${counts.skipped} skipped: ${skipped.join(", ")}` : "",
				counts.failed > 0
					? `${counts.failed} failed: ${[...failures].map(([message, names]) => `${names.join(", ")}: ${message}`).join("; ")}`
					: "",
				attachmentFailures.length > 0 ? `attachments not uploaded: ${attachmentFailures.join(", ")}` : "",
				linkCounts.linked + linkCounts.existing + linkCounts.removed + linkCounts.failed > 0
					? `OpenProject links: ${linkCounts.linked} added, ${linkCounts.existing} already linked, ${linkCounts.removed} removed, ${linkCounts.failed} failed`
					: "",
				counts.cancelled > 0 ? `${counts.cancelled} not processed (cancelled)` : "",
			].filter(Boolean);
			this.report(
				`XWiki publish of ${label} finished: ${parts.join("; ")}.`,
				counts.skipped > 0 || counts.failed > 0 || attachmentFailures.length > 0 || linkCounts.failed > 0,
				10000,
			);
		} catch (error) {
			notice.hide();
			console.error("XWiki Publisher: folder publish failed", error);
			this.report(`Publishing to XWiki failed: ${errorMessage(error)}`, true);
		}
	}

	private describeOutcome({ outcome, converted }: PullResult, name: string): string {
		const note = converted && (outcome === "created" || outcome === "updated") ? " (converted from XWiki syntax to Markdown)" : "";
		switch (outcome) {
			case "created":
				return `Imported "${name}" from XWiki${note}.`;
			case "updated":
				return `Updated "${name}" from XWiki${note}.`;
			case "unchanged":
				return `"${name}" is already up to date.`;
			case "conflict":
				return `"${name}" changed on both sides; the XWiki version was saved as "${name} (XWiki conflict)".`;
			case "missing":
				return `"${name}" does not exist on XWiki.`;
			case "cancelled":
				return "Pull cancelled.";
		}
	}

	/** The note shown where `target` is, with its text, when it may have inline comments. */
	async noteAt(target: Node): Promise<{ path: string; text: string } | null> {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || !view.file || !view.containerEl.contains(target)) continue;
			const text = view.getMode() === "source" ? view.editor.getValue() : await this.app.vault.cachedRead(view.file);
			return text.includes("[^xwiki-") ? { path: view.file.path, text } : null;
		}
		return null;
	}

	/** Resolves an inline comment of a note, on wikis with comment resolution. */
	resolve(path: string, comment: number, resolved = true): (() => void) | null {
		const file = this.app.vault.getFileByPath(path);
		return file && this.syncState[path] ? () => void this.setResolved(file, comment, resolved) : null;
	}

	/**
	 * Resolves or reopens an inline comment through the wiki's comment resolution service, then shows the comments of
	 * the page in the note again: a resolved comment leaves the note, a reopened one comes back. Returns whether it did.
	 */
	async setResolved(file: TFile, comment: number, resolved: boolean): Promise<boolean> {
		let done = false;
		await this.exclusive(`${resolved ? "resolving" : "reopening"} a comment of "${file.basename}"`, async () => {
			const client = this.clientOrNotice();
			if (!client) return;
			try {
				const location = this.sync.locate(file);
				const page = await client.getPage(location);
				const state = page ? await client.getCommentResolutions(location) : null;
				if (!page) {
					this.report(`"${file.basename}" has no page on XWiki.`, true);
					return;
				}
				if (!state) {
					this.report("This XWiki cannot resolve comments: it has no comment resolution service (Tools.CommentResolve).", true);
					return;
				}
				if (!state.canResolve) {
					this.report(`You cannot ${resolved ? "resolve" : "reopen"} comments of this page on XWiki.`, true);
					return;
				}
				// Whether resolving saves the page or not, the note is only moved to the new version when nothing else changed it.
				await this.sync.postComment(client, file, location, page, async () => {
					await client.setCommentResolved(location, comment, resolved);
				});
				done = true;
				this.report(`${resolved ? "Resolved" : "Reopened"} a comment of "${file.basename}" on XWiki.`);
			} catch (error) {
				console.error("XWiki Publisher: resolving a comment failed", error);
				this.report(`${resolved ? "Resolving" : "Reopening"} the comment failed: ${errorMessage(error)}`, true);
			}
		});
		return done;
	}

	/** Lists the resolved inline comments of a note, which it does not show, to read or reopen them. */
	async showResolvedComments(file: TFile): Promise<void> {
		const client = this.clientOrNotice();
		if (!client) return;
		const notice = new Notice(`Reading the resolved comments of "${file.basename}"…`, 0);
		try {
			const location = this.sync.locate(file);
			const page = await client.getPage(location);
			if (!page) throw new Error("the note has no page on XWiki");
			if (!(await client.getCommentResolutions(location))) throw new Error("this XWiki has no comment resolution service (Tools.CommentResolve)");
			const resolved = (await this.sync.commentThreadsOf(client, location, page)).filter((thread) => thread.resolved);
			notice.hide();
			new ResolvedCommentsModal(this.app, file.basename, file.path, resolved, (thread) => this.setResolved(file, thread.id, false)).open();
		} catch (error) {
			notice.hide();
			console.error("XWiki Publisher: reading resolved comments failed", error);
			this.report(`Could not read the resolved comments: ${errorMessage(error)}`, true);
		}
	}

	/** Changes the text of an inline comment of a note, or of a reply, on XWiki. */
	edit(path: string, comment: number): (() => void) | null {
		const file = this.app.vault.getFileByPath(path);
		return file && this.syncState[path] ? () => void this.editComment(file, comment) : null;
	}

	/**
	 * Asks for the new text of a comment of the page of a note, starting from its text on XWiki, and sends it right
	 * away; the note then shows the comments of the page again. Mentions show as `@Name` and are sent back as they were.
	 */
	async editComment(file: TFile, comment: number): Promise<void> {
		const client = this.clientOrNotice();
		if (!client) return;
		const location = this.sync.locate(file);
		let source: string;
		let initial: { text: string; mentions: { shown: string; macro: string }[] };
		try {
			const existing = (await client.listComments(location)).find((candidate) => candidate.id === comment);
			if (!existing) {
				this.report("That comment is no longer on XWiki. Pull the note to update its comments.", true);
				return;
			}
			source = existing.text;
			const names = new Map<string, string | undefined>();
			for (const reference of mentionReferences(source)) names.set(reference, await client.userName(location, reference));
			const mentioned = mentionsForEditing(source, (reference) => names.get(reference));
			const issues = issuesForEditing(mentioned.text);
			initial = { text: issues.text, mentions: [...mentioned.mentions, ...issues.mentions] };
		} catch (error) {
			console.error("XWiki Publisher: reading the comment failed", error);
			this.report(`Could not read the comment: ${errorMessage(error)}`, true);
			return;
		}
		const text = await promptText(this.app, "Edit XWiki comment", "The comment", "Save", undefined, this.mentionInput(file), initial);
		if (!text || text === source.trim()) return;
		await this.exclusive(`editing a comment of "${file.basename}"`, async () => {
			const notice = new Notice("Sending the comment to XWiki…", 0);
			try {
				const page = await client.getPage(location);
				if (!page) {
					this.report("The page is no longer on XWiki.", true);
					return;
				}
				await this.sync.postComment(client, file, location, page, () => client.updateComment(location, comment, text));
				this.report(`Comment changed on "${file.basename}" on XWiki.`);
			} catch (error) {
				console.error("XWiki Publisher: editing a comment failed", error);
				this.report(`Changing the comment failed: ${errorMessage(error)}`, true);
			} finally {
				notice.hide();
			}
		});
	}

	/** Deletes an inline comment of a note with its replies, on XWiki, after asking. */
	remove(path: string, comment: number): (() => void) | null {
		const file = this.app.vault.getFileByPath(path);
		return file && this.syncState[path] ? () => void this.deleteComment(file, comment) : null;
	}

	/**
	 * Deletes an inline comment and its replies on XWiki, after a confirmation that says how many replies go with it,
	 * then shows the comments of the page in the note again.
	 */
	async deleteComment(file: TFile, comment: number): Promise<void> {
		await this.exclusive(`deleting a comment of "${file.basename}"`, async () => {
			const client = this.clientOrNotice();
			if (!client) return;
			try {
				const location = this.sync.locate(file);
				const page = await client.getPage(location);
				// The comment may be a reply: the thread it is in tells which replies are below it.
				const threads = page ? await this.sync.commentThreadsOf(client, location, page) : [];
				const thread = threads.find((candidate) => candidate.entries.some((entry) => entry.id === comment));
				if (!page || !thread) {
					this.report("That comment is no longer on XWiki. Pull the note to update its comments.", true);
					return;
				}
				// Replies below it first, newest first: a comment is never left with replies to nothing.
				const ids = commentsBelow(thread, comment);
				const replies = ids.length - 1;
				const what = comment === thread.id ? "comment" : "reply";
				const confirmed = await choose(
					this.app,
					`Delete ${what}`,
					`Delete this ${what}${replies > 0 ? ` and the ${replies} ${replies === 1 ? "reply" : "replies"} below it` : ""} on XWiki, for everyone? This cannot be undone from Obsidian.`,
					[
						{ label: "Delete", value: true, warning: true },
						{ label: "Cancel", value: false },
					],
				);
				if (!confirmed) return;
				await this.sync.postComment(
					client,
					file,
					location,
					page,
					async () => {
						for (const id of ids) await client.deleteComment(location, id);
					},
					ids.length,
				);
				this.report(`Deleted a ${what} of "${file.basename}" on XWiki.`);
			} catch (error) {
				console.error("XWiki Publisher: deleting a comment failed", error);
				this.report(`Deleting the comment failed: ${errorMessage(error)}`, true);
			}
		});
	}

	/** Mentioning users in a comment written for the page of `file`. */
	private mentionInput(file: TFile): MentionInput {
		const workPackages = (): MentionInput["workPackages"] => {
			if (!this.settings.openProjectUrl) return undefined;
			try {
				const openProject = this.createOpenProjectClient();
				return {
					search: (input) => openProject.searchWorkPackages(input),
					prefixes: this.keyPrefixes(),
					searchKey: (key) => this.searchKey(key),
					macro: (workPackage) => issueMacro(workPackage.key),
				};
			} catch {
				// No token: work packages cannot be searched, mentions still can.
				return undefined;
			}
		};
		return { search: (input: string) => this.searchUsers(file, input), macro: (user: MentionUser) => newMentionMacro(user.reference), workPackages: workPackages() };
	}

	/** Starts a reply to an inline comment of a note, from the editor it is open in. */
	reply(path: string, comment: number, quote?: string): (() => void) | null {
		const file = this.app.vault.getFileByPath(path);
		if (!file || !this.syncState[path]) return null;
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file === file) return () => void this.replyToComment(view.editor, file, comment, quote);
		}
		return null;
	}

	/** An inline comment of a note with its replies, as XWiki has them now; `null` when it cannot be read. */
	async thread(path: string, comment: number): Promise<CommentThread | null> {
		const file = this.app.vault.getFileByPath(path);
		if (!file || !this.syncState[path]) return null;
		try {
			const client = this.createClient();
			const location = this.sync.locate(file);
			const page = await client.getPage(location);
			return page ? await this.sync.commentThread(client, location, page, comment) : null;
		} catch (error) {
			console.debug("XWiki Publisher: could not read the comment", error);
			return null;
		}
	}

	suggestsMentions(): boolean {
		return this.settings.mentionSuggest;
	}

	hasPage(file: TFile): boolean {
		return this.syncState[file.path] !== undefined;
	}

	/** Users of the XWiki whose name or login contains `input`, asked through the page of `file`. */
	searchUsers(file: TFile, input: string): Promise<MentionUser[]> {
		return this.createClient().searchUsers(this.locate(file), input);
	}

	/** A mention written in Obsidian: the link to the profile of the user. Publishing gives it its anchor. */
	mentionText(user: MentionUser): string | null {
		return mentionLink(this.settings.baseUrl, { reference: user.reference, style: "FULL_NAME" }, user.name);
	}

	/** Asks for a user of the XWiki and mentions that user at the cursor. */
	mentionUser(editor: Editor, file: TFile): void {
		new MentionModal(
			this.app,
			(input) => this.searchUsers(file, input),
			(user) => {
				const link = this.mentionText(user);
				if (link) editor.replaceSelection(`${link} `);
			},
		).open();
	}

	/** Starts of work package keys that list work packages when typed with a digit, from the settings. */
	keyPrefixes(): string[] {
		return this.settings.openProjectUrl ? keyPrefixes(this.settings.workPackagePrefixes) : [];
	}

	/** Work packages whose key starts with `key` (`IKN-23`): that work package itself first, then the others found. */
	async searchKey(key: string): Promise<WorkPackage[]> {
		const found = await this.createOpenProjectClient().searchWorkPackages(key);
		const start = key.toUpperCase();
		return found.filter((workPackage) => workPackage.key.toUpperCase().startsWith(start));
	}

	/** The link that stands for a work package in a note: published as an issue macro. */
	workPackageLink(workPackage: WorkPackage): string | null {
		return issueLink(this.settings.openProjectUrl, workPackage.key);
	}

	/**
	 * Asks for a work package of OpenProject and writes a link to it at the cursor, which publishing sends as an issue
	 * macro and records as a link of the page in OpenProject. A selected text is the first search.
	 */
	insertWorkPackage(editor: Editor): void {
		let openProject: OpenProjectClient;
		try {
			openProject = this.createOpenProjectClient();
		} catch (error) {
			this.report(errorMessage(error), true);
			return;
		}
		const selected = editor.getSelection().trim();
		new WorkPackageModal(
			this.app,
			(input) => openProject.searchWorkPackages(input),
			(workPackage) => {
				const link = issueLink(this.settings.openProjectUrl, workPackage.key);
				if (link) editor.replaceSelection(`${link} `);
			},
			selected.includes("\n") ? "" : selected,
		).open();
	}

	/** Inline comment of the page shown where the cursor is, if any. */
	private commentAtCursor(editor: Editor): number | null {
		const cursor = editor.getCursor();
		return commentAt(editor.getLine(cursor.line), cursor.ch);
	}

	/**
	 * Adds an inline comment on the text selected in a note, on its XWiki page. The comment is sent right away, like
	 * a comment made on XWiki, and then shown in the note with the other comments of the page.
	 */
	async commentOnSelection(editor: Editor, file: TFile): Promise<void> {
		const note = editor.getValue();
		const from = editor.posToOffset(editor.getCursor("from"));
		const to = editor.posToOffset(editor.getCursor("to"));
		await this.exclusive(`commenting on "${file.basename}"`, async () => {
			const client = this.clientOrNotice();
			if (!client) return;
			let notice = new Notice("Looking up the selected text on XWiki…", 0);
			try {
				const location = this.sync.locate(file);
				const page = await client.getPage(location);
				if (!page) {
					this.report(`"${file.basename}" has no page on XWiki. Publish it first.`, true);
					return;
				}
				// XWiki attaches a comment to the text of the page as it shows it, so that is where the selection is looked up.
				const target = selectionOnPage(note, from, to, htmlToText(await client.getAnnotatedHtml(location)));
				notice.hide();
				if (!target) {
					this.report("The selected text is not on the XWiki page, or is there more than once with the same text around it. Publish the note if the text is new, or select more of it.", true, 10000);
					return;
				}
				const text = await promptText(this.app, "Comment on XWiki", "Your comment", "Add comment", target.selection, this.mentionInput(file));
				if (!text) return;
				notice = new Notice("Sending the comment to XWiki…", 0);
				await this.sync.postComment(client, file, location, page, () => client.addAnnotation(location, target, text));
				this.report(`Comment added to "${file.basename}" on XWiki.`);
			} catch (error) {
				console.error("XWiki Publisher: comment failed", error);
				this.report(`Commenting on XWiki failed: ${errorMessage(error)}`, true);
			} finally {
				notice.hide();
			}
		});
	}

	/** Replies to the inline comment `comment` of the page of a note; the reply is sent right away. */
	async replyToComment(editor: Editor, file: TFile, comment: number, quote?: string): Promise<void> {
		// The comment answered above the input: the one given, or the thread as the note shows it.
		const shown = quote ?? new RegExp(`^\\[\\^xwiki-${comment}\\]: (.*)$`, "m").exec(editor.getValue())?.[1].replace(/<br>/g, "\n");
		const text = await promptText(this.app, "Reply to XWiki comment", "Your reply", "Reply", shown, this.mentionInput(file));
		if (!text) return;
		await this.exclusive(`replying on "${file.basename}"`, async () => {
			const client = this.clientOrNotice();
			if (!client) return;
			const notice = new Notice("Sending the reply to XWiki…", 0);
			try {
				const location = this.sync.locate(file);
				const page = await client.getPage(location);
				// The note may show a comment that was deleted since: a reply to it would be left on its own.
				if (!page || !(await client.listComments(location)).some((existing) => existing.id === comment)) {
					this.report("That comment is no longer on XWiki. Pull the note to update its comments.", true);
					return;
				}
				await this.sync.postComment(client, file, location, page, () => client.addComment(location, text, comment));
				this.report(`Reply added to "${file.basename}" on XWiki.`);
			} catch (error) {
				console.error("XWiki Publisher: reply failed", error);
				this.report(`Replying on XWiki failed: ${errorMessage(error)}`, true);
			} finally {
				notice.hide();
			}
		});
	}

	pullNote(file: TFile): Promise<void> {
		return this.exclusive(`pulling "${file.basename}"`, () => this.doPullNote(file));
	}

	private async doPullNote(file: TFile): Promise<void> {
		const client = this.clientOrNotice();
		if (!client) return;
		const notice = new Notice(`Pulling "${file.basename}" from XWiki…`, 0);
		try {
			const location = this.sync.locate(file);
			const result = await this.sync.pull(client, location, {
				file,
				interactive: true,
				index: this.sync.buildIndex(),
			});
			notice.hide();
			if (isSettled(result.outcome)) this.settleIncoming(file);
			this.report(this.describeOutcome(result, file.basename), result.outcome === "conflict");
		} catch (error) {
			notice.hide();
			console.error("XWiki Publisher: pull failed", error);
			this.report(`Pulling from XWiki failed: ${errorMessage(error)}`, true);
		}
	}

	/**
	 * Shows the current comments and mentions of the page of a note that was opened, in the background. Skipped while
	 * another operation runs, and for a note compared with its page a short while ago. Failures are only logged:
	 * opening a note must work without XWiki.
	 */
	private async refreshOpened(file: TFile): Promise<void> {
		if (!this.settings.refreshOnOpen || file.extension !== "md" || this.busy || !this.syncState[file.path]) return;
		if (Date.now() - (this.refreshedAt.get(file.path) ?? 0) < REFRESH_INTERVAL_MS) return;
		this.refreshedAt.set(file.path, Date.now());
		let client: XWikiClient;
		try {
			client = this.createClient();
		} catch {
			return;
		}
		try {
			const result = await this.sync.refreshShown(
				client,
				file,
				async () => this.openEditor(file)?.getValue() ?? (await this.app.vault.read(file)),
				(transform) => this.changeNote(file, transform),
			);
			if (!result) return;
			// A note an earlier version counted as edited for its spacing only: it is in sync if it shows its page.
			if (this.sync.hasOldFingerprint(file) && this.sync.isLocallyChanged(file, await this.readNote(file))) {
				await this.settleIfSame(file, this.locate(file), await this.loadComparison(client, file, this.locate(file)));
			}
			// At the version of the page, with all its attachments, a pull would not change the note anymore.
			const record = this.syncState[file.path];
			if (record?.version === result.version && !record.missingAttachments?.length) this.settleIncoming(file);
			if (result.pageChanged && this.announced.get(file.path) !== result.version) {
				this.announced.set(file.path, result.version);
				new Notice(`"${file.basename}" changed on XWiki (version ${result.version}). Pull it to get the new text.`, 8000);
			}
		} catch (error) {
			console.debug(`XWiki Publisher: could not update the comments and mentions of ${file.path}`, error);
		}
	}

	/** The editor a note is open in for editing, if any. */
	private openEditor(file: TFile): Editor | null {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file === file && view.getMode() === "source") return view.editor;
		}
		return null;
	}

	/**
	 * Changes a note with a function of its whole text, and returns the new text, or `null` when nothing changed.
	 * A note open for editing is changed in its editor, from what is typed there, so nothing typed is lost: only the
	 * changed part is replaced, which keeps the cursor and the undo history. Obsidian then saves it.
	 */
	private async changeNote(file: TFile, transform: (text: string) => string): Promise<string | null> {
		const editor = this.openEditor(file);
		if (!editor) {
			let changed: string | null = null;
			await this.app.vault.process(file, (data) => {
				const next = transform(data);
				if (next !== data) changed = next;
				return next;
			});
			return changed;
		}
		const before = editor.getValue();
		const after = transform(before);
		if (after === before) return null;
		let start = 0;
		while (start < before.length && start < after.length && before[start] === after[start]) start++;
		let end = 0;
		while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
		editor.replaceRange(after.slice(start, after.length - end), editor.offsetToPos(start), editor.offsetToPos(before.length - end));
		return after;
	}

	/**
	 * Compares a listed note with its page, side by side: the old version on the left, the new one on the right. For a
	 * change to publish, the old version is the page on XWiki and the new one the note; for a note to pull, the other
	 * way round. The page is shown as pulling would write it into the note, so only real differences are marked.
	 */
	async showDifferences(direction: "outgoing" | "incoming", file: TFile | null, location: PageLocation, name: string, revert?: () => Promise<boolean>): Promise<void> {
		const client = this.clientOrNotice();
		if (!client) return;
		const notice = new Notice(`Comparing "${name}" with XWiki…`, 0);
		let state: Comparison;
		try {
			state = await this.loadComparison(client, file, location);
		} catch (error) {
			notice.hide();
			console.error("XWiki Publisher: comparison failed", error);
			this.report(`Comparing with XWiki failed: ${errorMessage(error)}`, true);
			return;
		}
		notice.hide();
		if (file) await this.settleIfSame(file, location, state);
		const outgoing = direction === "outgoing";
		const sides = (): [DiffSide, DiffSide] => {
			const page: DiffSide = state.remote
				? { label: `XWiki · version ${state.remote.version}`, text: state.page }
				: { label: "XWiki", text: null, missing: "the page is not on XWiki" };
			const note: DiffSide = file ? { label: `Vault · ${file.path}`, text: state.note } : { label: "Vault", text: null, missing: "the note was deleted from the vault" };
			return outgoing ? [page, note] : [note, page];
		};
		// Which lines of the note and of the page a block covers.
		const ranges = (hunk: DiffHunk): BlockRanges => (outgoing ? { page: hunk.left, note: hunk.right } : { page: hunk.right, note: hunk.left });
		const reload = async (): Promise<[DiffSide, DiffSide]> => {
			state = await this.loadComparison(client, file, location);
			return sides();
		};
		const blocks: DiffBlockAction[] = [];
		if (file) {
			const toNote: DiffBlockAction = {
				label: outgoing ? "Revert" : "Pull",
				tooltip: outgoing ? "Undo this change in the note: it gets the lines of the XWiki page back" : "Take this change into the note",
				warning: outgoing,
				run: async (hunk) => {
					if (outgoing && !(await this.confirmBlock("Revert this change?", "The note gets the lines of the XWiki page back, and the lines shown on the right are lost."))) return null;
					await this.pullBlock(client, file, location, state, ranges(hunk));
					return reload();
				},
			};
			const toPage: DiffBlockAction = {
				label: outgoing ? "Publish" : "Revert",
				tooltip: outgoing ? "Publish only this change to XWiki" : "Undo this change on XWiki: the page gets the lines of the note back",
				warning: !outgoing,
				run: async (hunk) => {
					if (!outgoing && !(await this.confirmBlock("Undo this change on XWiki?", "The page gets the lines of the note back, published under your XWiki account. The change shown on the right is removed from the page."))) {
						return null;
					}
					await this.publishBlock(client, file, location, state, ranges(hunk));
					return reload();
				},
			};
			blocks.push(...(outgoing ? [toPage, toNote] : [toNote, toPage]));
		}
		const [left, right] = sides();
		const broken = state.remote ? pageBrokenMentions(state.remote) : 0;
		const explanation = broken > 0
			? `XWiki's editor broke ${broken} mention(s) of this page: XWiki shows the last part of the user name instead of the user. The note has them right; publish it to repair the page.`
			: undefined;
		new DiffModal(this.app, name, left, right, { revert, blocks, notice: explanation, available: () => state.remote !== null && state.note !== null }).open();
	}

	/**
	 * Records a note as in sync when it shows its page as a pull would write it, spacing aside, whatever its record
	 * says: an earlier version of the plugin counted spacing as an edit, and the page may have had a version since
	 * without a new text, such as a comment. Returns whether it did.
	 */
	private async settleIfSame(file: TFile, location: PageLocation, state: Comparison): Promise<boolean> {
		if (!state.remote || state.note === null || state.page === null || !sameText(state.note, state.page)) return false;
		const behind = this.syncState[file.path]?.version !== state.remote.version;
		if (!behind && !this.sync.isLocallyChanged(file, await this.app.vault.read(file))) return false;
		await this.sync.recordSync(file, state.remote.version, location, { content: state.remote.content, syntax: state.remote.syntax, body: state.note, comments: true, pulled: true });
		this.settleIncoming(file);
		this.log(`"${file.basename}" shows its XWiki page (version ${state.remote.version}): it is in sync.`);
		this.changed();
		return true;
	}

	/** The note and its page as a pull would write it, for a comparison. */
	private async loadComparison(client: XWikiClient, file: TFile | null, location: PageLocation): Promise<Comparison> {
		const remote = await client.getPage(location);
		const preview = remote ? await this.sync.previewPull(client, location, remote, file) : null;
		return {
			remote,
			page: preview?.markdown ?? null,
			attachments: preview?.attachments ?? new Set(),
			note: file ? stripFrontmatter(await this.readNote(file)) : null,
		};
	}

	/** The note as it is now: in its editor when it is open for editing, where it may not be saved yet. */
	private async readNote(file: TFile): Promise<string> {
		return this.openEditor(file)?.getValue() ?? (await this.app.vault.read(file));
	}

	private async confirmBlock(title: string, message: string): Promise<boolean> {
		return (await choose(this.app, title, message, [
			{ label: "Continue", value: true, warning: true },
			{ label: "Cancel", value: false },
		])) === true;
	}

	/**
	 * Takes one block of the page into the note, as long as the note is still what was compared; the other lines of
	 * the note stay as they are. Attachments the block links to are downloaded. Once the note shows all of the page,
	 * it is in sync with it.
	 */
	private async pullBlock(client: XWikiClient, file: TFile, location: PageLocation, state: Comparison, range: BlockRanges): Promise<void> {
		const { note, page, remote } = state;
		if (note === null || page === null || !remote) return;
		await this.exclusive(`pulling a change into "${file.basename}"`, async () => {
			try {
				const next = replaceLines(note, range.note, page, range.page);
				let stale = false;
				await this.changeNote(file, (whole) => {
					const body = stripFrontmatter(whole);
					if (body !== note) {
						stale = true;
						return whole;
					}
					return whole.slice(0, whole.length - body.length) + next;
				});
				if (stale) {
					this.report(`"${file.basename}" changed since the comparison was opened. It was compared again: check the change and try once more.`, true);
					return;
				}
				const taken = lines(page).slice(range.page[0], range.page[1]).join("\n");
				const failed = await this.sync.fetchAttachments(client, location, file, [...state.attachments].filter((name) => taken.includes(name)));
				if (failed.length > 0) this.report(`Could not download from XWiki: ${failed.join(", ")}`, true);
				// The note shows the page: it is in sync with this version.
				if (sameText(next, page)) await this.sync.recordSync(file, remote.version, location, { content: remote.content, syntax: remote.syntax, body: next, comments: true, pulled: true });
				this.log(`Pulled a change into "${file.basename}".`);
			} catch (error) {
				console.error("XWiki Publisher: pulling a change failed", error);
				this.report(`Pulling the change failed: ${errorMessage(error)}`, true);
			}
		});
	}

	/**
	 * Publishes one block of the note: the page as it was compared, with the lines of the note for that block. The
	 * page is not overwritten if it changed since. The note is recorded as in sync with the new page only when that is
	 * certain: the page was what the note was last synced with, or it now shows the whole note.
	 */
	private async publishBlock(client: XWikiClient, file: TFile, location: PageLocation, state: Comparison, range: BlockRanges): Promise<void> {
		const { note, page, remote } = state;
		if (note === null || page === null || !remote) return;
		await this.exclusive(`publishing a change of "${file.basename}"`, async () => {
			try {
				if (stripFrontmatter(await this.readNote(file)) !== note) {
					this.report(`"${file.basename}" changed since the comparison was opened. It was compared again: check the change and try once more.`, true);
					return;
				}
				await this.ensureSyntaxAvailable(client, this.settings.syntax);
				const body = replaceLines(page, range.page, note, range.note);
				const record = this.syncState[file.path]?.version === remote.version || sameText(body, note);
				const result = await this.publishNote(client, file, { mode: "overwrite", status: (message) => this.progress(message), body, expectedVersion: remote.version, record });
				let message = `Published a change of "${file.basename}" to XWiki.`;
				if (result.failed.length > 0) message += ` Failed to upload: ${result.failed.join(", ")}.`;
				this.report(message, result.failed.length > 0);
			} catch (error) {
				console.error("XWiki Publisher: publishing a change failed", error);
				this.report(`Publishing the change failed: ${errorMessage(error)}`, true);
			}
		});
	}

	/**
	 * Undoes a change listed in the source control tab, after a confirmation: a modified note gets its page as it is on
	 * XWiki, a deleted note is created again from its page, and a note never published, which XWiki has no copy of, is
	 * moved to the trash. Returns whether the change was undone.
	 */
	async revertChange(change: NoteChange): Promise<boolean> {
		if (this.busy) {
			new Notice(`XWiki Publisher is busy: ${this.busy}`);
			return false;
		}
		const name = noteBasename(change.path);
		const question =
			change.status === "added"
				? `"${name}" was never published, so XWiki has no version of it to go back to. Move the note to the trash?`
				: change.status === "deleted"
					? `Create "${name}" again at ${change.path}, from its XWiki page ${change.note.reference}?`
					: `Replace "${name}" with its XWiki page? Your changes since the last publish or pull are lost. If the page changed on XWiki since then, the note gets its current version.`;
		const confirmed = await choose(this.app, "Revert changes", question, [
			{ label: change.status === "added" ? "Move to trash" : "Revert", value: true, warning: true },
			{ label: "Cancel", value: false },
		]);
		if (!confirmed) return false;
		let reverted = false;
		await this.exclusive(`reverting "${name}"`, async () => {
			if (change.status === "added") {
				await this.app.fileManager.trashFile(change.file);
				this.report(`Moved "${name}" to the trash.`);
				reverted = true;
				return;
			}
			const client = this.clientOrNotice();
			if (!client) return;
			try {
				const location = change.status === "deleted" ? change.note.location : this.locate(change.file);
				const remote = await client.getPage(location);
				if (!remote) {
					this.report(`"${name}" cannot be reverted: its page ${serializeReference(location)} is no longer on XWiki.`, true);
					return;
				}
				const file = change.status === "deleted" ? await this.sync.recreateNote(change.note) : change.file;
				const result = await this.sync.pull(client, location, { file, interactive: false, force: true, remote, index: this.sync.buildIndex() });
				reverted = isSettled(result.outcome);
				if (reverted) this.settleIncoming(file);
				this.report(reverted ? `Reverted "${name}" to XWiki version ${remote.version}.` : this.describeOutcome(result, name), !reverted);
			} catch (error) {
				console.error("XWiki Publisher: revert failed", error);
				this.report(`Reverting "${name}" failed: ${errorMessage(error)}`, true);
			}
		});
		return reverted;
	}

	/** Removes a note from the incoming notes once it was pulled or published. */
	private settleIncoming(file: TFile): void {
		if (!this.incoming) return;
		const left = this.incoming.changes.filter((change) => change.file !== file);
		if (left.length === this.incoming.changes.length) return;
		this.incoming.changes = left;
		this.changed();
	}

	/**
	 * Compares every note that was published or pulled with its page on XWiki, and keeps the ones that a pull would
	 * change, for the source control tab. Only pages are read: nothing in the vault or on XWiki changes.
	 */
	async checkIncoming(): Promise<void> {
		await this.exclusive("Checking XWiki…", async () => {
			const client = this.clientOrNotice();
			if (!client) return;
			this.sync.reconcileRecords();
			const notes = this.publishableNotes().filter((file) => this.syncState[file.path]);
			const changes: IncomingChange[] = [];
			const failures = new Map<string, string[]>();
			let checked = 0;
			let failed = 0;
			let cancelled = false;
			this.cancellable = true;
			const queue = [...notes];
			const worker = async () => {
				for (let file = queue.shift(); file; file = queue.shift()) {
					if (this.cancelRequested) {
						cancelled = true;
						return;
					}
					const version = this.syncState[file.path]?.version ?? "";
					try {
						const remote = await client.getPage(this.locate(file));
						const state = await this.sync.incomingState(file, remote);
						if (state) changes.push({ path: file.path, file, state, version, remoteVersion: remote?.version });
						checked++;
					} catch (error) {
						const message = errorMessage(error);
						failures.set(message, [...(failures.get(message) ?? []), file.basename]);
						failed++;
					}
					this.progress(`Checking XWiki ${checked + failed}/${notes.length}…`);
				}
			};
			await Promise.all(Array.from({ length: Math.min(CHECK_CONCURRENCY, notes.length) }, worker));
			this.incoming = {
				time: Date.now(),
				checked,
				total: notes.length,
				changes: changes.sort((a, b) => a.path.localeCompare(b.path)),
				failures: [...failures].map(([message, names]) => `${names.join(", ")}: ${message}`),
				cancelled,
			};
			const conflicts = changes.filter((change) => change.state.status === "conflict").length;
			const missing = changes.filter((change) => change.state.status === "missing").length;
			const behind = changes.length - missing;
			const parts = [
				behind === 0 ? "every note is up to date" : `${behind} note(s) to pull`,
				conflicts > 0 ? `${conflicts} changed on both sides` : "",
				missing > 0 ? `${missing} page(s) no longer on XWiki` : "",
				failed > 0 ? `${failed} could not be checked: ${this.incoming.failures.join("; ")}` : "",
				cancelled ? `${notes.length - checked - failed} not checked (cancelled)` : "",
			].filter(Boolean);
			this.report(`XWiki check of ${checked} note(s): ${parts.join("; ")}.`, failed > 0 || conflicts > 0, 10000);
		}, "incoming");
	}

	/**
	 * Pulls the selected incoming notes, parent pages first. Notes edited in the vault whose page changed too are
	 * written next to the note (keep both) or over it, as the user chooses once for all of them.
	 */
	async pullIncoming(changes: IncomingChange[]): Promise<void> {
		const pullable = changes.filter((change) => change.state.status !== "missing");
		if (pullable.length === 0) return;
		if (this.busy) {
			new Notice(`XWiki Publisher is busy: ${this.busy}`);
			return;
		}
		const conflicts = pullable.filter((change) => change.state.status === "conflict");
		let conflict: "copy" | "overwrite" = "copy";
		if (conflicts.length > 0) {
			const names = conflicts.slice(0, 10).map((change) => change.file.basename);
			if (conflicts.length > names.length) names.push(`and ${conflicts.length - names.length} more`);
			const choice = await choose<"copy" | "overwrite" | null>(
				this.app,
				"Pull from XWiki",
				`${conflicts.length} of the notes were edited in the vault, and their XWiki page changed too: ${names.join(", ")}. ` +
					"Keep both writes the XWiki version next to each of them as a conflict copy. A note whose page only got new comments or attachments keeps its text either way.",
				[
					{ label: "Keep both", value: "copy", cta: true },
					{ label: "Overwrite local notes", value: "overwrite", warning: true },
					{ label: "Cancel", value: null },
				],
			);
			if (!choice) return;
			conflict = choice;
		}
		const files = this.publishOrder(pullable.map((change) => change.file));
		const label = files.length === 1 ? `"${files[0].basename}"` : `${files.length} notes`;
		await this.exclusive(`pulling ${label}`, () => this.doPullIncoming(files, label, conflict), "incoming");
	}

	private async doPullIncoming(files: TFile[], label: string, conflict: "copy" | "overwrite"): Promise<void> {
		const client = this.clientOrNotice();
		if (!client) return;
		const counts: Record<PullOutcome | "failed", number> = { created: 0, updated: 0, unchanged: 0, conflict: 0, missing: 0, cancelled: 0, failed: 0 };
		const failures = new Map<string, string[]>();
		const conflicts: string[] = [];
		try {
			this.cancellable = true;
			const index = this.sync.buildIndex();
			const titleCache = new Map<string, string>();
			const claims = new Map<string, string>();
			await this.sync.batch(async () => {
				for (const [i, file] of files.entries()) {
					if (this.cancelRequested) {
						counts.cancelled += files.length - i;
						break;
					}
					this.progress(`Pulling ${i + 1}/${files.length}: ${file.basename}`);
					try {
						const result = await this.sync.pull(client, this.locate(file), { file, interactive: false, conflict, index, titleCache, claims });
						counts[result.outcome]++;
						if (result.outcome === "conflict") conflicts.push(file.basename);
						if (isSettled(result.outcome)) this.settleIncoming(file);
					} catch (error) {
						console.error(`XWiki Publisher: failed to pull ${file.path}`, error);
						counts.failed++;
						const message = errorMessage(error);
						failures.set(message, [...(failures.get(message) ?? []), file.basename]);
					}
					await this.sync.checkpoint();
				}
			});
		} finally {
			const parts = [
				`${counts.updated} updated`,
				counts.unchanged > 0 ? `${counts.unchanged} already up to date` : "",
				conflicts.length > 0 ? `${conflicts.length} kept with the XWiki version next to them: ${conflicts.join(", ")}` : "",
				counts.missing > 0 ? `${counts.missing} no longer on XWiki` : "",
				counts.failed > 0 ? `${counts.failed} failed: ${[...failures].map(([message, names]) => `${names.join(", ")}: ${message}`).join("; ")}` : "",
				counts.cancelled > 0 ? `${counts.cancelled} not pulled (cancelled)` : "",
			].filter(Boolean);
			this.report(`XWiki pull of ${label} finished: ${parts.join("; ")}.`, counts.failed > 0 || conflicts.length > 0, 10000);
		}
	}

	/** Imports one page; asks for its URL or reference when `input` is not given. */
	async importPage(input?: string): Promise<void> {
		input ??=
			(await prompt(
				this.app,
				"Import page from XWiki",
				"Page URL or reference, for example Docs.Team.WebHome",
				`${this.settings.baseUrl.replace(/\/+$/, "")}/bin/view/…`,
			)) ?? undefined;
		const reference = input?.trim();
		if (!reference) return;
		await this.exclusive("importing a page", () => this.doImportPage(reference));
	}

	private async doImportPage(input: string): Promise<void> {
		const client = this.clientOrNotice();
		if (!client) return;
		const notice = new Notice("Importing page from XWiki…", 0);
		try {
			const found = await this.sync.findPage(client, input);
			if (!found) {
				notice.hide();
				this.report(`No XWiki page found for "${input}".`, true);
				return;
			}
			const { location, remote } = found;
			const result = await this.sync.pull(client, location, {
				interactive: true,
				index: this.sync.buildIndex(),
				remote,
			});
			notice.hide();
			this.report(this.describeOutcome(result, pageDisplayName(location)), result.outcome === "conflict");
		} catch (error) {
			notice.hide();
			console.error("XWiki Publisher: import failed", error);
			this.report(`Importing from XWiki failed: ${errorMessage(error)}`, true);
		}
	}

	/** Pulls a whole space; asks for the space reference when `input` is not given. */
	async syncSpace(input?: string): Promise<void> {
		input ??=
			(await prompt(
				this.app,
				"Sync space from XWiki",
				"XWiki page URL of the folder, or its space reference (Docs.Team). The page and all pages below it are pulled.",
				"Docs.Team",
				this.settings.defaultSpace,
			)) ?? undefined;
		const root = parseSpaceInput(input ?? "", this.settings.baseUrl);
		if (root.length === 0) {
			if (input?.trim()) this.report(`"${input.trim()}" is not a space reference or a page URL of ${this.settings.baseUrl || "the configured XWiki"}.`, true);
			return;
		}
		await this.exclusive(`syncing "${root.join(".")}"`, () => this.doSyncSpace(root));
	}

	private async doSyncSpace(root: string[]): Promise<void> {
		const client = this.clientOrNotice();
		if (!client) return;
		const notice = new Notice("Syncing from XWiki…", 0);
		try {
			this.cancellable = true;
			const { counts, converted, failures } = await this.sync.pullSpace(
				client,
				root,
				(message) => {
					notice.setMessage(message);
					this.progress(message);
				},
				() => this.cancelRequested,
			);
			notice.hide();
			const shown = failures.slice(0, 10).join(", ");
			const more = failures.length > 10 ? ` and ${failures.length - 10} more (all listed in the developer console)` : "";
			const parts = [
				`${counts.created} imported`,
				`${counts.updated} updated`,
				`${counts.unchanged} unchanged`,
				counts.conflict > 0 ? `${counts.conflict} conflict(s)` : "",
				converted > 0 ? `${converted} converted from XWiki syntax` : "",
				counts.missing > 0 ? `${counts.missing} failed: ${shown}${more}` : "",
				counts.cancelled > 0 ? `${counts.cancelled} not processed (cancelled)` : "",
			].filter(Boolean);
			const resume = counts.missing > 0 || counts.cancelled > 0 ? " Sync the space again to resume: pages already pulled are skipped." : "";
			this.report(`XWiki sync of "${root.join(".")}" finished: ${parts.join(", ")}.${resume}`, counts.conflict > 0 || counts.missing > 0, 10000);
		} catch (error) {
			notice.hide();
			console.error("XWiki Publisher: space sync failed", error);
			this.report(`Syncing from XWiki failed: ${errorMessage(error)}`, true);
		}
	}
}

import { Menu, normalizePath, Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import { convertNote, ResolvedLink } from "./converter";
import {
	folderPages,
	FM_URL,
	FolderNoteLocation,
	noteName,
	noteTitle,
	PageLocation,
	pageDisplayName,
	parseSpaceInput,
	serializeReference,
} from "./location";
import { choose, prompt } from "./modals";
import { FolderNotes } from "./folder-notes";
import { DEFAULT_SETTINGS, XWikiPublisherSettings, XWikiPublisherSettingTab } from "./settings";
import { AttachmentPaths, AttachmentVersions, PullResult, SyncService, SyncState, UploadedAttachments } from "./sync";
import { VIEW_TYPE_XWIKI, XWikiPanelView } from "./view";
import { XWikiClient } from "./xwiki-client";

interface PluginData extends Partial<XWikiPublisherSettings> {
	syncState?: SyncState;
	attachmentPaths?: AttachmentPaths;
	attachmentVersions?: AttachmentVersions;
	uploadedAttachments?: UploadedAttachments;
}

export interface ActivityEntry {
	time: number;
	message: string;
	error: boolean;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export default class XWikiPublisherPlugin extends Plugin {
	settings: XWikiPublisherSettings = { ...DEFAULT_SETTINGS };
	syncState: SyncState = {};
	attachmentPaths: AttachmentPaths = {};
	attachmentVersions: AttachmentVersions = {};
	uploadedAttachments: UploadedAttachments = {};
	private sync = new SyncService(this);
	readonly folderNotes = new FolderNotes(this);
	/** Recent results, newest first, shown in the side panel. */
	activity: ActivityEntry[] = [];
	/** Label of the operation in progress, if any. */
	busy: string | null = null;
	/** Whether the running operation can be stopped from the panel (space sync). */
	cancellable = false;
	private cancelRequested = false;
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

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
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

		this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.sync.onRename(file, oldPath)));
		this.registerEvent(this.app.vault.on("delete", (file) => this.sync.onDelete(file)));
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
		this.activity.unshift({ time: Date.now(), message, error });
		this.activity.length = Math.min(this.activity.length, 20);
		this.changed();
	}

	/** Runs one XWiki operation at a time, so the panel can show progress and disable its buttons. */
	private async exclusive(label: string, task: () => Promise<void>): Promise<void> {
		if (this.busy) {
			new Notice(`XWiki Publisher is busy: ${this.busy}`);
			return;
		}
		this.busy = label;
		this.cancelRequested = false;
		this.changed();
		try {
			await task();
		} finally {
			this.busy = null;
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

	/** Asks the running space sync to stop after the current page. */
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
		return { synced: true, version: record.version, localChanges: this.sync.isLocallyChanged(file, await this.app.vault.cachedRead(file)) };
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
		const { syncState, attachmentPaths, attachmentVersions, uploadedAttachments, ...settings } = ((await this.loadData()) as PluginData | null) ?? {};
		this.settings = { ...DEFAULT_SETTINGS, ...settings };
		// Removed options: pages are always written in Markdown, and XWiki syntax pages are converted from their view.
		delete (this.settings as Partial<Record<"contentMode" | "xwikiConversion", unknown>>).contentMode;
		delete (this.settings as Partial<Record<"contentMode" | "xwikiConversion", unknown>>).xwikiConversion;
		this.syncState = syncState ?? {};
		this.attachmentPaths = attachmentPaths ?? {};
		this.attachmentVersions = attachmentVersions ?? {};
		this.uploadedAttachments = uploadedAttachments ?? {};
	}

	async saveSettings(): Promise<void> {
		await this.saveData({
			...this.settings,
			syncState: this.syncState,
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
	 * Asks before publishing over a page that is not written in Markdown (its syntax would change and XWiki-only
	 * content such as macros would be lost), or that was edited on XWiki since the note was last synced.
	 */
	private async confirmOverwrite(client: XWikiClient, file: TFile, location: PageLocation): Promise<boolean> {
		const remote = await client.getPage(location);
		if (!remote) return true;
		if (!/^markdown\//i.test(remote.syntax)) {
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
			if (convert !== true) return false;
		}
		const synced = this.sync.lastSyncedVersion(file);
		if (!synced || remote.version === synced) return true;
		const answer = await choose(
			this.app,
			"XWiki page changed",
			`"${pageDisplayName(location)}" was changed on XWiki (version ${synced} → ${remote.version}) since this note was last synced. Publishing will overwrite those changes.`,
			[
				{ label: "Publish anyway", value: true, warning: true },
				{ label: "Cancel", value: false },
			],
		);
		return answer === true;
	}

	/** Creates missing pages for the note's folders; existing pages are never touched. */
	private async ensureFolderPages(client: XWikiClient, file: TFile): Promise<void> {
		if (!this.settings.createFolderPages) return;
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		for (const { location, title } of folderPages(file.path, fm, this.settings, this.sync.folderAnchor)) {
			if (await client.getPage(location)) continue;
			await client.putPage(location, { title, content: "", syntax: "xwiki/2.1" });
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
			const location = this.sync.locate(file);
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
			const content = await this.app.vault.cachedRead(file);

			const resolve = (linkpath: string): ResolvedLink | null => {
				const target = this.app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
				if (!target) return null;
				if (target.extension === "md") {
					return { kind: "page", url: client.viewUrl(this.sync.locate(target)) };
				}
				// Files downloaded from this page keep their XWiki name, even when the vault file was renamed to avoid a clash.
				const name = this.sync.attachmentNameFor(location, target.path) ?? target.name;
				return { kind: "attachment", vaultPath: target.path, name, url: client.attachmentUrl(location, name) };
			};

			const { markdown, attachments } = convertNote(content, resolve);

			await this.ensureSyntaxAvailable(client, this.settings.syntax);
			if (!(await this.confirmOverwrite(client, file, location))) {
				notice.hide();
				return;
			}
			await this.ensureFolderPages(client, file);
			const created = await client.putPage(location, {
				title: noteTitle(noteName(file.path, file.basename, this.settings), fm),
				content: markdown,
				syntax: this.settings.syntax,
			});

			let uploaded = 0;
			const failed: string[] = [];
			if (this.settings.uploadAttachments) {
				for (const [name, vaultPath] of attachments) {
					const attachment = this.app.vault.getFileByPath(vaultPath);
					if (!attachment) continue;
					notice.setMessage(`Uploading ${name}…`);
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
			// Attachment uploads create page versions too, so read the version once everything is saved.
			const remote = await client.getPage(location);
			if (remote) await this.sync.recordSync(file, remote.version);

			notice.hide();
			let message = `${created ? "Created" : "Updated"} XWiki page "${file.basename}".`;
			if (uploaded > 0) message += ` ${uploaded} attachment(s) uploaded.`;
			if (failed.length > 0) message += ` Failed to upload: ${failed.join(", ")}.`;
			this.report(message, failed.length > 0);
		} catch (error) {
			notice.hide();
			console.error("XWiki Publisher: publish failed", error);
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
			this.report(this.describeOutcome(result, file.basename), result.outcome === "conflict");
		} catch (error) {
			notice.hide();
			console.error("XWiki Publisher: pull failed", error);
			this.report(`Pulling from XWiki failed: ${errorMessage(error)}`, true);
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
			const { counts, converted } = await this.sync.pullSpace(
				client,
				root,
				(message) => {
					notice.setMessage(message);
					this.progress(message);
				},
				() => this.cancelRequested,
			);
			notice.hide();
			const parts = [
				`${counts.created} imported`,
				`${counts.updated} updated`,
				`${counts.unchanged} unchanged`,
				counts.conflict > 0 ? `${counts.conflict} conflict(s)` : "",
				converted > 0 ? `${converted} converted from XWiki syntax` : "",
				counts.missing > 0 ? `${counts.missing} failed` : "",
				counts.cancelled > 0 ? `${counts.cancelled} not processed (cancelled)` : "",
			].filter(Boolean);
			this.report(`XWiki sync of "${root.join(".")}" finished: ${parts.join(", ")}.`, counts.conflict > 0 || counts.missing > 0, 10000);
		} catch (error) {
			notice.hide();
			console.error("XWiki Publisher: space sync failed", error);
			this.report(`Syncing from XWiki failed: ${errorMessage(error)}`, true);
		}
	}
}

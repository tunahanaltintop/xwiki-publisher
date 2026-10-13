import { ButtonComponent, debounce, ItemView, Keymap, setIcon, Setting, setTooltip, TFile, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { FM_PAGE, FM_REFERENCE, FM_SPACE, FM_SYNTAX, FM_TITLE, FM_URL, folderForNote, pageDisplayName } from "./location";
import type XWikiPublisherPlugin from "./main";
import type { NoteChange } from "./main";

export const VIEW_TYPE_XWIKI = "xwiki-publisher-panel";

type PanelTab = "actions" | "changes";

/** A vault folder in the folder view of the source control tab, with the changed notes below it. */
interface ChangeFolder {
	name: string;
	path: string;
	folders: Map<string, ChangeFolder>;
	changes: NoteChange[];
	/** The folder's own folder note, when it changed: shown on the folder's row, not as a note below it. */
	note?: NoteChange;
}

const STATUS_LETTER: Record<NoteChange["status"], string> = { added: "A", modified: "M" };
const STATUS_TOOLTIP: Record<NoteChange["status"], string> = {
	added: "Added: not published to XWiki yet",
	modified: "Modified since the last publish or pull",
};

/** Right sidebar panel with every XWiki Publisher action and the fields they need. */
export class XWikiPanelView extends ItemView {
	/** Last Markdown note the user worked on; kept while the panel itself has focus. */
	private file: TFile | null = null;
	private importInput = "";
	private spaceInput: string;
	private folderInput = "";
	private connectionText = "";
	private remoteText: { path: string; text: string } | null = null;
	private renderPending = false;
	/** Property write started from a field of the panel; actions wait for it so they use the new value. */
	private pendingWrite: Promise<void> = Promise.resolve();
	private readonly requestRender = debounce(() => this.render(), 150, true);
	private tab: PanelTab = "actions";
	/** Source control tab: changed notes below their folders, or one flat list. */
	private folderView = true;
	/** Notes with local changes, from the last scan of the vault; `null` until the first scan ends. */
	private changes: NoteChange[] | null = null;
	/** Whether the vault changed since the last scan; scans run only while the source control tab is shown. */
	private changesStale = true;
	private scanId = 0;
	/** Paths of the notes selected for publishing. */
	private readonly selected = new Set<string>();
	/** Collapsed rows of the source control tree: folder paths, and "" for the Changes root. */
	private readonly collapsed = new Set<string>();
	private readonly requestScan = debounce(
		() => {
			this.changesStale = true;
			if (this.tab === "changes") void this.scan();
		},
		300,
		true,
	);

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: XWikiPublisherPlugin,
	) {
		super(leaf);
		this.spaceInput = plugin.settings.defaultSpace;
	}

	getViewType(): string {
		return VIEW_TYPE_XWIKI;
	}

	getDisplayText(): string {
		return "XWiki";
	}

	getIcon(): string {
		return "book-open";
	}

	getState(): Record<string, unknown> {
		return { ...super.getState(), tab: this.tab, folderView: this.folderView };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const { tab, folderView } = (state ?? {}) as { tab?: unknown; folderView?: unknown };
		if (tab === "actions" || tab === "changes") this.tab = tab;
		if (typeof folderView === "boolean") this.folderView = folderView;
		await super.setState(state, result);
		this.showTab(this.tab);
	}

	async onOpen(): Promise<void> {
		this.trackActiveFile();
		this.registerEvent(
			this.app.workspace.on("file-open", () => {
				this.trackActiveFile();
				this.requestRender();
			}),
		);
		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				if (file.path === this.file?.path) this.requestRender();
			}),
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (this.selected.delete(oldPath)) this.selected.add(file.path);
				if (file === this.file) this.requestRender();
				this.requestScan();
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file === this.file) {
					this.file = null;
					this.requestRender();
				}
				this.requestScan();
			}),
		);
		this.registerEvent(this.app.vault.on("create", () => this.requestScan()));
		this.registerEvent(this.app.vault.on("modify", () => this.requestScan()));
		this.register(
			this.plugin.onChange(() => {
				this.requestRender();
				// Publishing and pulling change the sync state, which decides what counts as a change.
				this.requestScan();
			}),
		);
		// Re-rendering while the user types would steal focus: wait until the field is left.
		this.registerDomEvent(this.contentEl, "focusout", () => {
			if (this.renderPending) window.setTimeout(() => this.render(), 0);
		});
		this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	private trackActiveFile(): void {
		const active = this.app.workspace.getActiveFile();
		if (active && active.extension === "md") this.file = active;
	}

	private isEditing(): boolean {
		const focused = document.activeElement;
		return focused instanceof HTMLInputElement && focused.type !== "checkbox" && this.contentEl.contains(focused);
	}

	private showTab(tab: PanelTab): void {
		const switched = tab !== this.tab;
		this.tab = tab;
		this.render();
		if (switched) {
			this.contentEl.scrollTop = 0;
			this.app.workspace.requestSaveLayout();
		}
		if (tab === "changes" && this.changesStale) void this.scan();
	}

	/** Looks for notes with local changes and shows them; a newer scan replaces the result of an older one. */
	private async scan(): Promise<void> {
		const id = ++this.scanId;
		this.changesStale = false;
		const changes = await this.plugin.localChanges();
		if (id !== this.scanId) return;
		this.changes = changes;
		const paths = new Set(changes.map((change) => change.file.path));
		for (const path of [...this.selected]) if (!paths.has(path)) this.selected.delete(path);
		this.requestRender();
	}

	private render(): void {
		if (this.isEditing()) {
			this.renderPending = true;
			return;
		}
		this.renderPending = false;

		const el = this.contentEl;
		// Selecting a note rebuilds the panel; keep the list where the user scrolled it.
		const scroll = el.scrollTop;
		el.empty();
		el.addClass("xwiki-panel");

		this.renderTabs(el);
		if (this.plugin.busy) {
			const busy = el.createDiv({ cls: "xwiki-panel-busy" });
			busy.createSpan({ text: this.plugin.busy });
			if (this.plugin.cancellable) {
				const cancel = busy.createEl("button", { text: "Cancel", cls: "xwiki-panel-cancel" });
				cancel.addEventListener("click", () => this.plugin.cancel());
			}
		}

		if (this.tab === "changes") {
			this.renderChanges(el);
			this.renderActivity(el);
		} else {
			this.renderConnection(el);
			this.renderNote(el);
			this.renderPublishFolder(el);
			this.renderImport(el);
			this.renderSync(el);
			this.renderActivity(el);
		}
		el.scrollTop = scroll;
	}

	private renderTabs(el: HTMLElement): void {
		const tabs = el.createDiv({ cls: "xwiki-panel-tabs" });
		const tab = (id: PanelTab, label: string, icon: string) => {
			const button = tabs.createEl("button", { cls: "xwiki-panel-tab" });
			setIcon(button.createSpan({ cls: "xwiki-panel-tab-icon" }), icon);
			button.createSpan({ text: label });
			button.toggleClass("is-active", this.tab === id);
			button.setAttr("aria-pressed", String(this.tab === id));
			button.addEventListener("click", () => this.showTab(id));
		};
		tab("actions", "XWiki", "book-open");
		tab("changes", "Source control", "git-compare");
	}

	/** Selects or deselects the notes at `paths`, and shows the new selection. */
	private select(paths: string[], selected: boolean): void {
		for (const path of paths) {
			if (selected) this.selected.add(path);
			else this.selected.delete(path);
		}
		this.render();
	}

	/** Shows whether all, some (indeterminate) or none of the notes at `paths` are selected. */
	private selectionBox(parent: HTMLElement, paths: string[], label: string): HTMLInputElement {
		const box = parent.createEl("input", { type: "checkbox", cls: "xwiki-change-check" });
		const count = paths.filter((path) => this.selected.has(path)).length;
		box.checked = count > 0 && count === paths.length;
		box.indeterminate = count > 0 && count < paths.length;
		box.disabled = paths.length === 0;
		box.setAttr("aria-label", label);
		box.addEventListener("click", (event) => event.stopPropagation());
		box.addEventListener("change", () => this.select(paths, box.checked));
		return box;
	}

	private renderChanges(el: HTMLElement): void {
		const changes = this.changes ?? [];
		const paths = changes.map((change) => change.file.path);
		const selected = changes.filter((change) => this.selected.has(change.file.path)).map((change) => change.file);

		const toolbar = el.createDiv({ cls: "xwiki-changes-toolbar" });
		const all = toolbar.createEl("label", { cls: "xwiki-changes-select-all" });
		this.selectionBox(all, paths, "Select all changes");
		all.createSpan({ text: "Select all" });

		const actions = toolbar.createDiv({ cls: "xwiki-changes-actions" });
		const iconButton = (icon: string, tooltip: string, onClick: () => void, active?: boolean) => {
			const button = actions.createDiv({ cls: "clickable-icon" });
			setIcon(button, icon);
			setTooltip(button, tooltip);
			button.setAttr("aria-label", tooltip);
			if (active !== undefined) {
				button.toggleClass("is-active", active);
				button.setAttr("aria-pressed", String(active));
			}
			button.addEventListener("click", onClick);
		};
		iconButton("folder-tree", "Folder view", () => {
			this.folderView = !this.folderView;
			this.app.workspace.requestSaveLayout();
			this.render();
		}, this.folderView);
		iconButton("refresh-cw", "Refresh", () => void this.scan());
		const publish = actions.createEl("button", { cls: "mod-cta", text: selected.length > 0 ? `Publish (${selected.length})` : "Publish" });
		publish.disabled = selected.length === 0 || this.plugin.busy !== null;
		publish.addEventListener("click", () => void this.plugin.publishNotes(selected));

		if (this.changes === null) {
			el.createDiv({ cls: "xwiki-panel-hint", text: "Looking for changes…" });
			return;
		}

		const tree = el.createDiv({ cls: "xwiki-changes" });
		const root = this.changeRow(tree, 0, "", "Changes");
		root.addClass("xwiki-change-root");
		root.createSpan({ cls: "xwiki-change-count", text: String(changes.length) });
		if (this.collapsed.has("")) return;
		if (changes.length === 0) {
			tree.createDiv({ cls: "xwiki-panel-hint xwiki-changes-empty", text: "No local changes: every note is in sync with XWiki." });
			return;
		}
		if (this.folderView) this.renderFolder(tree, this.folderTree(changes), 1);
		else for (const change of changes) this.renderChange(tree, change, 1, true);
	}

	/** Groups the changes by vault folder, for the folder view. */
	private folderTree(changes: NoteChange[]): ChangeFolder {
		const root: ChangeFolder = { name: "", path: "", folders: new Map(), changes: [] };
		const folderAt = (path: string): ChangeFolder => {
			let folder = root;
			const parts = path ? path.split("/") : [];
			for (const [i, name] of parts.entries()) {
				let child = folder.folders.get(name);
				if (!child) {
					child = { name, path: parts.slice(0, i + 1).join("/"), folders: new Map(), changes: [] };
					folder.folders.set(name, child);
				}
				folder = child;
			}
			return folder;
		};
		for (const change of changes) {
			const { file } = change;
			// A folder note stands for its folder, as in the file explorer, wherever the layout stores it.
			const ownFolder = this.plugin.folderNotes.isFolderNote(file) ? folderForNote(file.path, this.plugin.settings) : null;
			if (ownFolder) folderAt(ownFolder).note = change;
			else folderAt(file.parent && !file.parent.isRoot() ? file.parent.path : "").changes.push(change);
		}
		return root;
	}

	private notesIn(folder: ChangeFolder): string[] {
		return [
			...(folder.note ? [folder.note.file.path] : []),
			...[...folder.folders.values()].flatMap((child) => this.notesIn(child)),
			...folder.changes.map((change) => change.file.path),
		];
	}

	/** Folders first, then notes, each sorted by name. */
	private renderFolder(tree: HTMLElement, folder: ChangeFolder, depth: number): void {
		const folders = [...folder.folders.values()].sort((a, b) => a.name.localeCompare(b.name));
		for (const child of folders) {
			const row = this.changeRow(tree, depth, child.path, child.name, this.notesIn(child));
			setTooltip(row, child.note ? child.note.file.path : child.path);
			const note = this.plugin.folderNotes.noteOf(child.path);
			if (note) this.openOnClick(row, note);
			if (child.note) this.statusBadge(row, child.note.status);
			if (!this.collapsed.has(child.path)) this.renderFolder(tree, child, depth + 1);
		}
		const notes = [...folder.changes].sort((a, b) => a.file.basename.localeCompare(b.file.basename));
		for (const change of notes) this.renderChange(tree, change, depth, false);
	}

	/**
	 * A collapsible row of the tree: the Changes root or a folder; `key` remembers whether it is collapsed.
	 * With `notes`, the row has a selection box for the notes below it. Selecting the row expands or collapses it,
	 * unless it opens a folder note (`openOnClick`); the arrow always does.
	 */
	private changeRow(tree: HTMLElement, depth: number, key: string, name: string, notes?: string[]): HTMLElement {
		const collapsed = this.collapsed.has(key);
		const row = tree.createDiv({ cls: "xwiki-change-row xwiki-change-folder" });
		row.setCssProps({ "--xwiki-depth": String(depth) });
		row.toggleClass("is-collapsed", collapsed);
		row.setAttr("aria-expanded", String(!collapsed));
		const toggle = () => {
			if (collapsed) this.collapsed.delete(key);
			else this.collapsed.add(key);
			this.render();
		};
		const chevron = row.createSpan({ cls: "xwiki-change-chevron" });
		setIcon(chevron, "chevron-down");
		chevron.addEventListener("click", (event) => {
			event.stopPropagation();
			toggle();
		});
		if (notes) this.selectionBox(row, notes, `Select the changes in ${key}`);
		row.createSpan({ cls: "xwiki-change-name", text: name });
		row.addEventListener("click", () => {
			if (!row.hasClass("xwiki-has-note")) toggle();
		});
		return row;
	}

	/** Opens `file` when the row is selected; with Ctrl/Cmd in a new tab. */
	private openOnClick(row: HTMLElement, file: TFile): void {
		row.addClass("xwiki-has-note");
		row.toggleClass("is-active", file === this.file);
		row.addEventListener("click", (event) => void this.app.workspace.getLeaf(Keymap.isModEvent(event)).openFile(file));
	}

	private statusBadge(row: HTMLElement, status: NoteChange["status"]): void {
		const badge = row.createSpan({ cls: `xwiki-change-status mod-${status}`, text: STATUS_LETTER[status] });
		setTooltip(badge, STATUS_TOOLTIP[status]);
	}

	/** A changed note: selection box, name, its folder in the flat list, and its status letter. Selecting it opens the note. */
	private renderChange(tree: HTMLElement, change: NoteChange, depth: number, showFolder: boolean): void {
		const { file, status } = change;
		const row = tree.createDiv({ cls: "xwiki-change-row xwiki-change-note" });
		row.setCssProps({ "--xwiki-depth": String(depth) });
		row.createSpan({ cls: "xwiki-change-chevron" });
		this.selectionBox(row, [file.path], `Select ${file.path}`);
		row.createSpan({ cls: "xwiki-change-name", text: file.basename });
		if (showFolder && file.parent && !file.parent.isRoot()) row.createSpan({ cls: "xwiki-change-folder-path", text: file.parent.path });
		this.statusBadge(row, status);
		setTooltip(row, file.path);
		this.openOnClick(row, file);
	}

	private button(setting: Setting, label: string, onClick: () => unknown, options: { cta?: boolean; icon?: string } = {}): void {
		setting.addButton((button: ButtonComponent) => {
			button.setButtonText(label).setDisabled(this.plugin.busy !== null).onClick(() => void onClick());
			if (options.icon) button.setIcon(options.icon).setTooltip(label);
			if (options.cta) button.setCta();
		});
	}

	private renderConnection(el: HTMLElement): void {
		new Setting(el).setName("Connection").setHeading();
		const { baseUrl, wiki } = this.plugin.settings;
		const setting = new Setting(el)
			.setName(baseUrl ? baseUrl.replace(/^https?:\/\//, "") : "Not configured")
			.setDesc(this.connectionText || (baseUrl ? `Wiki: ${wiki}` : "Set the XWiki URL and token in the settings."));
		this.button(setting, "Test", async () => {
			this.connectionText = "Testing…";
			this.render();
			try {
				const { user } = await this.plugin.createClient().testConnection();
				this.connectionText = user ? `Connected as ${user}` : "Reachable; user could not be verified";
				if (/^http:\/\//i.test(this.plugin.settings.baseUrl)) this.connectionText += ". Warning: plain HTTP sends the token unencrypted";
			} catch (error) {
				this.connectionText = error instanceof Error ? error.message : String(error);
			}
			this.render();
		});
		this.button(setting, "Settings", () => this.openSettings(), { icon: "settings" });
	}

	private openSettings(): void {
		// The settings modal is not part of the public API; fall back to the command palette when unavailable.
		const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
		if (setting) {
			setting.open();
			setting.openTabById(this.plugin.manifest.id);
		}
	}

	private renderNote(el: HTMLElement): void {
		new Setting(el).setName("Current note").setHeading();
		const file = this.file;
		if (!file) {
			el.createDiv({ cls: "xwiki-panel-hint", text: "Open a Markdown note to publish or pull it." });
			return;
		}

		const location = this.plugin.locate(file);
		new Setting(el).setName(file.basename).setDesc(`Target: ${this.plugin.targetReference(file)}`);

		const status = el.createDiv({ cls: "xwiki-panel-status", text: "Checking sync state…" });
		void this.plugin.localStatus(file).then(({ synced, version, localChanges }) => {
			status.setText(
				!synced
					? "Not synced with XWiki yet."
					: localChanges
						? `Local changes not published (last sync: version ${version}).`
						: `In sync with XWiki version ${version}.`,
			);
			status.toggleClass("mod-warning", synced && localChanges);
		});
		const originalSyntax: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.[FM_SYNTAX];
		if (typeof originalSyntax === "string" && originalSyntax) {
			el.createDiv({
				cls: "xwiki-panel-status mod-warning",
				text: this.plugin.settings.preserveMacros
					? `Converted from ${originalSyntax}. Publishing turns the XWiki page into Markdown; macros in the note are kept, other XWiki-only formatting is lost.`
					: `Converted from ${originalSyntax}. Publishing turns the XWiki page into Markdown; macros on it will be lost.`,
			});
		}
		if (this.remoteText?.path === file.path) {
			el.createDiv({ cls: "xwiki-panel-status", text: this.remoteText.text });
		}

		const actions = new Setting(el).setClass("xwiki-panel-actions");
		this.button(actions, "Publish", async () => {
			await this.pendingWrite;
			await this.plugin.publish(file);
		}, { cta: true });
		this.button(actions, "Pull", async () => {
			await this.pendingWrite;
			await this.plugin.pullNote(file);
		});
		this.button(actions, "Check XWiki", async () => {
			this.remoteText = { path: file.path, text: "Checking XWiki…" };
			this.render();
			try {
				this.remoteText = { path: file.path, text: await this.plugin.checkRemote(file) };
			} catch (error) {
				this.remoteText = { path: file.path, text: error instanceof Error ? error.message : String(error) };
			}
			this.render();
		});
		const url: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.[FM_URL];
		if (typeof url === "string" && url) {
			this.button(actions, "Open in browser", () => window.open(url), { icon: "external-link" });
		}

		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const field = (name: string, key: string, placeholder: string, desc: string) => {
			const value: unknown = fm?.[key];
			const current = typeof value === "string" ? value : "";
			new Setting(el)
				.setName(name)
				.setDesc(desc)
				.addText((text) => {
					text.setPlaceholder(placeholder).setValue(current);
					// Save when the field is left or Enter is pressed, not on every keystroke.
					text.inputEl.addEventListener("change", () => {
						if (text.getValue().trim() !== current) this.pendingWrite = this.plugin.setNoteProperty(file, key, text.getValue());
					});
				});
		};
		if (typeof fm?.[FM_REFERENCE] === "string") {
			// Pulled notes are pinned to their page; the reference wins over space and page name.
			field("Page reference", FM_REFERENCE, this.plugin.targetReference(file), "XWiki page this note is linked to. Clear it to use the space and folder rules.");
			field("Page title", FM_TITLE, file.basename, "Title shown on XWiki.");
			return;
		}
		field("XWiki space", FM_SPACE, location.spaces.slice(0, location.page === "WebHome" ? -1 : undefined).join(".") || "Main", "Overrides the default space and folders for this note.");
		field("Page name", FM_PAGE, pageDisplayName(location), "Defaults to the note name.");
		field("Page title", FM_TITLE, file.basename, "Title shown on XWiki.");
	}

	private renderPublishFolder(el: HTMLElement): void {
		new Setting(el).setName("Publish folder").setHeading();
		const setting = new Setting(el).setClass("xwiki-panel-field").addText((text) =>
			text
				.setPlaceholder("Vault folder path")
				.setValue(this.folderInput)
				.onChange((value) => (this.folderInput = value)),
		);
		this.button(setting, "Publish", () => this.plugin.publishFolder(this.folderInput.trim() || undefined));
		el.createDiv({
			cls: "xwiki-panel-hint",
			text: "Publishes every note in the folder and its subfolders. Leave the field empty to choose the folder.",
		});
	}

	private renderImport(el: HTMLElement): void {
		new Setting(el).setName("Import page").setHeading();
		const setting = new Setting(el).setClass("xwiki-panel-field").addText((text) =>
			text
				.setPlaceholder("Page URL or Space.Page")
				.setValue(this.importInput)
				.onChange((value) => (this.importInput = value)),
		);
		this.button(setting, "Import", async () => {
			await this.plugin.importPage(this.importInput.trim() || undefined);
		});
	}

	private renderSync(el: HTMLElement): void {
		new Setting(el).setName("Sync space").setHeading();
		const setting = new Setting(el).setClass("xwiki-panel-field").addText((text) =>
			text
				.setPlaceholder("Folder page URL or Docs.Team")
				.setValue(this.spaceInput)
				.onChange((value) => (this.spaceInput = value)),
		);
		this.button(setting, "Sync", () => this.plugin.syncSpace(this.spaceInput.trim() || undefined));
		el.createDiv({
			cls: "xwiki-panel-hint",
			text: this.plugin.settings.syncFolder
				? `The XWiki page tree is recreated in "${this.plugin.settings.syncFolder}".`
				: "The XWiki page tree is recreated at the vault root.",
		});
	}

	private renderActivity(el: HTMLElement): void {
		new Setting(el).setName("Recent activity").setHeading();
		if (this.plugin.activity.length === 0) {
			el.createDiv({ cls: "xwiki-panel-hint", text: "Nothing yet." });
			return;
		}
		const list = el.createEl("ul", { cls: "xwiki-panel-activity" });
		for (const entry of this.plugin.activity) {
			const item = list.createEl("li", { cls: entry.error ? "mod-error" : "" });
			item.createSpan({ cls: "xwiki-panel-time", text: new Date(entry.time).toLocaleTimeString() });
			item.createSpan({ text: entry.message });
		}
	}
}

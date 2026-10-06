import { debounce, Keymap, Menu, normalizePath, Notice, TAbstractFile, TFile, TFolder } from "obsidian";
import { folderForNote, folderNotePath } from "./location";
import type XWikiPublisherPlugin from "./main";

/** Class of file explorer items that are hidden because they are folder notes. */
const HIDDEN = "xwiki-folder-note-hidden";
/** Class of file explorer folders that have a folder note. */
const HAS_NOTE = "xwiki-has-folder-note";

/**
 * Built-in folder notes: selecting a folder in the file explorer opens its folder note, folder notes are hidden from
 * the explorer, and they follow their folder when it is renamed. The layout (inside the folder or next to it, and the
 * file name template) is the same one used by sync, and matches the Folder notes community plugin.
 *
 * The file explorer has no public API for this, so it works on its DOM, like other folder note plugins: folder rows
 * are `.nav-folder-title[data-path]`, file rows `.nav-file-title[data-path]`.
 */
export class FolderNotes {
	private readonly observed = new WeakSet<HTMLElement>();
	private readonly requestDecorate = debounce(() => this.decorate(), 100, true);

	constructor(private readonly plugin: XWikiPublisherPlugin) {}

	private get app() {
		return this.plugin.app;
	}

	private get settings() {
		return this.plugin.settings;
	}

	register(): void {
		const { plugin } = this;
		// Capture phase: runs before the explorer's own handler, which would only expand or collapse the folder.
		plugin.registerDomEvent(document, "click", (evt) => this.onClick(evt), true);
		plugin.registerEvent(this.app.workspace.on("layout-change", () => this.watchExplorers()));
		plugin.registerEvent(this.app.vault.on("create", () => this.requestDecorate()));
		plugin.registerEvent(this.app.vault.on("delete", () => this.requestDecorate()));
		plugin.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				this.followFolderRename(file, oldPath);
				this.requestDecorate();
			}),
		);
		plugin.registerEvent(this.app.workspace.on("file-menu", (menu, file) => this.addMenuItems(menu, file)));
		this.app.workspace.onLayoutReady(() => this.watchExplorers());
		plugin.register(() => this.undecorate());
	}

	/** Folder note of a folder, if it exists. */
	noteOf(folderPath: string): TFile | null {
		return this.app.vault.getFileByPath(normalizePath(folderNotePath(folderPath, this.settings)));
	}

	/** Whether the file is the folder note of an existing folder. */
	isFolderNote(file: TAbstractFile): boolean {
		if (!(file instanceof TFile)) return false;
		const folder = folderForNote(file.path, this.settings);
		return folder !== null && this.app.vault.getFolderByPath(folder) !== null;
	}

	private onClick(evt: MouseEvent): void {
		if (!this.settings.openFolderNotes || !(evt.target instanceof HTMLElement)) return;
		// The arrow still expands and collapses the folder.
		if (evt.target.closest(".collapse-icon")) return;
		const title = evt.target.closest(".nav-folder-title");
		const path = title?.getAttribute("data-path");
		if (!path) return;
		const note = this.noteOf(path);
		if (!note) return;
		evt.preventDefault();
		evt.stopImmediatePropagation();
		void this.app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(note);
	}

	/** Re-decorates the file explorers whenever their content is re-rendered. */
	private watchExplorers(): void {
		for (const leaf of this.app.workspace.getLeavesOfType("file-explorer")) {
			const container = leaf.view.containerEl;
			if (this.observed.has(container)) continue;
			this.observed.add(container);
			const observer = new MutationObserver(() => this.requestDecorate());
			observer.observe(container, { childList: true, subtree: true });
			this.plugin.register(() => observer.disconnect());
		}
		this.requestDecorate();
	}

	private explorerItems(selector: string): HTMLElement[] {
		return this.app.workspace
			.getLeavesOfType("file-explorer")
			.flatMap((leaf) => Array.from(leaf.view.containerEl.querySelectorAll<HTMLElement>(selector)));
	}

	/** Marks folders that have a folder note and hides the folder notes themselves. */
	private decorate(): void {
		for (const title of this.explorerItems(".nav-folder-title[data-path]")) {
			const path = title.getAttribute("data-path") ?? "";
			title.toggleClass(HAS_NOTE, this.settings.openFolderNotes && this.noteOf(path) !== null);
		}
		for (const title of this.explorerItems(".nav-file-title[data-path]")) {
			const file = this.app.vault.getFileByPath(title.getAttribute("data-path") ?? "");
			const hide = this.settings.hideFolderNotes && file !== null && this.isFolderNote(file);
			(title.parentElement ?? title).toggleClass(HIDDEN, hide);
		}
	}

	private undecorate(): void {
		for (const el of this.explorerItems(`.${HAS_NOTE}, .${HIDDEN}`)) el.removeClass(HAS_NOTE, HIDDEN);
	}

	/** Settings changed: apply them to the explorer right away. */
	refresh(): void {
		this.decorate();
	}

	/**
	 * Renames or moves a folder's note when the user renames or moves the folder, so it stays its folder note.
	 * Moves made by a sync are left alone: the sync places folder notes itself.
	 */
	private followFolderRename(file: TAbstractFile, oldPath: string): void {
		if (!(file instanceof TFolder) || !this.settings.renameFolderNotes || this.plugin.busy) return;
		const oldNotePath = normalizePath(folderNotePath(oldPath, this.settings));
		// Inside the folder the note moved along with it; next to the folder it stayed where it was.
		const current =
			this.settings.folderNoteLocation === "inside" ? `${file.path}/${oldNotePath.slice(oldNotePath.lastIndexOf("/") + 1)}` : oldNotePath;
		const target = normalizePath(folderNotePath(file.path, this.settings));
		if (current === target) return;
		// Wait for the folder rename to finish before touching its content.
		window.setTimeout(() => {
			const note = this.app.vault.getFileByPath(current);
			if (!note || this.app.vault.getAbstractFileByPath(target)) return;
			void this.app.fileManager.renameFile(note, target);
		}, 0);
	}

	private addMenuItems(menu: Menu, file: TAbstractFile): void {
		if (!(file instanceof TFolder) || file.isRoot()) return;
		const note = this.noteOf(file.path);
		if (note) {
			menu.addItem((item) =>
				item
					.setTitle("Open folder note")
					.setIcon("file-text")
					.onClick(() => void this.app.workspace.getLeaf(false).openFile(note)),
			);
			return;
		}
		menu.addItem((item) =>
			item
				.setTitle("Create folder note")
				.setIcon("file-plus")
				.onClick(() => void this.createNote(file)),
		);
	}

	private async createNote(folder: TFolder): Promise<void> {
		const path = normalizePath(folderNotePath(folder.path, this.settings));
		if (this.app.vault.getAbstractFileByPath(path)) {
			new Notice(`"${path}" already exists.`);
			return;
		}
		const note = await this.app.vault.create(path, "");
		await this.app.workspace.getLeaf(false).openFile(note);
		this.requestDecorate();
	}
}

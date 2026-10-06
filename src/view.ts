import { ButtonComponent, debounce, ItemView, Setting, TFile, WorkspaceLeaf } from "obsidian";
import { FM_PAGE, FM_REFERENCE, FM_SPACE, FM_SYNTAX, FM_TITLE, FM_URL, pageDisplayName } from "./location";
import type XWikiPublisherPlugin from "./main";

export const VIEW_TYPE_XWIKI = "xwiki-publisher-panel";

/** Right sidebar panel with every XWiki Publisher action and the fields they need. */
export class XWikiPanelView extends ItemView {
	/** Last Markdown note the user worked on; kept while the panel itself has focus. */
	private file: TFile | null = null;
	private importInput = "";
	private spaceInput: string;
	private connectionText = "";
	private remoteText: { path: string; text: string } | null = null;
	private renderPending = false;
	/** Property write started from a field of the panel; actions wait for it so they use the new value. */
	private pendingWrite: Promise<void> = Promise.resolve();
	private readonly requestRender = debounce(() => this.render(), 150, true);

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
			this.app.vault.on("rename", (file) => {
				if (file === this.file) this.requestRender();
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file === this.file) {
					this.file = null;
					this.requestRender();
				}
			}),
		);
		this.register(this.plugin.onChange(() => this.requestRender()));
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
		return focused instanceof HTMLInputElement && this.contentEl.contains(focused);
	}

	private render(): void {
		if (this.isEditing()) {
			this.renderPending = true;
			return;
		}
		this.renderPending = false;

		const el = this.contentEl;
		el.empty();
		el.addClass("xwiki-panel");

		if (this.plugin.busy) {
			const busy = el.createDiv({ cls: "xwiki-panel-busy" });
			busy.createSpan({ text: this.plugin.busy });
			if (this.plugin.cancellable) {
				const cancel = busy.createEl("button", { text: "Cancel", cls: "xwiki-panel-cancel" });
				cancel.addEventListener("click", () => this.plugin.cancel());
			}
		}

		this.renderConnection(el);
		this.renderNote(el);
		this.renderImport(el);
		this.renderSync(el);
		this.renderActivity(el);
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
			const current = typeof fm?.[key] === "string" ? (fm[key] as string) : "";
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

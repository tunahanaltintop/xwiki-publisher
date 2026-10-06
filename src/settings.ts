import { App, ButtonComponent, normalizePath, Notice, PluginSettingTab, SecretComponent, Setting, SettingDefinitionItem } from "obsidian";
import type XWikiPublisherPlugin from "./main";
import type { FolderNoteLocation } from "./location";
import type { AuthScheme } from "./xwiki-client";

export interface XWikiPublisherSettings {
	baseUrl: string;
	wiki: string;
	/** ID of the secret in Obsidian's secret storage that holds the XWiki token. */
	tokenSecretId: string;
	authScheme: AuthScheme;
	username: string;
	headerName: string;
	defaultSpace: string;
	mirrorFolders: boolean;
	/** Create an empty XWiki page for each mirrored folder that has no page yet. */
	createFolderPages: boolean;
	nestedPages: boolean;
	syntax: string;
	uploadAttachments: boolean;
	writeUrlToFrontmatter: boolean;
	/** Vault folder mirroring the XWiki page tree; empty for the vault root. */
	syncFolder: string;
	/**
	 * Convert XWiki syntax pages from their source and keep their macros, instead of converting the rendered page
	 * where macros appear as their output.
	 */
	preserveMacros: boolean;
	/** Subfolder next to each pulled note for its attachments; empty to follow Obsidian's attachment setting. */
	attachmentFolder: string;
	/** Folder note layout, matching the Folder notes plugin. */
	folderNoteLocation: FolderNoteLocation;
	/** Folder note file name template, as in the Folder notes plugin. */
	folderNoteName: string;
}

export const DEFAULT_SETTINGS: XWikiPublisherSettings = {
	baseUrl: "",
	wiki: "xwiki",
	tokenSecretId: "",
	authScheme: "bearer",
	username: "",
	headerName: "Authorization",
	defaultSpace: "Obsidian",
	mirrorFolders: true,
	createFolderPages: true,
	nestedPages: true,
	syntax: "markdown/1.2",
	uploadAttachments: true,
	writeUrlToFrontmatter: true,
	syncFolder: "",
	preserveMacros: false,
	attachmentFolder: "assets",
	folderNoteLocation: "inside",
	folderNoteName: "{{folder_name}}",
};

/** One row of the settings tab, rendered through the declarative settings API. */
interface SettingRow {
	name: string;
	desc?: string | DocumentFragment;
	/** Shown only while this returns true; re-evaluated by `update()`. */
	visible?: () => boolean;
	/** Adds the row's controls; the return value is ignored. */
	build: (setting: Setting) => unknown;
}

interface SettingSection {
	heading?: string;
	rows: SettingRow[];
}

export class XWikiPublisherSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: XWikiPublisherPlugin) {
		super(app, plugin);
	}

	/** Declarative settings, which also makes them findable in Obsidian's settings search. */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return this.sections().map((section) => ({
			type: "group",
			heading: section.heading,
			items: section.rows.map((row) => ({ name: row.name, desc: row.desc, visible: row.visible, render: (setting: Setting) => {
				row.build(setting);
			} })),
		}));
	}

	/** Re-renders after a change that shows or hides rows. */
	private refresh(): void {
		this.update();
	}

	private save(): Promise<void> {
		return this.plugin.saveSettings();
	}

	private sections(): SettingSection[] {
		const settings = this.plugin.settings;

		const folderNotesIntro = createFragment((fragment) => {
			fragment.appendText("Where the folder note of a folder is stored. Pages with children are written as folder notes; match this with the ");
			fragment.createEl("a", { text: "Folder notes", href: "https://github.com/LostPaul/obsidian-folder-notes" });
			fragment.appendText(" plugin.");
		});

		return [
			{
				rows: [
					{
						name: "XWiki URL",
						desc: "Base URL of your XWiki instance. Use HTTPS: the token is sent with every request.",
						build: (setting) =>
							setting.addText((text) =>
								text
									.setPlaceholder("https://wiki.example.com/xwiki")
									.setValue(settings.baseUrl)
									.onChange((value) => {
										settings.baseUrl = value.trim();
										void this.save();
									}),
							),
					},
					{
						name: "Wiki",
						desc: "Wiki identifier. Keep the default for the main wiki.",
						build: (setting) =>
							setting.addText((text) =>
								text.setValue(settings.wiki).onChange((value) => {
									settings.wiki = value.trim() || DEFAULT_SETTINGS.wiki;
									void this.save();
								}),
							),
					},
					{
						name: "Token",
						desc: "XWiki access token. It is kept in Obsidian's secret storage, not in the plugin data file.",
						build: (setting) =>
							setting.addComponent((el) =>
								new SecretComponent(this.app, el).setValue(settings.tokenSecretId).onChange((value) => {
									settings.tokenSecretId = value;
									void this.save();
								}),
							),
					},
					{
						name: "Authentication method",
						desc: "How the token is sent to XWiki.",
						build: (setting) =>
							setting.addDropdown((dropdown) =>
								dropdown
									.addOption("bearer", "Bearer token")
									.addOption("basic", "Basic (username + token)")
									.addOption("header", "Custom header")
									.setValue(settings.authScheme)
									.onChange((value) => {
										settings.authScheme = value as AuthScheme;
										void this.save();
										this.refresh();
									}),
							),
					},
					{
						name: "Username",
						visible: () => settings.authScheme === "basic",
						build: (setting) =>
							setting.addText((text) =>
								text.setValue(settings.username).onChange((value) => {
									settings.username = value.trim();
									void this.save();
								}),
							),
					},
					{
						name: "Header name",
						desc: "The raw token is sent as the value of this header.",
						visible: () => settings.authScheme === "header",
						build: (setting) =>
							setting.addText((text) =>
								text.setValue(settings.headerName).onChange((value) => {
									settings.headerName = value.trim();
									void this.save();
								}),
							),
					},
					{
						name: "Test connection",
						desc: "Checks the token and lists the Markdown syntaxes of the server.",
						build: (setting) => setting.addButton((button) => button.setButtonText("Test").onClick(() => void this.testConnection(button))),
					},
				],
			},
			{
				heading: "Publishing",
				rows: [
					{
						name: "Default space",
						desc: "Space used when a note does not set its own. Separate nested spaces with dots. Leave empty to publish at the wiki root.",
						build: (setting) =>
							setting.addText((text) =>
								text.setValue(settings.defaultSpace).onChange((value) => {
									settings.defaultSpace = value.trim();
									void this.save();
								}),
							),
					},
					{
						name: "Mirror folder structure",
						desc: "Publish notes below the default space following their vault folders. Notes in a folder pulled from XWiki go below that folder's page.",
						build: (setting) =>
							setting.addToggle((toggle) =>
								toggle.setValue(settings.mirrorFolders).onChange((value) => {
									settings.mirrorFolders = value;
									void this.save();
									this.refresh();
								}),
							),
					},
					{
						name: "Create folder pages",
						desc: "Create an empty XWiki page for each folder that has no page yet, so the page tree shows the folder hierarchy.",
						visible: () => settings.mirrorFolders,
						build: (setting) =>
							setting.addToggle((toggle) =>
								toggle.setValue(settings.createFolderPages).onChange((value) => {
									settings.createFolderPages = value;
									void this.save();
								}),
							),
					},
					{
						name: "Use nested pages",
						desc: "Publish each note as a nested page (Space.Note.WebHome) instead of a terminal page (Space.Note).",
						build: (setting) =>
							setting.addToggle((toggle) =>
								toggle.setValue(settings.nestedPages).onChange((value) => {
									settings.nestedPages = value;
									void this.save();
								}),
							),
					},
					{
						name: "Markdown syntax",
						desc: "Syntax identifier provided by the XWiki Markdown extension.",
						build: (setting) =>
							setting.addText((text) =>
								text.setValue(settings.syntax).onChange((value) => {
									settings.syntax = value.trim() || DEFAULT_SETTINGS.syntax;
									void this.save();
								}),
							),
					},
					{
						name: "Upload attachments",
						desc: "Upload embedded images and linked files as attachments of the page.",
						build: (setting) =>
							setting.addToggle((toggle) =>
								toggle.setValue(settings.uploadAttachments).onChange((value) => {
									settings.uploadAttachments = value;
									void this.save();
								}),
							),
					},
					{
						name: "Save page URL in note",
						desc: "Write the published page URL to the properties of the note.",
						build: (setting) =>
							setting.addToggle((toggle) =>
								toggle.setValue(settings.writeUrlToFrontmatter).onChange((value) => {
									settings.writeUrlToFrontmatter = value;
									void this.save();
								}),
							),
					},
				],
			},
			{
				heading: "Sync",
				rows: [
					{
						name: "Sync folder",
						desc: "Folder where the XWiki page tree is recreated. Leave empty to recreate it at the vault root. Pages that came from a note update that note.",
						build: (setting) =>
							setting.addText((text) =>
								text
									.setPlaceholder("Vault root")
									.setValue(settings.syncFolder)
									.onChange((value) => {
										settings.syncFolder = value.trim() ? normalizePath(value.trim()) : "";
										void this.save();
									}),
							),
					},
					{
						name: "Attachment folder",
						desc: "Subfolder, next to each pulled note, where the attachments of its page are saved. Leave empty to use the attachment location set in Obsidian.",
						build: (setting) =>
							setting.addText((text) =>
								text
									.setPlaceholder("Obsidian setting")
									.setValue(settings.attachmentFolder)
									.onChange((value) => {
										settings.attachmentFolder = value.trim().replace(/[\\/]+/g, "-");
										void this.save();
									}),
							),
					},
					{
						name: "Keep XWiki macros",
						desc: "When pulling pages written in XWiki syntax, convert their source and keep macros such as {{toc/}} as they are, so they keep working after publishing. When off, pages are converted as XWiki shows them and macros appear as their output, for example links.",
						build: (setting) =>
							setting.addToggle((toggle) =>
								toggle.setValue(settings.preserveMacros).onChange((value) => {
									settings.preserveMacros = value;
									void this.save();
								}),
							),
					},
				],
			},
			{
				heading: "Folder notes",
				rows: [
					{
						name: "Folder note location",
						desc: folderNotesIntro,
						build: (setting) =>
							setting.addDropdown((dropdown) =>
								dropdown
									.addOption("inside", "Inside the folder")
									.addOption("parent", "Next to the folder")
									.setValue(settings.folderNoteLocation)
									.onChange((value) => {
										settings.folderNoteLocation = value as FolderNoteLocation;
										void this.save();
									}),
							),
					},
					{
						name: "Folder note name",
						desc: "File name of folder notes; {{folder_name}} stands for the folder's name.",
						build: (setting) =>
							setting.addText((text) =>
								text
									.setPlaceholder("{{folder_name}}")
									.setValue(settings.folderNoteName)
									.onChange((value) => {
										settings.folderNoteName = value.trim() || DEFAULT_SETTINGS.folderNoteName;
										void this.save();
									}),
							),
					},
					{
						name: "Use Folder notes settings",
						desc: "Copies the storage location and name of the Folder notes plugin.",
						build: (setting) => {
							setting.addButton((button) =>
								button.setButtonText("Copy").onClick(() => {
									void this.plugin.adoptFolderNotesSettings().then((result) => {
										new Notice(result);
										this.refresh();
									});
								}),
							);
							void this.plugin.folderNotesMismatch().then((mismatch) => {
								if (mismatch) setting.descEl.createDiv({ cls: "xwiki-publisher-warning", text: mismatch });
							});
						},
					},
				],
			},
		];
	}

	private async testConnection(button: ButtonComponent): Promise<void> {
		button.setDisabled(true);
		try {
			const client = this.plugin.createClient();
			const { user } = await client.testConnection();
			let message = user
				? `Connected to XWiki as ${user}.`
				: "XWiki is reachable, but it did not report the user, so the token could not be verified.";
			if (/^http:\/\//i.test(this.plugin.settings.baseUrl)) {
				message += " Warning: the URL uses plain HTTP, so the token is sent unencrypted. Use HTTPS.";
			}
			try {
				const markdown = (await client.getSyntaxes()).filter((s) => s.startsWith("markdown"));
				message += markdown.length > 0 ? ` Markdown syntaxes on the server: ${markdown.join(", ")}.` : " No Markdown syntax parser found on the server.";
			} catch {
				// Syntax listing is informative only.
			}
			new Notice(message, 8000);
		} catch (error) {
			new Notice(`XWiki connection failed: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			button.setDisabled(false);
		}
	}
}

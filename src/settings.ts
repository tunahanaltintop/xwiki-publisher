import { App, normalizePath, Notice, PluginSettingTab, SecretComponent, Setting } from "obsidian";
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

export class XWikiPublisherSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: XWikiPublisherPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const settings = this.plugin.settings;
		containerEl.empty();

		new Setting(containerEl)
			.setName("XWiki URL")
			.setDesc("Base URL of your XWiki instance. Use HTTPS: the token is sent with every request.")
			.addText((text) =>
				text
					.setPlaceholder("https://wiki.example.com/xwiki")
					.setValue(settings.baseUrl)
					.onChange(async (value) => {
						settings.baseUrl = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Wiki")
			.setDesc("Wiki identifier. Keep the default for the main wiki.")
			.addText((text) =>
				text.setValue(settings.wiki).onChange(async (value) => {
					settings.wiki = value.trim() || DEFAULT_SETTINGS.wiki;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Token")
			.setDesc("XWiki access token. It is kept in Obsidian's secret storage, not in the plugin data file.")
			.addComponent((el) =>
				new SecretComponent(this.app, el).setValue(settings.tokenSecretId).onChange(async (value) => {
					settings.tokenSecretId = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Authentication method")
			.setDesc("How the token is sent to XWiki.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("bearer", "Bearer token")
					.addOption("basic", "Basic (username + token)")
					.addOption("header", "Custom header")
					.setValue(settings.authScheme)
					.onChange(async (value) => {
						settings.authScheme = value as AuthScheme;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (settings.authScheme === "basic") {
			new Setting(containerEl).setName("Username").addText((text) =>
				text.setValue(settings.username).onChange(async (value) => {
					settings.username = value.trim();
					await this.plugin.saveSettings();
				}),
			);
		}

		if (settings.authScheme === "header") {
			new Setting(containerEl)
				.setName("Header name")
				.setDesc("The raw token is sent as the value of this header.")
				.addText((text) =>
					text.setValue(settings.headerName).onChange(async (value) => {
						settings.headerName = value.trim();
						await this.plugin.saveSettings();
					}),
				);
		}

		new Setting(containerEl)
			.setName("Test connection")
			.addButton((button) =>
				button.setButtonText("Test").onClick(async () => {
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
							message += markdown.length > 0
								? ` Markdown syntaxes on the server: ${markdown.join(", ")}.`
								: " No Markdown syntax parser found on the server.";
						} catch {
							// Syntax listing is informative only.
						}
						new Notice(message, 8000);
					} catch (error) {
						new Notice(`XWiki connection failed: ${error instanceof Error ? error.message : String(error)}`);
					} finally {
						button.setDisabled(false);
					}
				}),
			);

		new Setting(containerEl).setName("Publishing").setHeading();

		new Setting(containerEl)
			.setName("Default space")
			.setDesc("Space used when a note does not set its own. Separate nested spaces with dots. Leave empty to publish at the wiki root.")
			.addText((text) =>
				text.setValue(settings.defaultSpace).onChange(async (value) => {
					settings.defaultSpace = value.trim();
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Mirror folder structure")
			.setDesc("Publish notes below the default space following their vault folders. Notes in a folder pulled from XWiki go below that folder's page.")
			.addToggle((toggle) =>
				toggle.setValue(settings.mirrorFolders).onChange(async (value) => {
					settings.mirrorFolders = value;
					await this.plugin.saveSettings();
					this.display();
				}),
			);

		if (settings.mirrorFolders) {
			new Setting(containerEl)
				.setName("Create folder pages")
				.setDesc("Create an empty XWiki page for each folder that has no page yet, so the page tree shows the folder hierarchy.")
				.addToggle((toggle) =>
					toggle.setValue(settings.createFolderPages).onChange(async (value) => {
						settings.createFolderPages = value;
						await this.plugin.saveSettings();
					}),
				);
		}

		new Setting(containerEl)
			.setName("Use nested pages")
			.setDesc("Publish each note as a nested page (Space.Note.WebHome) instead of a terminal page (Space.Note).")
			.addToggle((toggle) =>
				toggle.setValue(settings.nestedPages).onChange(async (value) => {
					settings.nestedPages = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Markdown syntax")
			.setDesc("Syntax identifier provided by the XWiki Markdown extension.")
			.addText((text) =>
				text.setValue(settings.syntax).onChange(async (value) => {
					settings.syntax = value.trim() || DEFAULT_SETTINGS.syntax;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Upload attachments")
			.setDesc("Upload embedded images and linked files as attachments of the page.")
			.addToggle((toggle) =>
				toggle.setValue(settings.uploadAttachments).onChange(async (value) => {
					settings.uploadAttachments = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Save page URL in note")
			.setDesc("Write the published page URL to the properties of the note.")
			.addToggle((toggle) =>
				toggle.setValue(settings.writeUrlToFrontmatter).onChange(async (value) => {
					settings.writeUrlToFrontmatter = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName("Sync").setHeading();

		new Setting(containerEl)
			.setName("Sync folder")
			.setDesc(
				"Folder where the XWiki page tree is recreated. Leave empty to recreate it at the vault root. Pages that came from a note update that note.",
			)
			.addText((text) =>
				text
					.setPlaceholder("Vault root")
					.setValue(settings.syncFolder)
					.onChange(async (value) => {
						settings.syncFolder = value.trim() ? normalizePath(value.trim()) : "";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Attachment folder")
			.setDesc(
				"Subfolder, next to each pulled note, where the attachments of its page are saved. Leave empty to use the attachment location set in Obsidian.",
			)
			.addText((text) =>
				text
					.setPlaceholder("Obsidian setting")
					.setValue(settings.attachmentFolder)
					.onChange(async (value) => {
						settings.attachmentFolder = value.trim().replace(/[\\/]+/g, "-");
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Keep XWiki macros")
			.setDesc(
				"When pulling pages written in XWiki syntax, convert their source and keep macros such as {{toc/}} as they are, so they keep working after publishing. When off, pages are converted as XWiki shows them and macros appear as their output, for example links.",
			)
			.addToggle((toggle) =>
				toggle.setValue(settings.preserveMacros).onChange(async (value) => {
					settings.preserveMacros = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName("Folder notes").setHeading();

		const intro = containerEl.createDiv({ cls: "setting-item-description xwiki-publisher-section-intro" });
		intro.appendText("Pages with children are written as folder notes, the note that opens when you select a folder. Match these settings with the ");
		intro.createEl("a", { text: "Folder notes", href: "https://github.com/LostPaul/obsidian-folder-notes" });
		intro.appendText(" plugin.");

		new Setting(containerEl)
			.setName("Folder note location")
			.setDesc("Where the folder note of a folder is stored.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("inside", "Inside the folder")
					.addOption("parent", "Next to the folder")
					.setValue(settings.folderNoteLocation)
					.onChange(async (value) => {
						settings.folderNoteLocation = value as FolderNoteLocation;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Folder note name")
			.setDesc("File name of folder notes; {{folder_name}} stands for the folder's name.")
			.addText((text) =>
				text
					.setPlaceholder("{{folder_name}}")
					.setValue(settings.folderNoteName)
					.onChange(async (value) => {
						settings.folderNoteName = value.trim() || DEFAULT_SETTINGS.folderNoteName;
						await this.plugin.saveSettings();
					}),
			);

		const match = new Setting(containerEl)
			.setName("Use Folder notes settings")
			.setDesc("Copies the storage location and name of the Folder notes plugin.")
			.addButton((button) =>
				button.setButtonText("Copy").onClick(async () => {
					const result = await this.plugin.adoptFolderNotesSettings();
					new Notice(result);
					this.display();
				}),
			);
		void this.plugin.folderNotesMismatch().then((mismatch) => {
			if (mismatch) match.descEl.createDiv({ cls: "xwiki-publisher-warning", text: mismatch });
		});
	}
}

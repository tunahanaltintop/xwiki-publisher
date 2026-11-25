import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, Notice, SuggestModal, TFile } from "obsidian";
import { typedKey, WorkPackage } from "./issues";

/** Typing is faster than OpenProject answers: a search starts once the typing pauses this long. */
const TYPING_PAUSE_MS = 300;

/** Asks for a work package of OpenProject by subject or id, and hands the chosen one to `choose`. */
export class WorkPackageModal extends SuggestModal<WorkPackage> {
	private failed = false;
	private asked = 0;
	private latest: WorkPackage[] = [];

	constructor(
		app: App,
		private readonly search: (input: string) => Promise<WorkPackage[]>,
		private readonly choose: (workPackage: WorkPackage) => void,
		initial = "",
	) {
		super(app);
		this.setPlaceholder("Subject or number of an OpenProject work package");
		this.emptyStateText = "No work package found in OpenProject.";
		this.limit = 20;
		if (initial) this.inputEl.value = initial;
	}

	async getSuggestions(query: string): Promise<WorkPackage[]> {
		const asked = ++this.asked;
		if (!query.trim()) return (this.latest = []);
		await new Promise((resolve) => window.setTimeout(resolve, TYPING_PAUSE_MS));
		// Something else was typed meanwhile: its own search answers.
		if (asked !== this.asked) return this.latest;
		try {
			const found = await this.search(query.trim());
			if (asked === this.asked) this.latest = found;
		} catch (error) {
			console.error("XWiki Publisher: could not search the work packages of OpenProject", error);
			// Once: the search runs again with every character typed.
			if (!this.failed) new Notice(`Could not search OpenProject: ${error instanceof Error ? error.message : String(error)}`);
			this.failed = true;
		}
		return this.latest;
	}

	renderSuggestion(workPackage: WorkPackage, el: HTMLElement): void {
		el.createDiv({ text: `${workPackage.key} · ${workPackage.subject}` });
		const details = [workPackage.type, workPackage.status, workPackage.project].filter(Boolean).join(" · ");
		if (details) el.createEl("small", { text: details, cls: "xwiki-publisher-suggest-details" });
	}

	onChooseSuggestion(workPackage: WorkPackage): void {
		this.choose(workPackage);
	}
}

/** What the suggestions of work packages in notes need from the plugin. */
export interface WorkPackageSuggestHost {
	app: App;
	/** Starts of work package keys (`IKN-`) that list work packages when typed with a digit; none to turn it off. */
	keyPrefixes(): string[];
	/** Work packages whose key starts with `key`; throws when OpenProject cannot be asked. */
	searchKey(key: string): Promise<WorkPackage[]>;
	/** The link that stands for a work package in a note, or `null` when it cannot be written. */
	workPackageLink(workPackage: WorkPackage): string | null;
}

/**
 * Lists the work packages of OpenProject while the start of a key is typed in a note (`IKN-23`, with a prefix of the
 * settings). Choosing one writes the link to it, which publishing sends as an issue macro.
 */
export class WorkPackageSuggest extends EditorSuggest<WorkPackage> {
	private asked = 0;
	private latest: WorkPackage[] = [];

	constructor(private readonly host: WorkPackageSuggestHost) {
		super(host.app);
		this.limit = 10;
	}

	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		if (!file) return null;
		const typed = typedKey(editor.getLine(cursor.line).slice(0, cursor.ch), this.host.keyPrefixes());
		if (!typed) return null;
		return { start: { line: cursor.line, ch: typed.start }, end: cursor, query: typed.key };
	}

	async getSuggestions(context: EditorSuggestContext): Promise<WorkPackage[]> {
		const asked = ++this.asked;
		await new Promise((resolve) => window.setTimeout(resolve, TYPING_PAUSE_MS));
		// Something else was typed meanwhile: its own search answers.
		if (asked !== this.asked) return this.latest;
		let found: WorkPackage[] = [];
		try {
			found = await this.host.searchKey(context.query);
		} catch (error) {
			console.warn("XWiki Publisher: could not search the work packages of OpenProject", error);
		}
		if (asked === this.asked) this.latest = found;
		return this.latest;
	}

	renderSuggestion(workPackage: WorkPackage, el: HTMLElement): void {
		el.createDiv({ text: `${workPackage.key} · ${workPackage.subject}` });
		const details = [workPackage.type, workPackage.status, workPackage.project].filter(Boolean).join(" · ");
		if (details) el.createEl("small", { text: details, cls: "xwiki-publisher-suggest-details" });
	}

	selectSuggestion(workPackage: WorkPackage): void {
		const context = this.context;
		const link = this.host.workPackageLink(workPackage);
		if (!context || !link) return;
		const written = `${link} `;
		context.editor.replaceRange(written, context.start, context.end);
		context.editor.setCursor({ line: context.start.line, ch: context.start.ch + written.length });
	}
}

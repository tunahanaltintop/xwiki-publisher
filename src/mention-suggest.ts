import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, Notice, SuggestModal, TFile } from "obsidian";
import { mentionLogin, MentionUser } from "./mentions";

/** What the suggestions need from the plugin. */
export interface MentionHost {
	app: App;
	/** Whether users are suggested while a mention is typed. */
	suggestsMentions(): boolean;
	/** Whether a note has an XWiki page: mentions are written in the notes that are published. */
	hasPage(file: TFile): boolean;
	/** Users of the XWiki whose name or login contains `input`; throws when XWiki cannot be asked. */
	searchUsers(file: TFile, input: string): Promise<MentionUser[]>;
	/** The link that mentions a user in a note, or `null` when the user cannot be mentioned. */
	mentionText(user: MentionUser): string | null;
}

/** Typing is faster than the wiki answers: a search starts once the typing pauses this long. */
const TYPING_PAUSE_MS = 250;

function renderUser(user: MentionUser, el: HTMLElement): void {
	el.createDiv({ text: user.name });
	el.createEl("small", { text: mentionLogin(user.reference) ?? user.reference, cls: "xwiki-publisher-mention-login" });
}

/**
 * Lists the users of the XWiki while a mention is typed (`@` and the start of a name) in a note that has a page,
 * as the XWiki editor does. Choosing a user writes the mention as a link, which publishing sends as a mention.
 */
export class MentionSuggest extends EditorSuggest<MentionUser> {
	private asked = 0;
	private latest: MentionUser[] = [];

	constructor(private readonly host: MentionHost) {
		super(host.app);
		this.limit = 8;
	}

	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		if (!file || !this.host.suggestsMentions() || !this.host.hasPage(file)) return null;
		// `@` at the start of a word, then a name of one or two words: not the `@` of an e-mail address.
		const typed = /(?:^|[\s(|>])@([^\s@[\]()|]{1,40}(?: [^\s@[\]()|]{1,40})?)$/.exec(editor.getLine(cursor.line).slice(0, cursor.ch));
		if (!typed) return null;
		return { start: { line: cursor.line, ch: cursor.ch - typed[1].length - 1 }, end: cursor, query: typed[1] };
	}

	async getSuggestions(context: EditorSuggestContext): Promise<MentionUser[]> {
		const asked = ++this.asked;
		await new Promise((resolve) => window.setTimeout(resolve, TYPING_PAUSE_MS));
		// Something else was typed meanwhile: its own search answers.
		if (asked !== this.asked) return this.latest;
		let users: MentionUser[] = [];
		try {
			users = await this.host.searchUsers(context.file, context.query);
		} catch (error) {
			console.warn("XWiki Publisher: could not list the users of XWiki", error);
		}
		if (asked === this.asked) this.latest = users;
		return this.latest;
	}

	renderSuggestion(user: MentionUser, el: HTMLElement): void {
		renderUser(user, el);
	}

	selectSuggestion(user: MentionUser): void {
		const context = this.context;
		const link = this.host.mentionText(user);
		if (!context || !link) return;
		const written = `${link} `;
		context.editor.replaceRange(written, context.start, context.end);
		context.editor.setCursor({ line: context.start.line, ch: context.start.ch + written.length });
	}
}

/** Asks for a user of the XWiki by name or login, and hands the chosen one to `choose`. */
export class MentionModal extends SuggestModal<MentionUser> {
	private failed = false;

	constructor(
		app: App,
		private readonly search: (input: string) => Promise<MentionUser[]>,
		private readonly choose: (user: MentionUser) => void,
	) {
		super(app);
		this.setPlaceholder("Name or login of an XWiki user");
		this.emptyStateText = "No user found on XWiki.";
	}

	async getSuggestions(query: string): Promise<MentionUser[]> {
		if (!query.trim()) return [];
		try {
			return await this.search(query.trim());
		} catch (error) {
			console.error("XWiki Publisher: could not list the users of XWiki", error);
			// Once: the search runs again with every character typed.
			if (!this.failed) new Notice(`Could not list the users of XWiki: ${error instanceof Error ? error.message : String(error)}`);
			this.failed = true;
			return [];
		}
	}

	renderSuggestion(user: MentionUser, el: HTMLElement): void {
		renderUser(user, el);
	}

	onChooseSuggestion(user: MentionUser): void {
		this.choose(user);
	}
}

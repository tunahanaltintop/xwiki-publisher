import { App, FuzzySuggestModal, Modal, Setting, TextAreaComponent, TFolder } from "obsidian";
import { typedKey, type WorkPackage } from "./issues";
import { sendable, type MentionUser } from "./mentions";

export interface Choice<T> {
	label: string;
	value: T;
	cta?: boolean;
	warning?: boolean;
}

/** Asks the user to pick one of several actions; resolves to `null` when the modal is dismissed. */
export function choose<T>(app: App, title: string, message: string, choices: Choice<T>[]): Promise<T | null> {
	return new Promise((resolve) => {
		let result: T | null = null;
		const modal = new Modal(app);
		modal.setTitle(title);
		modal.contentEl.createEl("p", { text: message });
		const setting = new Setting(modal.contentEl);
		for (const choice of choices) {
			setting.addButton((button) => {
				button.setButtonText(choice.label).onClick(() => {
					result = choice.value;
					modal.close();
				});
				if (choice.cta) button.setCta();
				if (choice.warning) button.setDestructive();
			});
		}
		modal.onClose = () => resolve(result);
		modal.open();
	});
}

/** Asks for a single line of text; resolves to `null` when cancelled. */
export function prompt(app: App, title: string, description: string, placeholder: string, initial = ""): Promise<string | null> {
	return new Promise((resolve) => {
		let result: string | null = null;
		let value = initial;
		const modal = new Modal(app);
		modal.setTitle(title);
		const submit = () => {
			result = value.trim() || null;
			modal.close();
		};
		new Setting(modal.contentEl)
			.setDesc(description)
			.addText((text) => {
				text.setPlaceholder(placeholder).setValue(initial).onChange((v) => (value = v));
				text.inputEl.addClass("xwiki-publisher-wide-input");
				text.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
					if (event.key === "Enter") {
						event.preventDefault();
						submit();
					}
				});
				window.setTimeout(() => text.inputEl.focus(), 0);
			});
		new Setting(modal.contentEl).addButton((button) => button.setButtonText("OK").setCta().onClick(submit));
		modal.onClose = () => resolve(result);
		modal.open();
	});
}

/**
 * Mentioning users while a comment is typed: `@` and the start of a name lists them. With `workPackages`, `#` and the
 * start of a subject or an id lists the work packages of OpenProject.
 */
export interface MentionInput {
	search(input: string): Promise<MentionUser[]>;
	/** What a chosen user becomes in the text that is sent: an XWiki mention. */
	macro(user: MentionUser): string;
	workPackages?: {
		search(input: string): Promise<WorkPackage[]>;
		/** Starts of work package keys (`IKN-`) that list the work packages whose key starts so, when typed with a digit. */
		prefixes: string[];
		/** Work packages whose key starts with `key`. */
		searchKey(key: string): Promise<WorkPackage[]>;
		/** What a chosen work package becomes in the text that is sent: an issue macro. */
		macro(workPackage: WorkPackage): string;
	};
}

/** Something that can be chosen while typing, how it shows in the input, and what it is sent as. */
interface Suggestion {
	label: string;
	detail: string;
	shown: string;
	macro: string;
}

/** Typing is faster than the wiki answers: a search starts once the typing pauses this long. */
const MENTION_PAUSE_MS = 250;

/** What is typed before the caret that asks for a list: `@` and a name, or `#` and a work package. */
const TYPED = {
	user: /(?:^|[\s(])@([^\s@]{1,40}(?: [^\s@]{1,40})?)$/,
	workPackage: /(?:^|[\s(])#([^\s#]{1,40}(?: [^\s#]{1,40})?)$/,
};

/**
 * Asks for a text of several lines, such as a comment; resolves to `null` when cancelled or left empty.
 * Ctrl/Cmd+Enter submits. `quote` is shown above the input: the text the comment is about. With `mentions`, typing
 * `@` and the start of a name lists the matching users, and `#` the work packages; a chosen one shows as `@Name` or
 * `#PROJ-42` and is sent as a mention or an issue macro. `initial` fills the input, with what its names stand for.
 */
export function promptText(
	app: App,
	title: string,
	placeholder: string,
	submitLabel: string,
	quote?: string,
	mentions?: MentionInput,
	initial?: { text: string; mentions: { shown: string; macro: string }[] },
): Promise<string | null> {
	return new Promise((resolve) => {
		let result: string | null = null;
		const modal = new Modal(app);
		modal.setTitle(title);
		if (quote) modal.contentEl.createEl("blockquote", { text: quote, cls: "xwiki-publisher-comment-quote" });
		const hint = mentions ? (mentions.workPackages ? " (@ to mention someone, # for a work package)" : " (@ to mention someone)") : "";
		const input = new TextAreaComponent(modal.contentEl).setPlaceholder(`${placeholder}${hint}`);
		input.inputEl.addClass("xwiki-publisher-comment-input");
		input.inputEl.rows = 5;
		const list = modal.contentEl.createDiv({ cls: "xwiki-mention-list" });
		list.hide();

		/** Users and work packages chosen so far: how they show in the input, and what they are sent as. */
		const chosen: { shown: string; macro: string }[] = [...(initial?.mentions ?? [])];
		if (initial) input.setValue(initial.text);
		let found: Suggestion[] = [];
		let active = 0;
		let asked = 0;
		let typed: { start: number; end: number } | null = null;
		const hide = () => {
			found = [];
			typed = null;
			list.hide();
		};
		const choose = (suggestion: Suggestion) => {
			if (!typed) return;
			const el = input.inputEl;
			el.value = `${el.value.slice(0, typed.start)}${suggestion.shown} ${el.value.slice(typed.end)}`;
			const caret = typed.start + suggestion.shown.length + 1;
			el.setSelectionRange(caret, caret);
			if (!chosen.some((existing) => existing.shown === suggestion.shown)) chosen.push({ shown: suggestion.shown, macro: suggestion.macro });
			hide();
			el.focus();
		};
		const render = () => {
			list.empty();
			if (found.length === 0) {
				list.hide();
				return;
			}
			found.forEach((suggestion, index) => {
				const item = list.createDiv({ cls: index === active ? "xwiki-mention-item is-selected" : "xwiki-mention-item" });
				item.createSpan({ text: suggestion.label });
				if (suggestion.detail) item.createSpan({ cls: "xwiki-publisher-mention-login", text: suggestion.detail });
				// Before the input loses focus.
				item.addEventListener("mousedown", (event) => {
					event.preventDefault();
					choose(suggestion);
				});
			});
			list.show();
		};
		const lookUp = async () => {
			if (!mentions) return;
			const el = input.inputEl;
			const caret = el.selectionStart ?? el.value.length;
			const before = el.value.slice(0, caret);
			const user = TYPED.user.exec(before);
			// The start of a key (`IKN-23`), or `#` and a subject or an id.
			const key = !user && mentions.workPackages ? typedKey(before, mentions.workPackages.prefixes) : null;
			const workPackage = !user && !key && mentions.workPackages ? TYPED.workPackage.exec(before) : null;
			const start = user ? caret - user[1].length - 1 : key ? key.start : workPackage ? caret - workPackage[1].length - 1 : null;
			if (start === null) {
				hide();
				return;
			}
			const id = ++asked;
			await new Promise((wait) => window.setTimeout(wait, MENTION_PAUSE_MS));
			if (id !== asked) return;
			let suggestions: Suggestion[] = [];
			try {
				if (user) {
					suggestions = (await mentions.search(user[1])).map((found) => ({
						label: found.name,
						detail: found.reference.replace(/^XWiki\./, "").replace(/\\(.)/g, "$1"),
						shown: `@${found.name}`,
						macro: mentions.macro(found),
					}));
				} else if (mentions.workPackages) {
					const workPackages = mentions.workPackages;
					const listed = key ? await workPackages.searchKey(key.key) : await workPackages.search(workPackage?.[1] ?? "");
					suggestions = listed.map((found) => ({
						label: `${found.key} · ${found.subject}`,
						detail: [found.type, found.status].filter(Boolean).join(" · "),
						shown: `#${found.key}`,
						macro: workPackages.macro(found),
					}));
				}
			} catch (error) {
				console.warn(`XWiki Publisher: could not list the ${user ? "users of XWiki" : "work packages of OpenProject"}`, error);
			}
			if (id !== asked) return;
			typed = { start, end: caret };
			found = suggestions;
			active = 0;
			render();
		};
		input.inputEl.addEventListener("input", () => void lookUp());
		input.inputEl.addEventListener("blur", () => window.setTimeout(hide, 150));

		const submit = () => {
			result = sendable(input.getValue(), chosen) || null;
			modal.close();
		};
		input.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
			if (found.length > 0) {
				if (event.key === "ArrowDown" || event.key === "ArrowUp") {
					event.preventDefault();
					active = (active + (event.key === "ArrowDown" ? 1 : found.length - 1)) % found.length;
					render();
					return;
				}
				if (event.key === "Enter" || event.key === "Tab") {
					event.preventDefault();
					choose(found[active]);
					return;
				}
				if (event.key === "Escape") {
					event.preventDefault();
					event.stopPropagation();
					hide();
					return;
				}
			}
			if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
				event.preventDefault();
				submit();
			}
		});
		window.setTimeout(() => input.inputEl.focus(), 0);
		new Setting(modal.contentEl)
			.addButton((button) => button.setButtonText(submitLabel).setCta().onClick(submit))
			.addButton((button) => button.setButtonText("Cancel").onClick(() => modal.close()));
		modal.onClose = () => resolve(result);
		modal.open();
	});
}

/** Asks the user to pick a vault folder; resolves to `null` when dismissed. */
export function chooseFolder(app: App, placeholder: string): Promise<TFolder | null> {
	return new Promise((resolve) => {
		let result: TFolder | null = null;
		const modal = new (class extends FuzzySuggestModal<TFolder> {
			getItems(): TFolder[] {
				return app.vault.getAllFolders(false);
			}
			getItemText(folder: TFolder): string {
				return folder.path;
			}
			onChooseItem(folder: TFolder): void {
				result = folder;
			}
		})(app);
		modal.setPlaceholder(placeholder);
		// onChooseItem runs after onClose, so resolve once the current event has been handled.
		modal.onClose = () => window.setTimeout(() => resolve(result), 0);
		modal.open();
	});
}

import { App, FuzzySuggestModal, Modal, Setting, TextAreaComponent, TFolder } from "obsidian";
import type { MentionUser } from "./mentions";

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

/** Mentioning users while a comment is typed: `@` and the start of a name lists them. */
export interface MentionInput {
	search(input: string): Promise<MentionUser[]>;
	/** What a chosen user becomes in the text that is sent: an XWiki mention. */
	macro(user: MentionUser): string;
}

/** Typing is faster than the wiki answers: a search starts once the typing pauses this long. */
const MENTION_PAUSE_MS = 250;

/**
 * Asks for a text of several lines, such as a comment; resolves to `null` when cancelled or left empty.
 * Ctrl/Cmd+Enter submits. `quote` is shown above the input: the text the comment is about. With `mentions`, typing
 * `@` and the start of a name lists the matching users; a chosen one shows as `@Name` and is sent as a mention.
 */
export function promptText(app: App, title: string, placeholder: string, submitLabel: string, quote?: string, mentions?: MentionInput): Promise<string | null> {
	return new Promise((resolve) => {
		let result: string | null = null;
		const modal = new Modal(app);
		modal.setTitle(title);
		if (quote) modal.contentEl.createEl("blockquote", { text: quote, cls: "xwiki-publisher-comment-quote" });
		const input = new TextAreaComponent(modal.contentEl).setPlaceholder(mentions ? `${placeholder} (@ to mention someone)` : placeholder);
		input.inputEl.addClass("xwiki-publisher-comment-input");
		input.inputEl.rows = 5;
		const list = modal.contentEl.createDiv({ cls: "xwiki-mention-list" });
		list.hide();

		/** Mentions chosen so far: how they show in the input, and what they are sent as. */
		const chosen: { shown: string; macro: string }[] = [];
		let users: MentionUser[] = [];
		let active = 0;
		let asked = 0;
		let typed: { start: number; end: number } | null = null;
		const hide = () => {
			users = [];
			typed = null;
			list.hide();
		};
		const choose = (user: MentionUser) => {
			if (!mentions || !typed) return;
			const el = input.inputEl;
			const shown = `@${user.name}`;
			el.value = `${el.value.slice(0, typed.start)}${shown} ${el.value.slice(typed.end)}`;
			const caret = typed.start + shown.length + 1;
			el.setSelectionRange(caret, caret);
			chosen.push({ shown, macro: mentions.macro(user) });
			hide();
			el.focus();
		};
		const render = () => {
			list.empty();
			if (users.length === 0) {
				list.hide();
				return;
			}
			users.forEach((user, index) => {
				const item = list.createDiv({ cls: index === active ? "xwiki-mention-item is-selected" : "xwiki-mention-item" });
				item.createSpan({ text: user.name });
				item.createSpan({ cls: "xwiki-publisher-mention-login", text: user.reference.replace(/^XWiki\./, "").replace(/\\(.)/g, "$1") });
				// Before the input loses focus.
				item.addEventListener("mousedown", (event) => {
					event.preventDefault();
					choose(user);
				});
			});
			list.show();
		};
		const lookUp = async () => {
			if (!mentions) return;
			const el = input.inputEl;
			const caret = el.selectionStart ?? el.value.length;
			const name = /(?:^|[\s(])@([^\s@]{1,40}(?: [^\s@]{1,40})?)$/.exec(el.value.slice(0, caret));
			if (!name) {
				hide();
				return;
			}
			const id = ++asked;
			await new Promise((wait) => window.setTimeout(wait, MENTION_PAUSE_MS));
			if (id !== asked) return;
			let found: MentionUser[] = [];
			try {
				found = await mentions.search(name[1]);
			} catch (error) {
				console.warn("XWiki Publisher: could not list the users of XWiki", error);
			}
			if (id !== asked) return;
			typed = { start: caret - name[1].length - 1, end: caret };
			users = found;
			active = 0;
			render();
		};
		input.inputEl.addEventListener("input", () => void lookUp());
		input.inputEl.addEventListener("blur", () => window.setTimeout(hide, 150));

		const submit = () => {
			let text = input.getValue().trim();
			// The longest first, so that "@Ali Veli" is not taken for "@Ali".
			for (const mention of [...chosen].sort((a, b) => b.shown.length - a.shown.length)) text = text.split(mention.shown).join(mention.macro);
			result = text || null;
			modal.close();
		};
		input.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
			if (users.length > 0) {
				if (event.key === "ArrowDown" || event.key === "ArrowUp") {
					event.preventDefault();
					active = (active + (event.key === "ArrowDown" ? 1 : users.length - 1)) % users.length;
					render();
					return;
				}
				if (event.key === "Enter" || event.key === "Tab") {
					event.preventDefault();
					choose(users[active]);
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

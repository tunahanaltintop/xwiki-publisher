import { App, Modal, Setting } from "obsidian";

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

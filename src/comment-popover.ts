import { App, Component, MarkdownRenderer, Modal } from "obsidian";
import { CommentEntry, CommentThread, commentsAtIcon, replyDepth } from "./inline-comments";

/** What the popover needs from the plugin. */
export interface CommentPopoverHost {
	app: App;
	/** The note a comment icon was selected in, with its text; `null` outside notes that have comments. */
	noteAt(target: Node): Promise<{ path: string; text: string } | null>;
	/** Starts a reply to a comment of the note at `path`, shown above the input; `null` when replying is not possible there. */
	reply(path: string, comment: number, quote?: string): (() => void) | null;
	/** An inline comment of the note at `path` with its replies, as XWiki has them now; `null` when it cannot be read. */
	thread(path: string, comment: number): Promise<CommentThread | null>;
	/** Deletes a comment of the note at `path` with its replies, after asking; `null` when that is not possible. */
	remove(path: string, comment: number): (() => void) | null;
	/** Resolves a comment of the note at `path`, or reopens it; `null` when that is not possible. */
	resolve(path: string, comment: number, resolved?: boolean): (() => void) | null;
}

/** The icons of comments: open, and resolved. */
const ICONS = ["💬", "✅"];

/**
 * Where the pointer is on a comment icon: the text node holding the icon. Only the icon itself counts, so selecting
 * the commented text still places the cursor in it.
 */
function iconAt(event: MouseEvent): Text | null {
	const doc = (event.target as Node | null)?.ownerDocument ?? document;
	// The standard method, or the older one of Chromium for Electron versions without it.
	const hit = doc as unknown as {
		caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node } | null;
		caretRangeFromPoint?: (x: number, y: number) => Range | null;
	};
	const node = hit.caretPositionFromPoint?.(event.clientX, event.clientY)?.offsetNode ?? hit.caretRangeFromPoint?.(event.clientX, event.clientY)?.startContainer;
	if (!node?.instanceOf(Text)) return null;
	for (const icon of ICONS) {
		for (let at = node.data.indexOf(icon); at >= 0; at = node.data.indexOf(icon, at + 1)) {
			const range = doc.createRange();
			range.setStart(node, at);
			range.setEnd(node, at + icon.length);
			const box = range.getBoundingClientRect();
			if (event.clientX >= box.left - 1 && event.clientX <= box.right + 1 && event.clientY >= box.top - 1 && event.clientY <= box.bottom + 1) return node;
		}
	}
	return null;
}

/**
 * Shows the inline comments of a note when their icon is selected: in the reading view, in Live Preview and in table
 * cells alike, since it looks at what is under the pointer rather than at how the note is rendered.
 */
export class CommentPopover {
	private el: HTMLElement | null = null;
	private component: Component | null = null;

	constructor(private readonly host: CommentPopoverHost) {}

	/**
	 * Handles the pointer events of the window, before the editor sees them. On a comment icon, none of them reaches
	 * the editor: it would place the cursor in the highlight, and Live Preview would show its `==` marks. The press
	 * opens the comments; the events that follow it are only kept from the editor.
	 */
	handle(event: MouseEvent): void {
		if (event.button !== 0 || this.el?.contains(event.target as Node)) return;
		const node = iconAt(event);
		if (!node) {
			if (event.type === "pointerdown" || event.type === "mousedown") this.close();
			return;
		}
		event.preventDefault();
		event.stopImmediatePropagation();
		// A pointer press comes with a mouse press: the comments open once.
		if (event.type === "pointerdown" || (event.type === "mousedown" && !this.pressed)) void this.show(event, node);
		this.pressed = event.type === "pointerdown" ? true : event.type === "click" ? false : this.pressed;
	}

	private pressed = false;

	private async show(event: MouseEvent, node: Text): Promise<void> {
		const note = await this.host.noteAt(node);
		if (!note) return;
		// The text around the icon: the commented text of a highlight, or the references of the line it is on.
		const block = node.parentElement?.closest("mark, .cm-highlight, td, th, li, p, .cm-line, div") ?? node.parentElement;
		const highlight = node.parentElement?.closest("mark, .cm-highlight");
		const ids = commentsAtIcon(note.text, highlight?.textContent ?? node.data, block?.textContent ?? node.data);
		if (ids.length > 0) this.open(event.clientX, event.clientY, note, ids);
	}

	private open(x: number, y: number, note: { path: string; text: string }, ids: number[]): void {
		this.close();
		const el = document.body.createDiv({ cls: "xwiki-comment-popover" });
		const component = new Component();
		component.load();
		this.el = el;
		this.component = component;
		const place = () => {
			// Next to the icon, inside the window.
			const box = el.getBoundingClientRect();
			el.style.left = `${Math.max(8, Math.min(x, window.innerWidth - box.width - 8))}px`;
			el.style.top = `${y + 16 + box.height > window.innerHeight ? Math.max(8, y - box.height - 8) : y + 16}px`;
		};
		for (const id of ids) {
			const holder = el.createDiv({ cls: "xwiki-comment-thread" });
			// What the note shows, until XWiki tells the comments as they are now, with what can be done with each.
			this.renderShown(holder, note, id);
			void this.host.thread(note.path, id).then((thread) => {
				if (!thread || this.el !== el) return;
				holder.empty();
				this.renderThread(holder, note.path, thread);
				place();
			});
		}
		place();
	}

	/** A comment as its footnote in the note shows it, with what can be done without XWiki telling more. */
	private renderShown(holder: HTMLElement, note: { path: string; text: string }, id: number): void {
		const footnote = new RegExp(`^\\[\\^xwiki-${id}\\]: (.*)$`, "m").exec(note.text)?.[1] ?? "";
		for (const [index, entry] of footnote.replace(/^(?:💬|✅)\s*/u, "").split("<br>").entries()) {
			const item = holder.createDiv({ cls: index === 0 ? "xwiki-comment-entry" : "xwiki-comment-entry mod-reply" });
			void MarkdownRenderer.render(this.host.app, entry.replace(/^↳\s*/, ""), item, note.path, this.component ?? new Component());
		}
	}

	/** The comment and each of its replies, each with its own actions: the comment can also be resolved. */
	private renderThread(holder: HTMLElement, path: string, thread: CommentThread): void {
		const resolution = thread.resolved;
		if (resolution) {
			const at = resolution.at === undefined ? "" : ` · ${formatTime(resolution.at)}`;
			holder.createDiv({ cls: "xwiki-comment-resolved", text: `✅ Resolved by ${resolution.name}${at}` });
		}
		for (const entry of thread.entries) {
			const depth = replyDepth(thread, entry);
			const item = holder.createDiv({ cls: depth === 0 ? "xwiki-comment-entry" : "xwiki-comment-entry mod-reply" });
			item.setCssProps({ "--xwiki-reply-depth": String(Math.min(depth, 4)) });
			const text = item.createDiv();
			void MarkdownRenderer.render(this.host.app, entryMarkdown(entry), text, path, this.component ?? new Component());
			if (entry.id === undefined) continue;
			const actions = item.createDiv({ cls: "xwiki-comment-actions" });
			const button = (label: string, cls: string, action: (() => void) | null) => {
				if (!action) return;
				const element = actions.createEl("button", { text: label, cls: `xwiki-comment-reply ${cls}` });
				element.addEventListener("click", () => {
					this.close();
					action();
				});
			};
			if (entry.id === thread.id) {
				if (resolution) button("Reopen", "", this.host.resolve(path, entry.id, false));
				else button("Resolve", "mod-cta", this.host.resolve(path, entry.id, true));
			}
			button("Reply", "", this.host.reply(path, entry.id, `${entry.author}: ${entry.text}`));
			button("Delete", "mod-warning", this.host.remove(path, entry.id));
		}
	}

	close(): void {
		this.el?.remove();
		this.el = null;
		this.component?.unload();
		this.component = null;
	}
}

/** A comment as the popover shows it: its author, its date and its text. */
function entryMarkdown(entry: CommentEntry): string {
	const date = entry.date === undefined ? "" : ` · ${formatTime(entry.date)}`;
	return `**${entry.author.replace(/[*_[\]]/g, "\\$&")}**${date}: ${entry.text.split(/\r?\n/).join("<br>")}`;
}

function formatTime(time: number): string {
	const date = new Date(time);
	const two = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/**
 * The resolved inline comments of a note, which the note does not show: what they were about, the comment and its
 * replies, who resolved them and when, with a button to reopen each.
 */
export class ResolvedCommentsModal extends Modal {
	private readonly component = new Component();

	constructor(
		app: App,
		private readonly name: string,
		private readonly path: string,
		private threads: CommentThread[],
		/** Reopens a comment; resolves to whether it did. */
		private readonly reopen: (thread: CommentThread) => Promise<boolean>,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(`Resolved comments: ${this.name}`);
		this.component.load();
		this.render();
	}

	onClose(): void {
		this.component.unload();
		this.contentEl.empty();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		el.addClass("xwiki-resolved-comments");
		if (this.threads.length === 0) {
			el.createDiv({ cls: "xwiki-panel-hint", text: "No resolved comments on this page." });
			return;
		}
		for (const thread of this.threads) {
			const item = el.createDiv({ cls: "xwiki-comment-thread" });
			item.createEl("blockquote", { cls: "xwiki-publisher-comment-quote", text: thread.selection.replace(/\s+/g, " ").trim() });
			for (const [index, entry] of thread.entries.entries()) {
				const line = item.createDiv({ cls: index === 0 ? "xwiki-comment-entry" : "xwiki-comment-entry mod-reply" });
				const date = entry.date === undefined ? "" : ` · ${formatTime(entry.date)}`;
				void MarkdownRenderer.render(this.app, `**${entry.author.replace(/[*_[\]]/g, "\\$&")}**${date}: ${entry.text.split(/\r?\n/).join("<br>")}`, line, this.path, this.component);
			}
			const resolution = thread.resolved;
			const footer = item.createDiv({ cls: "xwiki-comment-actions" });
			if (resolution) footer.createSpan({ cls: "xwiki-comment-resolved", text: `✓ Resolved by ${resolution.name}${resolution.at === undefined ? "" : ` · ${formatTime(resolution.at)}`}` });
			const button = footer.createEl("button", { text: "Reopen", cls: "xwiki-comment-reply" });
			button.addEventListener("click", () => {
				button.disabled = true;
				void this.reopen(thread).then((done) => {
					if (done) this.threads = this.threads.filter((other) => other !== thread);
					this.render();
				});
			});
		}
	}
}

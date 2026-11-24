import { App, Modal, Notice, setIcon } from "obsidian";
import { diffCounts, DiffFold, DiffHunk, diffHunks, DiffLine, DiffRow, foldRows, sideBySide } from "./diff";

/** One version of a note in the comparison. */
export interface DiffSide {
	/** Where the version comes from: XWiki and its version, or the vault. */
	label: string;
	/** The body of the note; `null` when there is none, such as a note deleted from the vault. */
	text: string | null;
	/** Why there is no text. */
	missing?: string;
}

/** Something that can be done with one block of changes, such as publishing it alone. */
export interface DiffBlockAction {
	label: string;
	tooltip: string;
	/** The action loses something: the button is shown as such. */
	warning?: boolean;
	/** Does it; resolves to the two versions compared again, or `null` when it was cancelled. */
	run(hunk: DiffHunk): Promise<[DiffSide, DiffSide] | null>;
}

export interface DiffOptions {
	/** Undoes the whole change, after asking; resolves to whether it did. The comparison then closes. */
	revert?: () => Promise<boolean>;
	/** What can be done with each block of changes. */
	blocks?: DiffBlockAction[];
	/** Whether the block actions can be used: both versions exist. */
	available?: () => boolean;
}

/** Unchanged lines shown around each change. */
const CONTEXT = 3;

/**
 * Shows two versions of a note side by side, the old one on the left and the new one on the right: lines only on
 * the left are marked as removed, lines only on the right as added, and within a changed line the words that differ.
 * Long runs of unchanged lines are folded, and can be opened one by one or all at once.
 */
export class DiffModal extends Modal {
	private rows: DiffRow[];
	private hunks: DiffHunk[];
	/** A block action is running: the buttons wait. */
	private running = false;
	/** Spacing counts as a difference: off by default, since Obsidian pads table cells when it aligns a table. */
	private spacing = false;
	/** Folds the user opened, by their first row. */
	private readonly opened = new Set<number>();
	private whole = false;

	constructor(
		app: App,
		private readonly name: string,
		private left: DiffSide,
		private right: DiffSide,
		private readonly options: DiffOptions = {},
	) {
		super(app);
		this.rows = this.compare();
		this.hunks = diffHunks(this.rows);
	}

	private compare(): DiffRow[] {
		return sideBySide(this.left.text ?? "", this.right.text ?? "", { ignoreWhitespace: !this.spacing });
	}

	/** Compares again, after a block action or when spacing is switched. */
	private update(): void {
		this.rows = this.compare();
		this.hunks = diffHunks(this.rows);
		this.opened.clear();
		this.render();
	}

	private async runBlock(action: DiffBlockAction, hunk: DiffHunk): Promise<void> {
		this.running = true;
		this.render();
		let done = false;
		try {
			const sides = await action.run(hunk);
			if (sides) [this.left, this.right] = sides;
			done = sides !== null;
		} finally {
			this.running = false;
			this.update();
		}
		// The last block was taken: nothing is left to compare.
		if (done && this.hunks.length === 0) {
			new Notice(`"${this.name}" and its XWiki page are the same now.`);
			this.close();
		}
	}

	onOpen(): void {
		this.modalEl.addClass("xwiki-diff-modal");
		this.setTitle(`Differences: ${this.name}`);
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		const { removed, added } = diffCounts(this.rows);
		const changed = removed + added > 0;

		const bar = el.createDiv({ cls: "xwiki-diff-bar" });
		const summary = bar.createDiv({ cls: "xwiki-diff-summary" });
		if (!changed) summary.setText("No differences.");
		else {
			summary.createSpan({ cls: "xwiki-diff-count mod-removed", text: `−${removed}` });
			summary.createSpan({ cls: "xwiki-diff-count mod-added", text: `+${added}` });
			summary.createSpan({ text: "lines" });
		}
		const buttons = bar.createDiv({ cls: "xwiki-diff-buttons" });
		const revert = this.options.revert;
		if (revert && changed) {
			const button = buttons.createEl("button", { cls: "mod-warning", text: "Revert changes" });
			button.addEventListener("click", () => {
				void revert().then((done) => {
					if (done) this.close();
				});
			});
		}
		const spacing = buttons.createEl("button", { text: this.spacing ? "Ignore spacing" : "Show spacing changes" });
		spacing.addEventListener("click", () => {
			this.spacing = !this.spacing;
			this.update();
		});
		if (changed) {
			const toggle = buttons.createEl("button", { text: this.whole ? "Show changes only" : "Show whole note" });
			toggle.addEventListener("click", () => {
				this.whole = !this.whole;
				this.render();
			});
		}

		const grid = el.createDiv({ cls: "xwiki-diff" });
		const head = grid.createDiv({ cls: "xwiki-diff-row xwiki-diff-head" });
		for (const side of [this.left, this.right]) {
			const cell = head.createDiv({ cls: "xwiki-diff-label" });
			cell.createSpan({ text: side.label });
			if (side.text === null) cell.createSpan({ cls: "xwiki-diff-missing", text: side.missing ?? "Nothing to compare with." });
		}

		const starts = new Map(this.hunks.map((hunk, index) => [this.rows[hunk.start], index]));
		const shown = this.whole ? this.rows : foldRows(this.rows, CONTEXT, this.opened);
		for (const row of shown) {
			if (row.kind === "fold") {
				this.renderFold(grid, row);
				continue;
			}
			const hunk = starts.get(row);
			if (hunk !== undefined) this.renderHunk(grid, hunk);
			this.renderRow(grid, row);
		}
	}

	/** The bar above a block of changes: which lines it is, and what can be done with it. */
	private renderHunk(grid: HTMLElement, index: number): void {
		const hunk = this.hunks[index];
		const bar = grid.createDiv({ cls: "xwiki-diff-hunk" });
		const span = ([from, to]: [number, number]) => (from === to ? "—" : to - from === 1 ? String(to) : `${from + 1}–${to}`);
		bar.createSpan({ cls: "xwiki-diff-hunk-label", text: `Change ${index + 1} of ${this.hunks.length} · lines ${span(hunk.left)} → ${span(hunk.right)}` });
		const blocks = this.options.blocks ?? [];
		if (blocks.length === 0 || !(this.options.available?.() ?? true)) return;
		const actions = bar.createDiv({ cls: "xwiki-diff-hunk-actions" });
		for (const action of blocks) {
			const button = actions.createEl("button", { text: action.label, cls: action.warning ? "mod-warning" : "" });
			button.setAttr("aria-label", action.tooltip);
			button.title = action.tooltip;
			button.disabled = this.running;
			button.addEventListener("click", () => void this.runBlock(action, hunk));
		}
	}

	private renderFold(grid: HTMLElement, fold: DiffFold): void {
		const row = grid.createDiv({ cls: "xwiki-diff-fold" });
		setIcon(row.createSpan({ cls: "xwiki-diff-fold-icon" }), "chevrons-up-down");
		row.createSpan({ text: `${fold.count} unchanged lines` });
		row.setAttr("role", "button");
		row.setAttr("tabindex", "0");
		const expand = () => {
			this.opened.add(fold.start);
			this.render();
		};
		row.addEventListener("click", expand);
		row.addEventListener("keydown", (event) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				expand();
			}
		});
	}

	private renderRow(grid: HTMLElement, row: DiffRow): void {
		const line = grid.createDiv({ cls: `xwiki-diff-row mod-${row.kind}` });
		this.renderSide(line, row.left, "mod-left");
		this.renderSide(line, row.right, "mod-right");
	}

	private renderSide(row: HTMLElement, line: DiffLine | undefined, cls: string): void {
		row.createDiv({ cls: `xwiki-diff-number ${cls}`, text: line ? String(line.number) : "" });
		const text = row.createDiv({ cls: `xwiki-diff-text ${cls}` });
		if (!line) {
			text.addClass("is-empty");
			return;
		}
		for (const segment of line.segments) {
			if (segment.changed) text.createSpan({ cls: "xwiki-diff-word", text: segment.text });
			else text.appendText(segment.text);
		}
	}
}

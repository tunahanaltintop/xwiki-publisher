import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";

/**
 * How the inline comments of a page look in a note. The footnote reference after a commented text (`[^xwiki-3]`) is
 * what ties it to its comment in the file, but the 💬 icon already shows it, and opens it: the reference is hidden
 * where the note is shown. Obsidian shows it as plain text in table cells, and as a number elsewhere. Only the display
 * changes: the file keeps the reference, so publishing and pulling are the same.
 */

/** A commented text or the icon of the line of comments without a place, followed by its references. */
const MARKED = /(==(💬|✅)(?:(?!==)[^\n])*==|💬)((?:\[\^xwiki-\d+\])+)/gu;

/** Class of the text of a resolved comment: faded, as done with. */
const RESOLVED = "xwiki-comment-resolved-mark";
const resolvedMark = Decoration.mark({ class: RESOLVED });

function hiddenReferences(view: EditorView): DecorationSet {
	if (!view.state.field(editorLivePreviewField, false)) return Decoration.none;
	const builder = new RangeSetBuilder<Decoration>();
	const selection = view.state.selection.ranges;
	let last = -1;
	for (const { from, to } of view.visibleRanges) {
		const text = view.state.doc.sliceString(from, to);
		for (const match of text.matchAll(MARKED)) {
			const start = from + (match.index ?? 0);
			const references = start + match[1].length;
			const end = references + match[3].length;
			if (start < last) continue;
			// A resolved comment is faded, wherever the cursor is.
			if (match[2] === "✅") builder.add(start, references, resolvedMark);
			// Where the cursor is, the Markdown is shown as it is, to be edited.
			if (!selection.some((range) => range.from <= end && range.to >= start)) builder.add(references, end, Decoration.replace({}));
			last = end;
		}
	}
	return builder.finish();
}

/** Hides the references of inline comments in Live Preview, except where the cursor is. */
export const commentReferences: Extension = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = hiddenReferences(view);
		}

		update(update: ViewUpdate): void {
			const modeChanged = update.startState.field(editorLivePreviewField, false) !== update.state.field(editorLivePreviewField, false);
			if (update.docChanged || update.viewportChanged || update.selectionSet || modeChanged) this.decorations = hiddenReferences(update.view);
		}
	},
	{ decorations: (plugin) => plugin.decorations },
);

const HIDDEN = "xwiki-comment-ref-hidden";
/** A reference as Obsidian shows it as text: `xwiki-3`, with or without its brackets. */
const REFERENCE_TEXT = /^\s*(?:\[?\^?xwiki-\d+\]?)+/;

/** Whether a node is part of the editor's own text, which only the editor may change. */
function inEditorText(node: Node): boolean {
	const element = node.instanceOf(Element) ? node : node.parentElement;
	return !!element?.closest(".cm-content") && !element.closest(".cm-embed-block, .cm-table-widget");
}

/** Hides the references that follow `anchor`: a commented text, or the icon of the line of comments without a place. */
function hideAfter(anchor: Node): void {
	for (let next = anchor.nextSibling; next; ) {
		const following: ChildNode | null = next.nextSibling;
		if (next.instanceOf(Text)) {
			const reference = REFERENCE_TEXT.exec(next.data);
			if (!next.data.trim()) {
				next = following;
				continue;
			}
			if (!reference) return;
			next.data = next.data.slice(reference[0].length);
			if (next.data) return;
		} else if (next.instanceOf(HTMLElement)) {
			// Rendered references are numbered footnote links; as text, their label.
			const isReference = next.matches("sup.footnote-ref, sup[data-footnote-id], .footnote-link") || /^\s*\[?\^?xwiki-\d+\]?\s*$/.test(next.textContent ?? "");
			if (!isReference) return;
			next.addClass(HIDDEN);
		} else return;
		next = following;
	}
}

/** Hides the references of inline comments in rendered Markdown: the reading view, and tables in Live Preview. */
export function tidyCommentReferences(root: HTMLElement): void {
	if (!root.textContent?.includes("💬") && !root.textContent?.includes("✅")) return;
	const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const icons: Text[] = [];
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (node.instanceOf(Text) && (node.data.includes("💬") || node.data.includes("✅")) && !inEditorText(node)) icons.push(node);
	}
	for (const icon of icons) {
		const highlight = icon.parentElement?.closest("mark, .cm-highlight");
		if (highlight && highlight.textContent?.startsWith("💬")) hideAfter(highlight);
		else if (highlight && highlight.textContent?.startsWith("✅")) {
			highlight.addClass(RESOLVED);
			hideAfter(highlight);
		}
		// The line of comments without a place: the icon alone, then the references.
		else if (icon.data.trim().endsWith("💬")) hideAfter(icon);
	}
}

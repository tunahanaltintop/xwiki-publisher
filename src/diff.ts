/**
 * Side by side comparison of two versions of a note: the lines that differ, and within a changed line the words that
 * differ. Free of Obsidian imports so it can be unit tested.
 */

/** One step from the old sequence to the new one: an item kept (`a` and `b`), removed (`a`) or added (`b`). */
export interface DiffStep {
	kind: "equal" | "delete" | "insert";
	/** Index in the old sequence, or -1. */
	a: number;
	/** Index in the new sequence, or -1. */
	b: number;
}

/** Above this many comparisons, the parts that differ are shown as replaced as a whole instead of aligned. */
const ALIGN_LIMIT = 4_000_000;

/**
 * The steps from `a` to `b` that keep the most items (longest common subsequence). Removals come before additions,
 * so a changed line is a removal followed by an addition.
 */
export function diffSequences<T>(a: readonly T[], b: readonly T[]): DiffStep[] {
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) start++;
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA--;
		endB--;
	}
	const steps: DiffStep[] = [];
	for (let i = 0; i < start; i++) steps.push({ kind: "equal", a: i, b: i });
	const n = endA - start;
	const m = endB - start;
	if (n * m > ALIGN_LIMIT) {
		for (let i = start; i < endA; i++) steps.push({ kind: "delete", a: i, b: -1 });
		for (let j = start; j < endB; j++) steps.push({ kind: "insert", a: -1, b: j });
	} else {
		// lengths[i * (m + 1) + j]: the longest common subsequence of a[start + i…] and b[start + j…].
		const width = m + 1;
		const lengths = new Uint32Array((n + 1) * width);
		for (let i = n - 1; i >= 0; i--) {
			for (let j = m - 1; j >= 0; j--) {
				lengths[i * width + j] =
					a[start + i] === b[start + j] ? lengths[(i + 1) * width + j + 1] + 1 : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
			}
		}
		let i = 0;
		let j = 0;
		while (i < n || j < m) {
			if (i < n && j < m && a[start + i] === b[start + j]) {
				steps.push({ kind: "equal", a: start + i++, b: start + j++ });
			} else if (j >= m || (i < n && lengths[(i + 1) * width + j] >= lengths[i * width + j + 1])) {
				steps.push({ kind: "delete", a: start + i++, b: -1 });
			} else {
				steps.push({ kind: "insert", a: -1, b: start + j++ });
			}
		}
	}
	for (let i = endA; i < a.length; i++) steps.push({ kind: "equal", a: i, b: endB + i - endA });
	return steps;
}

/** A part of a line, marked when it is not in the other version. */
export interface DiffSegment {
	text: string;
	changed: boolean;
}

/** A line of one side, numbered from 1. */
export interface DiffLine {
	number: number;
	segments: DiffSegment[];
}

/**
 * A row of the side by side view: a line on both sides (`equal`, or `change` with the words that differ marked), a
 * line only on the old side (`delete`) or only on the new side (`insert`).
 */
export interface DiffRow {
	kind: "equal" | "change" | "delete" | "insert";
	left?: DiffLine;
	right?: DiffLine;
}

/** Words, runs of spaces, runs of dashes and single other characters: what is marked within a changed line. */
function tokens(line: string): string[] {
	return line.match(/\s+|[\p{L}\p{N}_]+|-+|[^\s\p{L}\p{N}_]/gu) ?? [];
}

/** A table row of Markdown: its cells are padded with spaces, which Obsidian changes when it aligns the columns. */
function isTableRow(line: string): boolean {
	return line.trimStart().startsWith("|");
}

/**
 * What a line is compared by when spacing is ignored: runs of spaces count as one, spaces around table cells do not
 * count, nor does the length of the dashes of a table's separator row. Obsidian pads and aligns the cells of a table
 * when one cell of it is edited, which changes every row of it but nothing that is shown.
 */
export function lineKey(line: string): string {
	const key = line.replace(/\s+/g, " ").trim();
	if (!isTableRow(key)) return key;
	const cells = key
		.split("|")
		.map((cell) => cell.trim())
		.join("|");
	return /^[|:\- ]+$/.test(cells) ? cells.replace(/-+/g, "-") : cells;
}

/** What a token is compared by when spacing is ignored. */
function tokenKey(token: string): string {
	if (/^\s+$/.test(token)) return " ";
	return /^-{2,}$/.test(token) ? "-" : token;
}

/** Options of a comparison. */
export interface DiffOptions {
	/** Spacing does not count (the default): see `lineKey`. */
	ignoreWhitespace?: boolean;
}

function segments(parts: { text: string; changed: boolean }[]): DiffSegment[] {
	const merged: DiffSegment[] = [];
	for (const part of parts) {
		const last = merged[merged.length - 1];
		if (last && last.changed === part.changed) last.text += part.text;
		else merged.push({ ...part });
	}
	return merged;
}

/**
 * The words that differ between two versions of a line. Lines with little in common are marked as a whole: marking
 * the few words they share would only be noise.
 */
export function diffWords(oldLine: string, newLine: string, options: DiffOptions = {}): { left: DiffSegment[]; right: DiffSegment[] } {
	const ignore = options.ignoreWhitespace ?? true;
	const a = tokens(oldLine);
	const b = tokens(newLine);
	const steps = ignore ? diffSequences(a.map(tokenKey), b.map(tokenKey)) : diffSequences(a, b);
	// Spacing that is only on one side is not a change worth marking either.
	const marked = (token: string, kind: DiffStep["kind"]) => kind !== "equal" && !(ignore && /^\s+$/.test(token));
	const kept = steps.filter((step) => step.kind === "equal" && a[step.a].trim()).reduce((sum, step) => sum + a[step.a].length, 0);
	const size = Math.max(oldLine.replace(/\s/g, "").length, newLine.replace(/\s/g, "").length);
	if (size > 0 && kept / size < 0.3) return { left: [{ text: oldLine, changed: true }], right: [{ text: newLine, changed: true }] };
	return {
		left: segments(steps.filter((step) => step.kind !== "insert").map((step) => ({ text: a[step.a], changed: marked(a[step.a], step.kind) }))),
		right: segments(steps.filter((step) => step.kind !== "delete").map((step) => ({ text: b[step.b], changed: marked(b[step.b], step.kind) }))),
	};
}

/** The lines of a text, without the blank lines at its start, nor the blank lines and spaces at its end. */
export function lines(text: string): string[] {
	const trimmed = text
		.replace(/\r\n?/g, "\n")
		.replace(/^(?:[ \t]*\n)+/, "")
		.replace(/\s+$/, "");
	return trimmed ? trimmed.split("\n") : [];
}

/**
 * Compares two versions of a text line by line. Within a run of changed lines, removed and added lines are shown
 * side by side, in order, with the words that differ marked; the lines left over are only on one side.
 */
export function sideBySide(oldText: string, newText: string, options: DiffOptions = {}): DiffRow[] {
	const ignore = options.ignoreWhitespace ?? true;
	const a = lines(oldText);
	const b = lines(newText);
	const rows: DiffRow[] = [];
	let removed: number[] = [];
	let added: number[] = [];
	/**
	 * Shows a run of removed and added lines. The k-th removed line that is not blank is shown next to the k-th added
	 * one, with the words that differ marked; the lines left over are only on one side. When spacing does not count,
	 * a blank line on one side only is not a change: Markdown shows one blank line or two the same way. Rows keep the
	 * order of the lines on each side, which is what blocks are taken by.
	 */
	const flush = () => {
		const blank = (text: string) => ignore && !text.trim();
		const leftRanked = removed.filter((index) => !blank(a[index]));
		const rightRanked = added.filter((index) => !blank(b[index]));
		const paired = Math.min(leftRanked.length, rightRanked.length);
		const pairedLeft = new Set(leftRanked.slice(0, paired));
		const pairedRight = new Set(rightRanked.slice(0, paired));
		const line = (number: number, text: string, changed: boolean): DiffLine => ({ number: number + 1, segments: [{ text, changed }] });
		let i = 0;
		let j = 0;
		while (i < removed.length || j < added.length) {
			const left = i < removed.length ? removed[i] : undefined;
			const right = j < added.length ? added[j] : undefined;
			if (left !== undefined && blank(a[left])) {
				rows.push({ kind: "equal", left: line(left, a[left], false) });
				i++;
			} else if (right !== undefined && blank(b[right])) {
				rows.push({ kind: "equal", right: line(right, b[right], false) });
				j++;
			} else if (left !== undefined && right !== undefined && pairedLeft.has(left) && pairedRight.has(right)) {
				const words = diffWords(a[left], b[right], options);
				rows.push({ kind: "change", left: { number: left + 1, segments: words.left }, right: { number: right + 1, segments: words.right } });
				i++;
				j++;
			} else if (left !== undefined && !pairedLeft.has(left)) {
				rows.push({ kind: "delete", left: line(left, a[left], true) });
				i++;
			} else if (right !== undefined) {
				rows.push({ kind: "insert", right: line(right, b[right], true) });
				j++;
			} else if (left !== undefined) {
				rows.push({ kind: "delete", left: line(left, a[left], true) });
				i++;
			}
		}
		removed = [];
		added = [];
	};
	for (const step of ignore ? diffSequences(a.map(lineKey), b.map(lineKey)) : diffSequences(a, b)) {
		if (step.kind === "delete") removed.push(step.a);
		else if (step.kind === "insert") added.push(step.b);
		else {
			flush();
			const same = (index: number, text: string): DiffLine => ({ number: index + 1, segments: [{ text, changed: false }] });
			rows.push({ kind: "equal", left: same(step.a, a[step.a]), right: same(step.b, b[step.b]) });
		}
	}
	flush();
	return rows;
}

/** Unchanged rows left out of the view, shown as one row that can be opened. */
export interface DiffFold {
	kind: "fold";
	/** Index of the first row left out. */
	start: number;
	count: number;
}

/**
 * The rows to show: the changed ones with `context` unchanged rows around them; longer runs of unchanged rows are
 * folded, unless their first row is in `open`.
 */
export function foldRows(rows: DiffRow[], context = 3, open: ReadonlySet<number> = new Set()): (DiffRow | DiffFold)[] {
	const near = new Uint8Array(rows.length);
	rows.forEach((row, index) => {
		if (row.kind !== "equal") near.fill(1, Math.max(0, index - context), Math.min(rows.length, index + context + 1));
	});
	const shown: (DiffRow | DiffFold)[] = [];
	for (let index = 0; index < rows.length; ) {
		if (near[index]) {
			shown.push(rows[index++]);
			continue;
		}
		let end = index;
		while (end < rows.length && !near[end]) end++;
		// Folding one or two rows hides less than the row that stands for them takes.
		if (end - index <= 2 || open.has(index)) shown.push(...rows.slice(index, end));
		else shown.push({ kind: "fold", start: index, count: end - index });
		index = end;
	}
	return shown;
}

/** Lines only in the old version, and only in the new one; a changed line counts on both sides. */
export function diffCounts(rows: DiffRow[]): { removed: number; added: number } {
	let removed = 0;
	let added = 0;
	for (const row of rows) {
		if (row.kind === "delete" || row.kind === "change") removed++;
		if (row.kind === "insert" || row.kind === "change") added++;
	}
	return { removed, added };
}

/**
 * A block of changed rows: a run of rows that are not equal. `left` and `right` are the lines of each side that it
 * covers, as `[first, after last)` indexes; an empty range is where the lines of the other side would go.
 */
export interface DiffHunk {
	/** Index of its first row. */
	start: number;
	/** Index after its last row. */
	end: number;
	left: [number, number];
	right: [number, number];
}

/**
 * The blocks of changed rows, in order. A blank line on one side only, right before or after changed rows, belongs to
 * their block: taking the block takes it too, so a new paragraph or table keeps the blank line that sets it apart.
 * Such lines alone, away from any change, make no block.
 */
export function diffHunks(rows: DiffRow[]): DiffHunk[] {
	const hunks: DiffHunk[] = [];
	let left = 0;
	let right = 0;
	let open: DiffHunk | null = null;
	/** Blank lines on one side only, seen since the last line on both sides: the start of a block, if one follows. */
	let pending: { start: number; left: number; right: number } | null = null;
	rows.forEach((row, index) => {
		const blankOnOneSide = row.kind === "equal" && (!row.left || !row.right);
		if (row.kind === "equal" && !blankOnOneSide) {
			if (open) hunks.push(open);
			open = null;
			pending = null;
		} else if (blankOnOneSide) {
			if (!open) pending ??= { start: index, left, right };
		} else {
			const from: { start: number; left: number; right: number } = pending ?? { start: index, left, right };
			open ??= { start: from.start, end: index, left: [from.left, from.left], right: [from.right, from.right] };
			pending = null;
		}
		if (row.left) left++;
		if (row.right) right++;
		if (open) {
			open.end = index + 1;
			open.left[1] = left;
			open.right[1] = right;
		}
	});
	if (open) hunks.push(open);
	return hunks;
}

/**
 * `target` with the lines `targetRange` replaced by the lines `sourceRange` of `source`: one block of a comparison
 * taken from the other side. The rest of `target` stays as it is, spacing included.
 */
export function replaceLines(target: string, targetRange: [number, number], source: string, sourceRange: [number, number]): string {
	const into = lines(target);
	const from = lines(source);
	const result = [...into.slice(0, targetRange[0]), ...from.slice(sourceRange[0], sourceRange[1]), ...into.slice(targetRange[1])];
	return result.length > 0 ? `${result.join("\n")}\n` : "";
}

/** Whether two texts show the same, spacing aside: nothing left to compare. */
export function sameText(a: string, b: string): boolean {
	return sideBySide(a, b).every((row) => row.kind === "equal");
}

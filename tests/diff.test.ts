import { test } from "node:test";
import assert from "node:assert/strict";
import { diffCounts, diffHunks, diffSequences, diffWords, foldRows, lineKey, replaceLines, sameText, sideBySide, type DiffRow } from "../src/diff.ts";

/** A row as text: `=` kept, `~` changed with the marked words in brackets, `-` only on the left, `+` only on the right. */
function show(row: DiffRow): string {
	const side = (line: DiffRow["left"]) => (line ? `${line.number}:${line.segments.map((s) => (s.changed && row.kind === "change" ? `[${s.text}]` : s.text)).join("")}` : "");
	const mark = { equal: "=", change: "~", delete: "-", insert: "+" }[row.kind];
	return `${mark} ${side(row.left)} | ${side(row.right)}`;
}

test("aligns the lines that are kept", () => {
	const steps = diffSequences(["a", "b", "c", "d"], ["a", "c", "x", "d"]);
	assert.deepEqual(
		steps.map((step) => step.kind),
		["equal", "delete", "equal", "insert", "equal"],
	);
	assert.deepEqual(diffSequences([], ["x"]), [{ kind: "insert", a: -1, b: 0 }]);
	assert.deepEqual(diffSequences(["x"], []), [{ kind: "delete", a: 0, b: -1 }]);
});

test("shows a note side by side, with the changed words marked", () => {
	const old = "# Plan\n\nBütçe 1,2M TL olarak onaylandı.\nSilinecek satır.\nSon satır.\n";
	const next = "# Plan\n\nBütçe 1,5M TL olarak onaylandı.\nSon satır.\nYeni satır.\n";
	assert.deepEqual(sideBySide(old, next).map(show), [
		"= 1:# Plan | 1:# Plan",
		"= 2: | 2:",
		"~ 3:Bütçe 1,[2M] TL olarak onaylandı. | 3:Bütçe 1,[5M] TL olarak onaylandı.",
		"- 4:Silinecek satır. | ",
		"= 5:Son satır. | 4:Son satır.",
		"+  | 5:Yeni satır.",
	]);
	assert.deepEqual(diffCounts(sideBySide(old, next)), { removed: 2, added: 2 });
	// The same text, whatever its line endings and trailing blank lines.
	assert.ok(sideBySide("a\r\nb\n\n", "a\nb").every((row) => row.kind === "equal"));
	assert.deepEqual(sideBySide("", "").length, 0);
	assert.deepEqual(sideBySide("", "x").map(show), ["+  | 1:x"]);
});

test("lines with little in common are marked as a whole", () => {
	assert.deepEqual(diffWords("Tamamen farklı bir cümle", "Başka şeyler yazıyor burada"), {
		left: [{ text: "Tamamen farklı bir cümle", changed: true }],
		right: [{ text: "Başka şeyler yazıyor burada", changed: true }],
	});
	assert.deepEqual(diffWords("| a | b |", "| a | c |").right, [
		{ text: "| a | ", changed: false },
		{ text: "c", changed: true },
		{ text: " |", changed: false },
	]);
});

test("folds long runs of unchanged lines", () => {
	const old = Array.from({ length: 20 }, (_, i) => `satır ${i + 1}`).join("\n");
	const next = old.replace("satır 10", "satır on");
	const rows = sideBySide(old, next);
	const shown = foldRows(rows, 2);
	assert.deepEqual(
		shown.map((row) => (row.kind === "fold" ? `fold ${row.start}+${row.count}` : row.kind)),
		["fold 0+7", "equal", "equal", "change", "equal", "equal", "fold 12+8"],
	);
	assert.equal(foldRows(rows, 2, new Set([0])).length, 7 + 6);
	// Nothing to fold in a short note.
	assert.ok(foldRows(sideBySide("a\nb\nc", "a\nx\nc"), 3).every((row) => row.kind !== "fold"));
});

test("spacing does not count: Obsidian pads the cells of a table when one of them is edited", () => {
	const xwiki = [
		"| Alan | Değer |",
		"| --- | --- |",
		"| Doküman Adı | Proje - Arayüz Listesi |",
		"| HAZIRLAYAN | Alex SMITH | 2026-10-10 |  |",
	].join("\n");
	const vault = [
		"| Alan        | Değer                                                      |",
		"| ----------- | ---------------------------------------------------------- |",
		"| Doküman Adı | Proje - Arayüz Listesi                            |",
		"| HAZIRLAYAN  | [@Alex Smith](https://wiki/bin/view/XWiki/asmith) | 2026-10-10 |   |",
	].join("\n");
	const rows = sideBySide(xwiki, vault);
	assert.deepEqual(
		rows.map((row) => row.kind),
		["equal", "equal", "equal", "change"],
	);
	// Only what was written is marked: the mention, not the spaces around the cells.
	const marked = (side?: { segments: { text: string; changed: boolean }[] }) => side?.segments.filter((s) => s.changed).map((s) => s.text);
	assert.deepEqual(marked(rows[3].left), ["SMITH"]);
	assert.deepEqual(marked(rows[3].right), ["[@", "Smith](https://wiki/bin/view/XWiki/asmith)"]);
	// The original text is shown, padding included.
	assert.equal(rows[0].right?.segments[0].text, "| Alan        | Değer                                                      |");
	// Asked for, spacing counts.
	assert.deepEqual(diffCounts(sideBySide(xwiki, vault, { ignoreWhitespace: false })), { removed: 4, added: 4 });

	assert.equal(lineKey("|  a   |b| "), "|a|b|");
	assert.equal(lineKey("| :---- | ---: |"), "|:-|-:|");
	assert.equal(lineKey("Bir   cümle  burada. "), "Bir cümle burada.");
	// Outside tables, a word is not split by spacing.
	assert.notEqual(lineKey("Bir cümle"), lineKey("Bircümle"));
});

test("blocks of changes can be taken from one side to the other, one by one", () => {
	const page = "# Plan\n\nBütçe 1,2M TL.\nSilinecek satır.\nOrta.\nSon.\n";
	const note = "# Plan\n\nBütçe 1,5M TL.\nOrta.\nSon.\nYeni satır.\n";
	const rows = sideBySide(page, note);
	const hunks = diffHunks(rows);
	assert.deepEqual(
		hunks.map((hunk) => ({ left: hunk.left, right: hunk.right })),
		[
			{ left: [2, 4], right: [2, 3] },
			{ left: [6, 6], right: [5, 6] },
		],
	);
	// The page gets the first block of the note; the second stays a difference.
	const published = replaceLines(page, hunks[0].left, note, hunks[0].right);
	assert.equal(published, "# Plan\n\nBütçe 1,5M TL.\nOrta.\nSon.\n");
	assert.equal(diffHunks(sideBySide(published, note)).length, 1);
	// The note gets the page's lines back for the second block (a line only in the note is removed).
	const reverted = replaceLines(note, hunks[1].right, page, hunks[1].left);
	assert.equal(reverted, "# Plan\n\nBütçe 1,5M TL.\nOrta.\nSon.\n");
	assert.ok(sameText(published, reverted));
	// A block at the very start, and one that empties a text.
	assert.equal(replaceLines("a\nb\n", [0, 1], "x\n", [0, 1]), "x\nb\n");
	assert.equal(replaceLines("a\n", [0, 1], "", [0, 0]), "");
	// Spacing of a table realigned by Obsidian is the same text.
	assert.ok(sameText("| a | b |\n", "| a     | b   |\n"));
});

test("blank lines at the start, and blank lines on one side only, are spacing", () => {
	// The note has a blank line after its properties; the page starts with its table.
	const page = "| Alan | Değer |\n| --- | --- |\n| A | B |\n";
	const note = "\n| Alan   | Değer |\n| ------ | ----- |\n| A      | B     |\n";
	assert.ok(sideBySide(page, note).every((row) => row.kind === "equal"));
	assert.ok(sameText(page, note));
	// One blank line more between paragraphs.
	assert.ok(sameText("Bir.\n\nİki.\n", "Bir.\n\n\nİki.\n"));
	// A real change next to an extra blank line is still the only change.
	const rows = sideBySide("Bir.\n\nİki.\n", "Bir.\n\n\nÜç.\n");
	assert.deepEqual(
		rows.filter((row) => row.kind !== "equal").map((row) => [row.left?.segments.map((s) => s.text).join(""), row.right?.segments.map((s) => s.text).join("")]),
		[["İki.", "Üç."]],
	);
	// Asked for, they count.
	assert.equal(diffCounts(sideBySide(page, note, { ignoreWhitespace: false })).added > 0, true);
	// Taking a block keeps working with the blank line at the start.
	const hunks = diffHunks(sideBySide("x\n", "\ny\n"));
	assert.equal(replaceLines("\ny\n", hunks[0].right, "x\n", hunks[0].left), "x\n");
});

test("rows keep the order of the lines of each side, so that a block taken is the right lines", () => {
	const page = "# Başlık\n\n| tablo |\n";
	const note = "# Başlık\n\nYeni satır.\n\n| tablo |\n";
	const rows = sideBySide(page, note);
	const numbers = (side: "left" | "right") => rows.flatMap((row) => (row[side] ? [row[side].number] : []));
	assert.deepEqual(numbers("left"), [1, 2, 3]);
	assert.deepEqual(numbers("right"), [1, 2, 3, 4, 5]);
	const [hunk] = diffHunks(rows);
	// The block is the new line and the blank line that sets it apart from the table.
	assert.equal(replaceLines(page, hunk.left, note, hunk.right), note);
	assert.equal(replaceLines(note, hunk.right, page, hunk.left), page);
	assert.ok(sameText(replaceLines(page, hunk.left, note, hunk.right), note));
	assert.ok(sameText(replaceLines(note, hunk.right, page, hunk.left), page));
	// Many removed and added lines, blank ones among them: each side in order.
	const mixed = sideBySide("a\nb\n\nc\nd\n", "a\nx\n\n\ny\nz\nd\n");
	for (const side of ["left", "right"] as const) {
		const seen = mixed.flatMap((row) => (row[side] ? [row[side].number] : []));
		assert.deepEqual(seen, [...seen].sort((p, q) => p - q));
	}
});

test("blank lines on one side only, away from any change, make no block", () => {
	assert.deepEqual(diffHunks(sideBySide("Bir.\n\nİki.\n", "Bir.\n\n\nİki.\n")), []);
});

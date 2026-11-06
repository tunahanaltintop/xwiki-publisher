import { test } from "node:test";
import assert from "node:assert/strict";
import { deletedNotes, deletionBlocker, deletionOrder, noteBasename } from "../src/deletions.ts";

const record = (reference?: string, version = "1.1") => ({ version, reference });

test("lists deleted notes by path, with the page they were synced with", () => {
	const notes = deletedNotes({ "b/Two.md": record("A.Two.WebHome", "2.1"), "a/One.md": record("A.One") }, new Set());
	assert.deepEqual(notes, [
		{ path: "a/One.md", reference: "A.One", location: { spaces: ["A"], page: "One" }, version: "1.1" },
		{ path: "b/Two.md", reference: "A.Two.WebHome", location: { spaces: ["A", "Two"], page: "WebHome" }, version: "2.1" },
	]);
});

test("keeps escaped page names intact", () => {
	const [note] = deletedNotes({ "x.md": record("Ekip Alanı.a\\.b.WebHome") }, new Set());
	assert.deepEqual(note.location, { spaces: ["Ekip Alanı", "a.b"], page: "WebHome" });
});

test("never offers a page another note still belongs to", () => {
	assert.deepEqual(deletedNotes({ "Copy.md": record("A.Real") }, new Set(["A.Real"])), []);
});

test("never guesses the page of a record without a reference", () => {
	assert.deepEqual(deletedNotes({ "Old.md": record() }, new Set()), []);
});

test("lists a page once when two deleted notes shared it", () => {
	const notes = deletedNotes({ "One.md": record("A.Page"), "Two.md": record("A.Page") }, new Set());
	assert.deepEqual(notes.map((note) => note.path), ["One.md"]);
});

test("deletes the pages below a page first", () => {
	const notes = deletedNotes({ "a.md": record("A.WebHome"), "b.md": record("A.B.WebHome"), "c.md": record("A.B.C") }, new Set());
	assert.deepEqual(deletionOrder(notes).map((note) => note.reference), ["A.B.C", "A.B.WebHome", "A.WebHome"]);
});

test("a page in sync with the note may be deleted", () => {
	assert.equal(deletionBlocker({ syntax: "markdown/1.2", version: "2.1" }, "2.1"), null);
});

test("a page changed on XWiki is kept", () => {
	assert.equal(deletionBlocker({ syntax: "markdown/1.2", version: "3.1" }, "2.1"), "changed on XWiki");
});

test("a page not written in Markdown is kept", () => {
	assert.equal(deletionBlocker({ syntax: "xwiki/2.1", version: "2.1" }, "2.1"), "written in xwiki/2.1");
});

test("names a note from its path", () => {
	assert.equal(noteBasename("A/B/Not.md"), "Not");
	assert.equal(noteBasename("Not.md"), "Not");
});

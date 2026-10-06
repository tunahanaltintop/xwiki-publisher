import { test } from "node:test";
import assert from "node:assert/strict";
import { locateNote, splitSpaceReference } from "../src/location.ts";

const base = { defaultSpace: "Docs", mirrorFolders: false, nestedPages: true };

test("splits escaped space references", () => {
	assert.deepEqual(splitSpaceReference("Docs.Team\\.A.B"), ["Docs", "Team.A", "B"]);
	assert.deepEqual(splitSpaceReference(""), []);
});

test("nested page in default space", () => {
	assert.deepEqual(locateNote("a/b/Note.md", "Note", undefined, base), { spaces: ["Docs", "Note"], page: "WebHome" });
});

test("mirrors folders", () => {
	assert.deepEqual(locateNote("a/b/Note.md", "Note", undefined, { ...base, mirrorFolders: true }), {
		spaces: ["Docs", "a", "b", "Note"],
		page: "WebHome",
	});
});

test("frontmatter overrides and terminal pages", () => {
	const fm = { "xwiki-space": "Team.Dev", "xwiki-page": "Guide" };
	assert.deepEqual(locateNote("Note.md", "Note", fm, { ...base, nestedPages: false }), { spaces: ["Team", "Dev"], page: "Guide" });
	assert.deepEqual(locateNote("Note.md", "Note", undefined, { ...base, defaultSpace: "", nestedPages: false }), {
		spaces: ["Main"],
		page: "Note",
	});
});

test("decodes percent-encoded space names copied from URLs", () => {
	assert.deepEqual(splitSpaceReference("Ekip%20Alan%C4%B1.Sub"), ["Ekip Alanı", "Sub"]);
	assert.deepEqual(splitSpaceReference("Ekip%20Alanı"), ["Ekip Alanı"]);
	assert.deepEqual(splitSpaceReference("100%"), ["100%"]);
});

import { parseReference, serializeReference, vaultPathFor } from "../src/location.ts";

test("references round-trip with escaping", () => {
	const loc = { spaces: ["Ekip Alanı", "a.b"], page: "WebHome" };
	assert.equal(serializeReference(loc), "Ekip Alanı.a\\.b.WebHome");
	assert.deepEqual(parseReference(serializeReference(loc)), loc);
	assert.deepEqual(parseReference("Solo"), { spaces: ["Solo"], page: "WebHome" });
});

test("xwiki-reference frontmatter wins", () => {
	assert.deepEqual(locateNote("x/Note.md", "Note", { "xwiki-reference": "A.B.WebHome" }, base), { spaces: ["A", "B"], page: "WebHome" });
});

test("pulled pages mirror the whole page tree from the wiki root", () => {
	assert.equal(vaultPathFor({ spaces: ["A"], page: "WebHome" }, "XWiki"), "XWiki/A.md");
	assert.equal(vaultPathFor({ spaces: ["A", "B"], page: "WebHome" }, "XWiki"), "XWiki/A/B.md");
	assert.equal(vaultPathFor({ spaces: ["A", "B"], page: "Terminal" }, "XWiki/"), "XWiki/A/B/Terminal.md");
	assert.equal(vaultPathFor({ spaces: ["A", "x/y"], page: "WebHome" }, ""), "A/x-y.md");
});

import { folderPages } from "../src/location.ts";

test("lists folder pages for mirrored notes only", () => {
	const options = { defaultSpace: "Ekip Alanı", mirrorFolders: true, nestedPages: true };
	assert.deepEqual(folderPages("XWiki Test/Sub/Note.md", undefined, options), [
		{ location: { spaces: ["Ekip Alanı", "XWiki Test"], page: "WebHome" }, title: "XWiki Test" },
		{ location: { spaces: ["Ekip Alanı", "XWiki Test", "Sub"], page: "WebHome" }, title: "Sub" },
	]);
	assert.deepEqual(locateNote("XWiki Test/Sub/Note.md", "Note", undefined, options), {
		spaces: ["Ekip Alanı", "XWiki Test", "Sub", "Note"],
		page: "WebHome",
	});
	assert.deepEqual(folderPages("Note.md", undefined, options), []);
	assert.deepEqual(folderPages("A/Note.md", { "xwiki-space": "X" }, options), []);
	assert.deepEqual(folderPages("A/Note.md", undefined, { ...options, mirrorFolders: false }), []);
});

import { parseSpaceInput } from "../src/location.ts";

test("sync input accepts folder URLs and references", () => {
	const base = "https://wiki.example.com";
	const url = "https://wiki.example.com/bin/view/Ekip%20Alan%C4%B1/Proje%20Dizini/Di%C4%9Fer%20Dok%C3%BCmanlar/";
	const expected = ["Ekip Alanı", "Proje Dizini", "Diğer Dokümanlar"];
	assert.deepEqual(parseSpaceInput(url, base), expected);
	assert.deepEqual(parseSpaceInput(`${url}WebHome`, base), expected);
	assert.deepEqual(parseSpaceInput(`${url}?viewer=children`, base + "/"), expected);
	assert.deepEqual(parseSpaceInput("Ekip Alanı.Proje Dizini.Diğer Dokümanlar", base), expected);
	assert.deepEqual(parseSpaceInput("https://other.example.com/bin/view/A", base), []);
});

test("pulled notes and folders are named after page titles", () => {
	const loc = { spaces: ["Ekip Alanı", "Dizin", "Ar-Ge Çalışmaları"], page: "WebHome" };
	assert.equal(
		vaultPathFor(loc, "XWiki", [undefined, "Proje Dizini", "Yapay Zeka: Ar-Ge"]),
		"XWiki/Ekip Alanı/Proje Dizini/Yapay Zeka- Ar-Ge.md",
	);
	assert.equal(vaultPathFor(loc, "XWiki"), "XWiki/Ekip Alanı/Dizin/Ar-Ge Çalışmaları.md");
});

test("notes created in a pulled folder are published below that folder's page", () => {
	const options = { defaultSpace: "Obsidian", mirrorFolders: true, nestedPages: true };
	const anchor = (folder: string) =>
		folder === "Ekip Alanı/Proje Dizini/Diğer Dokümanlar"
			? { spaces: ["Ekip Alanı", "Proje Dizini", "Diğer Dokümanlar"], page: "WebHome" }
			: null;
	const path = "Ekip Alanı/Proje Dizini/Diğer Dokümanlar/Yeni/Not.md";
	assert.deepEqual(locateNote(path, "Not", undefined, options, anchor), {
		spaces: ["Ekip Alanı", "Proje Dizini", "Diğer Dokümanlar", "Yeni", "Not"],
		page: "WebHome",
	});
	assert.deepEqual(folderPages(path, undefined, options, anchor), [
		{ location: { spaces: ["Ekip Alanı", "Proje Dizini", "Diğer Dokümanlar", "Yeni"], page: "WebHome" }, title: "Yeni" },
	]);
	// Without a pulled folder note the default space rule applies.
	assert.deepEqual(locateNote("Projeler/Not.md", "Not", undefined, options, anchor), { spaces: ["Obsidian", "Projeler", "Not"], page: "WebHome" });
});

import { folderNotePath, ownFolder } from "../src/location.ts";

test("folder note paths follow the Folder notes plugin layouts", () => {
	const inside = { defaultSpace: "Docs", mirrorFolders: true, nestedPages: true, folderNoteLocation: "inside" as const, folderNoteName: "{{folder_name}}" };
	const parent = { ...inside, folderNoteLocation: "parent" as const };
	assert.equal(folderNotePath("A/B", inside), "A/B/B.md");
	assert.equal(folderNotePath("A/B", parent), "A/B.md");
	assert.equal(folderNotePath("A/B", { ...inside, folderNoteName: "_index" }), "A/B/_index.md");
	assert.equal(folderNotePath("A/B", { ...parent, folderNoteName: "_index" }), "A/B.md");
	assert.equal(folderNotePath("B", { ...parent, folderNoteName: "{{folder_name}} (folder)" }), "B (folder).md");
	assert.equal(ownFolder("A/B/B.md", inside), "A/B");
	assert.equal(ownFolder("A/B/C.md", inside), null);
	assert.equal(ownFolder("A/B/B.md", parent), null);
});

test("folder notes inside their folder are published as the folder's page", () => {
	const options = { defaultSpace: "Docs", mirrorFolders: true, nestedPages: true, folderNoteLocation: "inside" as const, folderNoteName: "{{folder_name}}" };
	assert.deepEqual(locateNote("Projects/Alpha/Alpha.md", "Alpha", undefined, options), { spaces: ["Docs", "Projects", "Alpha"], page: "WebHome" });
	assert.deepEqual(locateNote("Projects/Alpha/Note.md", "Note", undefined, options), { spaces: ["Docs", "Projects", "Alpha", "Note"], page: "WebHome" });
	assert.deepEqual(locateNote("Projects/Alpha/_index.md", "_index", undefined, { ...options, folderNoteName: "_index" }), {
		spaces: ["Docs", "Projects", "Alpha"],
		page: "WebHome",
	});
	// Only the folders above a folder note need pages.
	assert.deepEqual(
		folderPages("Projects/Alpha/Alpha.md", undefined, options).map((p) => p.title),
		["Projects"],
	);
	// Pulled pages with children become folder notes inside their folder.
	assert.equal(vaultPathFor({ spaces: ["A", "B"], page: "WebHome" }, "", ["A", "Proje B"], options), "A/Proje B/Proje B.md");
	assert.equal(vaultPathFor({ spaces: ["A", "B"], page: "WebHome" }, "", ["A", "Proje B"]), "A/Proje B.md");
});

import { parseXWikiTarget } from "../src/location.ts";

test("interprets XWiki references found in page content", () => {
	const current = { spaces: ["Team", "Guide"], page: "WebHome" };
	assert.deepEqual(parseXWikiTarget("https://e.com/x", current, false), { kind: "url", url: "https://e.com/x" });
	assert.deepEqual(parseXWikiTarget("logo.png", current, true), { kind: "attachment", pages: null, name: "logo.png" });
	assert.deepEqual(parseXWikiTarget("attach:Docs.Other@plan.pdf", current, false), {
		kind: "attachment",
		pages: [
			{ spaces: ["Docs"], page: "Other" },
			{ spaces: ["Docs", "Other"], page: "WebHome" },
		],
		name: "plan.pdf",
	});
	assert.deepEqual(parseXWikiTarget("page:../Setup", current, false), { kind: "page", candidates: [{ spaces: ["Team", "Setup"], page: "WebHome" }] });
	assert.deepEqual(parseXWikiTarget("doc:xwiki:Main.WebHome", current, false), { kind: "page", candidates: [{ spaces: ["Main"], page: "WebHome" }] });
	assert.deepEqual(parseXWikiTarget("page:Team/Setup", current, false), { kind: "page", candidates: [{ spaces: ["Team", "Setup"], page: "WebHome" }] });
	assert.deepEqual(parseXWikiTarget("Docs.Other", current, false).kind, "page");
	assert.deepEqual((parseXWikiTarget("Sibling", current, false) as { candidates: unknown[] }).candidates[0], { spaces: ["Team", "Guide"], page: "Sibling" });
});

import { attachmentFolderFor, numberedPath } from "../src/location.ts";

test("attachments of pulled notes go to a subfolder next to the note", () => {
	assert.equal(attachmentFolderFor("Ekip Alanı/Projeler/Plan.md", "assets"), "Ekip Alanı/Projeler/assets");
	assert.equal(attachmentFolderFor("Plan.md", "assets"), "assets");
	assert.equal(attachmentFolderFor("A/B/B.md", "/assets/"), "A/B/assets");
	assert.equal(numberedPath("A/assets/logo.png", 2), "A/assets/logo 2.png");
	assert.equal(numberedPath("A/Not.md", 3), "A/Not 3.md");
	assert.equal(numberedPath("A.b/README", 2), "A.b/README 2");
});


test("folders inside a dedicated sync folder mirror spaces from the wiki root", () => {
	const options = { defaultSpace: "Main", mirrorFolders: true, nestedPages: true, syncFolder: "XWiki" };
	assert.deepEqual(locateNote("XWiki/New.md", "New", undefined, options), { spaces: ["New"], page: "WebHome" });
	assert.deepEqual(locateNote("XWiki/A/New.md", "New", undefined, options), { spaces: ["A", "New"], page: "WebHome" });
	assert.deepEqual(folderPages("XWiki/A/New.md", undefined, options).map((p) => p.location), [{ spaces: ["A"], page: "WebHome" }]);
	// Outside the sync folder the default space rule still applies.
	assert.deepEqual(locateNote("Notes/New.md", "New", undefined, options), { spaces: ["Main", "Notes", "New"], page: "WebHome" });
});

import { numberedMatch } from "../src/location.ts";

test("recognises attachment files renamed to avoid a clash", () => {
	assert.equal(numberedMatch("img.png", "img 1.png"), true);
	assert.equal(numberedMatch("img.png", "img 12.png"), true);
	assert.equal(numberedMatch("img.png", "img.png"), false);
	assert.equal(numberedMatch("img.png", "img 1.jpg"), false);
	assert.equal(numberedMatch("a(1).pdf", "a(1) 2.pdf"), true);
});

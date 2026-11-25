import { test } from "node:test";
import assert from "node:assert/strict";
import { convertNote } from "../src/converter.ts";
import { convertFromXWiki } from "../src/reverse.ts";
import { addInlineComments, commentThreads } from "../src/inline-comments.ts";
import { issueLink, issueMacro, issuesForEditing, issuesToLinks, keyPrefixes, typedKey, linksToIssues, parseWorkPackages, searchedKey } from "../src/issues.ts";
import { sendable } from "../src/mentions.ts";
import { workPackagesIn } from "../src/openproject.ts";

const OP = "https://op.example.com/";

test("issue macros are pulled as links to the work packages and published as the macros they were", () => {
	const page = '| Talep | {{issue key="IKN-2349"/}} |\n| --- | --- |\n\nBkz. {{issue key="42"/}}.\n';
	const pulled = convertFromXWiki(page, () => null, { openProjectUrl: OP }).markdown;
	assert.equal(pulled, "| Talep | [IKN-2349](https://op.example.com/wp/IKN-2349) |\n| --- | --- |\n\nBkz. [42](https://op.example.com/wp/42).\n");
	assert.equal(convertNote(pulled, () => null, { openProjectUrl: OP }).markdown, page);
});

test("links written to work packages stay links", () => {
	const note = [
		"[IKN-60](https://op.example.com/work_packages/IKN-60)",
		"[IKN-61](https://op.example.com/projects/IKN/work_packages/IKN-61)",
		"[Talep](https://op.example.com/wp/IKN-62)",
		"![IKN-63](https://op.example.com/wp/IKN-63)",
		"`[IKN-64](https://op.example.com/wp/IKN-64)`",
	].join("\n\n");
	// Code is an example: it is published as it is.
	const published = convertNote(note, () => null, { openProjectUrl: OP }).markdown;
	assert.ok(!published.includes("{{issue"));
	assert.ok(published.includes("`[IKN-64](https://op.example.com/wp/IKN-64)`"));
	// Without the address of OpenProject nothing is converted.
	assert.equal(linksToIssues("[IKN-1](https://op.example.com/wp/IKN-1)", ""), "[IKN-1](https://op.example.com/wp/IKN-1)");
});

test("macros that would not come back as they are stay macros", () => {
	for (const macro of ['{{issue key="IKN-1" /}}', '{{issue key="IKN 1"/}}', '{{issue key="IKN-1" style="full"/}}', "{{issue key='IKN-1'/}}"]) {
		assert.equal(issuesToLinks(macro, OP), macro);
	}
	assert.equal(issueLink(OP, "not a key"), null);
});

test("issue macros count as links of the page in OpenProject", () => {
	const text = `[a](${OP}work_packages/IKN-1) {{issue key="ikn-2"/}} {{issue key="IKN-1"/}}\n\`{{issue key="IKN-3"/}}\``;
	assert.deepEqual(workPackagesIn(text, OP), ["IKN-1", "IKN-2"]);
});

test("work packages are read from OpenProject answers by their display id", () => {
	const element = (id: number, displayId: unknown, subject: string) => ({
		_type: "WorkPackage",
		id,
		displayId,
		subject,
		_links: { project: { title: "IKNet" }, type: { title: "Task" }, status: { title: "New" } },
	});
	assert.deepEqual(parseWorkPackages({ _type: "WorkPackageCollection", _embedded: { elements: [element(7, "IKN-42", "Giriş"), element(8, undefined, "Eski"), element(9, "#9", "Sayı")] } }), [
		{ key: "IKN-42", subject: "Giriş", project: "IKNet", type: "Task", status: "New" },
		{ key: "8", subject: "Eski", project: "IKNet", type: "Task", status: "New" },
		{ key: "9", subject: "Sayı", project: "IKNet", type: "Task", status: "New" },
	]);
	assert.equal(parseWorkPackages(element(1, "IKN-1", "Tek"))[0].key, "IKN-1");
	assert.deepEqual(parseWorkPackages(null), []);
	assert.equal(searchedKey(" ikn-42 "), "IKN-42");
	assert.equal(searchedKey("#42"), "42");
	assert.equal(searchedKey("giriş ekranı"), null);
});

test("work packages chosen in a comment are sent as issue macros, and shown as #keys when it is edited", () => {
	const chosen = [
		{ shown: "#IKN-4", macro: issueMacro("IKN-4") },
		{ shown: "#IKN-42", macro: issueMacro("IKN-42") },
		{ shown: "@Ali", macro: "{{mention ali/}}" },
		{ shown: "@Ali Veli", macro: "{{mention veli/}}" },
	];
	assert.equal(
		sendable("  #IKN-42 ve #IKN-4'e bak, @Ali Veli ile @Ali da #IKN-4x değil  ", chosen),
		'{{issue key="IKN-42"/}} ve {{issue key="IKN-4"/}}\'e bak, {{mention veli/}} ile {{mention ali/}} da #IKN-4x değil',
	);
	const source = 'Bkz. {{issue key="IKN-42"/}} ve {{issue key="IKN-42"/}}, {{issue key="IKN-1" /}}';
	const { text, mentions } = issuesForEditing(source);
	assert.equal(text, 'Bkz. #IKN-42 ve #IKN-42, {{issue key="IKN-1" /}}');
	assert.equal(sendable(text, mentions), source);
});

test("work packages of comments show as links, and never link the page in OpenProject", () => {
	const selections = new Map([[0, { selection: "metin", before: "", after: "" }]]);
	const [thread] = commentThreads([{ id: 0, author: "A", text: 'Bkz. {{issue key="IKN-42"/}}' }], selections, "markdown/1.2", undefined, null, OP);
	assert.equal(thread.entries[0].text, "Bkz. [IKN-42](https://op.example.com/wp/IKN-42)");
	// The note shows the comment in a footnote; publishing leaves it out, so OpenProject never hears of IKN-42.
	const note = addInlineComments("Bir metin var.\n", [thread]);
	assert.ok(note.includes("/wp/IKN-42"));
	const published = convertNote(note, () => null, { openProjectUrl: OP }).markdown;
	assert.deepEqual(workPackagesIn(published, OP), []);
	assert.ok(!published.includes("IKN-42"));
});

test("key prefixes of the settings", () => {
	assert.deepEqual(keyPrefixes("IKN-, ops,ikn  PROJ--"), ["IKN-", "OPS-", "PROJ-"]);
	assert.deepEqual(keyPrefixes(""), []);
	assert.deepEqual(keyPrefixes("-, 12-, a b"), ["A-", "B-"]);
});

test("the start of a key typed with a digit asks for the work packages whose key starts so", () => {
	const prefixes = ["IKN-", "OPS-"];
	assert.deepEqual(typedKey("Bkz. IKN-23", prefixes), { key: "IKN-23", start: 5 });
	assert.deepEqual(typedKey("ikn-2", prefixes), { key: "IKN-2", start: 0 });
	assert.deepEqual(typedKey("| OPS-7", prefixes), { key: "OPS-7", start: 2 });
	assert.deepEqual(typedKey("(IKN-1", prefixes), { key: "IKN-1", start: 1 });
	// A digit is needed, and only at the start of a word: not in an address, a `#key`, a link text or another word.
	for (const before of ["IKN-", "IKN-a", "/wp/IKN-23", "#IKN-23", "[IKN-23", "XIKN-23", "IKN-23 ", "ABC-23"]) {
		assert.equal(typedKey(before, prefixes), null, before);
	}
	assert.equal(typedKey("IKN-23", []), null);
});

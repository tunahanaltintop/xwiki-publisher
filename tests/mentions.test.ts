import { test } from "node:test";
import assert from "node:assert/strict";
import { convertNote } from "../src/converter.ts";
import { convertFromXWiki } from "../src/reverse.ts";
import { anchorMentionLinks, brokenMentions, linksToMentions, mentionsForEditing, mentionLink, mentionNames, mentionReferences, mentionsToLinks, newMentionMacro, parseMentionUrl, parseUsers } from "../src/mentions.ts";

const BASE = "https://wiki.example.com/";
const PROFILE = "https://wiki.example.com/bin/view/XWiki";
const NAMES = new Map([
	["XWiki.jane\\.doe", "Jane Doe"],
	["XWiki.asmith", "Alex SMITH"],
]);
const name = (reference: string) => NAMES.get(reference);

/** A page as XWiki's editor saves it, mentions in table cells included. */
const PAGE = [
	"| Alan | Değer |",
	"| --- | --- |",
	'| Doküman Sahibi | {{mention reference="XWiki.jane\\.doe" style="FULL_NAME" anchor="XWiki-jane-doe-s0"/}} |',
	'| İlgililer | {{mention reference="XWiki.asmith" style="FULL_NAME" anchor="XWiki-asmith-i0"/}} {{mention reference="XWiki.john\\.roe" style="FULL_NAME" anchor="XWiki-john-roe-t0"/}} |',
	"",
	'Sorular için {{mention reference="XWiki.jane\\.doe" style="LOGIN" anchor="XWiki-jane-doe-k3x9qa"/}} ile görüşün.',
	"",
].join("\n");

const NOTE = [
	"| Alan | Değer |",
	"| --- | --- |",
	`| Doküman Sahibi | [@Jane Doe](${PROFILE}/jane.doe#XWiki-jane-doe-s0) |`,
	`| İlgililer | [@Alex SMITH](${PROFILE}/asmith#XWiki-asmith-i0) [@john.roe](${PROFILE}/john.roe#XWiki-john-roe-t0) |`,
	"",
	`Sorular için [@jane.doe](${PROFILE}/jane.doe?style=LOGIN#XWiki-jane-doe-k3x9qa) ile görüşün.`,
	"",
].join("\n");

test("mention macros are pulled as links to the users and published as the macros they were", () => {
	const pulled = convertFromXWiki(PAGE, () => null, { mentions: { baseUrl: BASE, names: NAMES } }).markdown;
	assert.equal(pulled, NOTE);
	assert.equal(convertNote(pulled, () => null, { mentions: { baseUrl: BASE } }).markdown, PAGE);
	// The text of the link is for reading: another name, or none from XWiki, publishes the same mention.
	const renamed = pulled.replace("@Jane Doe", "@Jane D.");
	assert.equal(convertNote(renamed, () => null, { mentions: { baseUrl: BASE } }).markdown, PAGE);
	assert.equal(convertNote(convertFromXWiki(PAGE, () => null, { mentions: { baseUrl: BASE } }).markdown, () => null, { mentions: { baseUrl: BASE } }).markdown, PAGE);
});

test("a mention is not read as a link to the note of the user's profile", () => {
	const toNote = () => ({ kind: "note" as const, linktext: "jane.doe", basename: "jane.doe" });
	const page = 'Bkz. {{mention reference="XWiki.jane\\.doe" style="FULL_NAME" anchor="a1"/}}.\n';
	assert.equal(convertFromXWiki(page, toNote, { mentions: { baseUrl: BASE, names: NAMES } }).markdown, `Bkz. [@Jane Doe](${PROFILE}/jane.doe#a1).\n`);
});

test("macros that would not come back as they are stay macros", () => {
	const unusual = [
		'{{mention reference="xwiki:XWiki.Admin" style="FULL_NAME" anchor="a"/}}', // a user of another wiki
		'{{mention reference="XWiki.jdoe" anchor="a"/}}', // no style
		'{{mention reference="XWiki.jdoe" style="FULL_NAME"/}}', // no anchor
		'{{mention reference="XWiki.jdoe" style="FULL_NAME" anchor="a" /}}', // other spacing
		'{{mention style="FULL_NAME" reference="XWiki.jdoe" anchor="a"/}}', // other order
		'{{mention reference="XWiki.jdoe" style="FULL_NAME" anchor="a" type="user"/}}', // one more parameter
		'{{mention reference="Groups.Team.WebHome" style="FULL_NAME" anchor="a"/}}', // not a user profile
	].join(" ");
	assert.equal(mentionsToLinks(unusual, BASE, name), unusual);
	assert.deepEqual(mentionReferences(unusual), []);
	// Published as they are, like any other macro.
	assert.equal(convertNote(`${unusual}\n`, () => null, { mentions: { baseUrl: BASE } }).markdown, `${unusual}\n`);
});

test("a mention written in Obsidian gets an anchor that stays the same", () => {
	const note = `[@Jane](${PROFILE}/jane.doe) ve yine [@Jane](${PROFILE}/jane.doe)[@John](<${PROFILE}/john.roe>), eskisi [@Jane Doe](${PROFILE}/jane.doe#XWiki-jane-doe-s0).`;
	const published = linksToMentions(note, BASE);
	const anchors = [...published.matchAll(/reference="([^"]+)" style="FULL_NAME" anchor="([^"]+)"/g)].map((match) => [match[1], match[2]]);
	assert.deepEqual(
		anchors.map(([reference]) => reference),
		["XWiki.jane\\.doe", "XWiki.jane\\.doe", "XWiki.john\\.roe", "XWiki.jane\\.doe"],
	);
	// Made like the anchors of XWiki's editor, each of them once on the page.
	assert.match(anchors[0][1], /^XWiki-jane-doe-[0-9a-z]{6}$/);
	assert.match(anchors[2][1], /^XWiki-john-roe-[0-9a-z]{6}$/);
	assert.equal(anchors[3][1], "XWiki-jane-doe-s0");
	assert.equal(new Set(anchors.map(([, anchor]) => anchor)).size, 4);
	assert.equal(published.replace(/\{\{mention[^}]*\}\}/g, "@"), "@ ve yine @@, eskisi @.");
	// Publishing again, with text added around, mentions nobody anew.
	assert.equal(linksToMentions(`Önce bir cümle. ${note}\n\nSonra bir paragraf.`, BASE), `Önce bir cümle. ${published}\n\nSonra bir paragraf.`);
	// Once the page is pulled, the anchors are in the note; a mention added before them gets one of its own.
	const pulled = mentionsToLinks(published, BASE, name);
	const more = linksToMentions(`[@Jane](${PROFILE}/jane.doe) ${pulled}`, BASE);
	assert.ok(more.endsWith(` ${published}`));
	const added = /^\{\{mention reference="XWiki\.jane\\\.doe" style="FULL_NAME" anchor="(XWiki-jane-doe-[0-9a-z]{6})"\/\}\}$/.exec(more.slice(0, -published.length - 1));
	assert.ok(added && !anchors.some(([, anchor]) => anchor === added[1]));
});

test("only links to user profiles of the wiki whose text starts with @ are mentions", () => {
	const others = [
		`[Jane Doe](${PROFILE}/jane.doe)`, // no @
		`![@Jane](${PROFILE}/jane.doe)`, // an image
		`\\[@Jane](${PROFILE}/jane.doe)`, // an escaped bracket
		"[@Jane](https://other.example.com/bin/view/XWiki/jane.doe)", // another site
		`[@Ekip](${PROFILE}/Ekip/WebHome)`, // a page below the space
		"[@Ana Sayfa](https://wiki.example.com/bin/view/Main/WebHome)", // another space
		`[@Jane](${PROFILE}/jane.doe "profil")`, // a link with a title
	].join(" ");
	assert.equal(linksToMentions(others, BASE), others);
	assert.equal(parseMentionUrl(BASE, `${PROFILE}/jane.doe?style=NOPE#a%20b`)?.style, "FULL_NAME");
	assert.deepEqual(parseMentionUrl(BASE, `${PROFILE}/jane.doe?style=FIRST_NAME#a%20b`), { reference: "XWiki.jane\\.doe", style: "FIRST_NAME", anchor: "a b" });
	// In code a link is text.
	const code = `\`[@Jane](${PROFILE}/jane.doe)\`\n\n\`\`\`\n[@Jane](${PROFILE}/jane.doe)\n\`\`\`\n`;
	assert.equal(convertNote(code, () => null, { mentions: { baseUrl: BASE } }).markdown, code);
	// Without the address of the wiki nothing is a mention.
	assert.equal(convertNote(`[@Jane](${PROFILE}/jane.doe)\n`, () => null).markdown, `[@Jane](${PROFILE}/jane.doe)\n`);
});

test("names of mentioned users: shown in the note, and listed by the user search", () => {
	assert.deepEqual(mentionReferences(PAGE), ["XWiki.jane\\.doe", "XWiki.asmith", "XWiki.john\\.roe"]);
	assert.deepEqual(
		[...mentionNames(NOTE, BASE)],
		[
			["XWiki.jane\\.doe", "Jane Doe"],
			["XWiki.asmith", "Alex SMITH"],
			["XWiki.john\\.roe", "john.roe"],
		],
	);
	assert.equal(mentionLink(BASE, { reference: "XWiki.a\\.b", style: "FULL_NAME" }, "A [B] | C"), `[@A \\[B\\] \\| C](${PROFILE}/a.b)`);
	assert.equal(mentionLink(BASE, { reference: "xwiki:XWiki.a", style: "FULL_NAME" }, "A"), null);
	assert.deepEqual(
		parseUsers([
			{ value: "XWiki.jane\\.doe", label: "Jane Doe", icon: { cssClass: "fa fa-user" }, url: "/bin/view/XWiki/jane.doe", hint: null },
			{ value: "XWiki.noname", label: "", url: "/bin/view/XWiki/noname" },
			{ value: "xwiki:XWiki.global", label: "Global User" },
			{ label: "no value" },
		]),
		[
			{ reference: "XWiki.jane\\.doe", name: "Jane Doe" },
			{ reference: "XWiki.noname", name: "noname" },
		],
	);
	assert.deepEqual(parseUsers({ error: "login page" }), []);
});

test("a mention written in a comment is a macro as the XWiki editor writes it", () => {
	const macro = newMentionMacro("XWiki.jane\\.doe");
	assert.match(macro, /^\{\{mention reference="XWiki\.jane\\\.doe" style="FULL_NAME" anchor="XWiki-jane-doe-[0-9a-z]{6}"\/\}\}$/);
	// Read back like any mention of the page.
	assert.deepEqual(mentionReferences(`Bakar mısın ${macro}?`), ["XWiki.jane\\.doe"]);
	assert.notEqual(newMentionMacro("XWiki.a"), newMentionMacro("XWiki.a"));
});

test("the anchors a publish gave are written into the note, so they stay when mentions are added", () => {
	const note = `| E | [@Alex Smith](${PROFILE}/asmith) |\n\nVe [@Jane](${PROFILE}/jane.doe), eskisi [@Jane Doe](${PROFILE}/jane.doe#XWiki-jane-doe-s0).\n`;
	const page = convertNote(note, () => null, { mentions: { baseUrl: BASE } }).markdown;
	const anchored = anchorMentionLinks(note, BASE, page);
	assert.match(anchored, /\[@Alex Smith\]\(https:\/\/wiki\.example\.com\/bin\/view\/XWiki\/asmith#XWiki-asmith-[0-9a-z]{6}\)/);
	assert.match(anchored, /Ve \[@Jane\]\(https:\/\/wiki\.example\.com\/bin\/view\/XWiki\/jane\.doe#XWiki-jane-doe-[0-9a-z]{6}\)/);
	// Published again, the note gives the same page; the mention links show what the page has.
	assert.equal(convertNote(anchored, () => null, { mentions: { baseUrl: BASE } }).markdown, page);
	assert.equal(anchorMentionLinks(anchored, BASE, page), anchored);
	// A mention the page does not have (not published yet) keeps no anchor.
	const more = `[@John](${PROFILE}/john.roe) ${note}`;
	assert.ok(anchorMentionLinks(more, BASE, page).startsWith(`[@John](${PROFILE}/john.roe) `));
	// Mentions in code and in the footnotes of inline comments are not published, and get nothing.
	const elsewhere = `\`[@Jane](${PROFILE}/jane.doe)\`\n\n[^xwiki-0]: 💬 **A**: [@Jane](${PROFILE}/jane.doe)\n`;
	assert.equal(anchorMentionLinks(elsewhere, BASE, page), elsewhere);
});

test("mentions with a doubled backslash come back as links to the user meant, and are published as the macro that works", () => {
	// XWiki reads `XWiki.jane\\.doe` as another user (it shows `@doe`); `XWiki.jane\.doe` is Jane Doe.
	const doubled = PAGE.replace(/\\\./g, "\\\\.");
	assert.notEqual(doubled, PAGE);
	const pulled = convertFromXWiki(doubled, () => null, { mentions: { baseUrl: BASE, names: NAMES } }).markdown;
	assert.equal(pulled, NOTE);
	assert.deepEqual(mentionReferences(doubled), ["XWiki.jane\\.doe", "XWiki.asmith", "XWiki.john\\.roe"]);
	assert.equal(convertNote(pulled, () => null, { mentions: { baseUrl: BASE } }).markdown, PAGE);
});

test("mentions broken by a doubled backslash are counted, so their page can be repaired", () => {
	assert.equal(brokenMentions(PAGE), 0);
	assert.equal(brokenMentions(PAGE.replace(/\\\./g, "\\\\.")), 3);
	assert.equal(brokenMentions('{{mention reference="XWiki.asmith" style="FULL_NAME" anchor="a"/}}'), 0);
});

test("comments are edited with their mentions shown as names, and sent back with the same macros", () => {
	const jane = '{{mention reference="XWiki.jane\\.doe" style="FULL_NAME" anchor="XWiki-jane-doe-a1"/}}';
	const doubled = '{{mention reference="XWiki.jane\\\\.doe" style="FULL_NAME" anchor="XWiki-jane-doe-a2"/}}';
	const login = '{{mention reference="XWiki.asmith" style="LOGIN" anchor="XWiki-asmith-b1"/}}';
	const other = '{{mention reference="xwiki:XWiki.Admin" style="FULL_NAME" anchor="c"/}}';
	const source = `${jane} bakar mısın? ${login} ve ${other}, ayrıca ${doubled}`;
	const { text, mentions } = mentionsForEditing(source, name);
	// The second mention of Jane has another macro: it stays as it is, so each name stands for one macro.
	assert.equal(text, `@Jane Doe bakar mısın? @asmith ve ${other}, ayrıca ${doubled}`);
	assert.deepEqual(mentions, [
		{ shown: "@Jane Doe", macro: jane },
		{ shown: "@asmith", macro: login },
	]);
	let sent = text;
	for (const mention of mentions) sent = sent.split(mention.shown).join(mention.macro);
	assert.equal(sent, source);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { convertNote, stripInlineComments } from "../src/converter.ts";
import {
	addInlineComments,
	commentAt,
	commentsAtIcon,
	commentsBelow,
	replyDepth,
	commentThreads,
	isNextVersion,
	parseAnnotationAnswer,
	parseComments,
	parseResolutions,
	parseSelections,
	selectionOnPage,
	shownResolved,
	type CommentThread,
} from "../src/inline-comments.ts";

/** Local time, like the dates written into notes. */
const WHEN = new Date(2026, 10, 20, 14, 3).getTime();
const SAID = "**Ayşe Yılmaz** · 2026-11-20 14:03: Güncel mi?";

function thread(id: number, selection: string, before = "", after = ""): CommentThread {
	return { id, selection, before, after, entries: [{ author: "Ayşe Yılmaz", date: WHEN, text: "Güncel mi?" }] };
}

/** Notes with the comments of their page: the note as pulled, the inline comments, and the note with them. */
const NOTES: [string, string, CommentThread[], string][] = [
	[
		"plain text is highlighted",
		"Q3 bütçesi 1,2M TL olarak onaylandı.\n",
		[thread(3, "bütçesi 1,2M TL")],
		`Q3 ==💬bütçesi 1,2M TL==[^xwiki-3] olarak onaylandı.\n\n[^xwiki-3]: 💬 ${SAID}\n`,
	],
	[
		"the selection XWiki stores has its own spacing and no markup",
		"Bu **çok önemli** bir nokta.\n",
		[thread(1, "çok  önemli bir")],
		`Bu **çok önemli** bir[^xwiki-1] nokta.\n\n[^xwiki-1]: 💬 “çok önemli bir” — ${SAID}\n`,
	],
	[
		"formatted text is highlighted inside its marks",
		"Bu **çok önemli** bir nokta.\n",
		[thread(1, "çok önemli")],
		`Bu **==💬çok önemli==[^xwiki-1]** bir nokta.\n\n[^xwiki-1]: 💬 ${SAID}\n`,
	],
	[
		"the reference goes after a link or code the selection ends in",
		"Bkz. [[Other|diğer sayfa]], [site](https://x.com/a) ve `npm run build`.\n",
		[thread(1, "diğer"), thread(2, "site"), thread(3, "npm run")],
		"Bkz. [[Other|diğer sayfa]][^xwiki-1], [site](https://x.com/a)[^xwiki-2] ve `npm run build`[^xwiki-3].\n\n" +
			`[^xwiki-1]: 💬 “diğer” — ${SAID}\n[^xwiki-2]: 💬 “site” — ${SAID}\n[^xwiki-3]: 💬 “npm run” — ${SAID}\n`,
	],
	[
		"equal selections are told apart by the text around them",
		"Bütçe arttı. Sonra bütçe azaldı.\n",
		[thread(1, "bütçe", "Sonra ", " azaldı")],
		`Bütçe arttı. Sonra ==💬bütçe==[^xwiki-1] azaldı.\n\n[^xwiki-1]: 💬 ${SAID}\n`,
	],
	[
		"table cells and list items",
		"| Ad | Değer |\n| --- | --- |\n| Bütçe | 1,2M TL |\n\n1. İlk madde\n2. İkinci madde\n",
		[thread(1, "1,2M TL"), thread(2, "İkinci madde")],
		"| Ad | Değer |\n| --- | --- |\n| Bütçe | ==💬1,2M TL==[^xwiki-1] |\n\n1. İlk madde\n2. ==💬İkinci madde==[^xwiki-2]\n\n" +
			`[^xwiki-1]: 💬 ${SAID}\n[^xwiki-2]: 💬 ${SAID}\n`,
	],
	[
		"overlapping selections: one highlight",
		"Bir iki üç dört beş.\n",
		[thread(1, "iki üç dört"), thread(2, "üç dört beş")],
		`Bir ==💬iki üç dört==[^xwiki-1] beş[^xwiki-2].\n\n[^xwiki-1]: 💬 ${SAID}\n[^xwiki-2]: 💬 “üç dört beş” — ${SAID}\n`,
	],
	[
		"text the note already highlights keeps its highlight",
		"Bir ==iki üç== dört.\n",
		[thread(1, "iki üç")],
		`Bir ==iki üç[^xwiki-1]== dört.\n\n[^xwiki-1]: 💬 “iki üç” — ${SAID}\n`,
	],
	[
		"a selection over several lines",
		"Birinci satır sonu\nikinci satır başı.\n",
		[thread(1, "sonu ikinci satır")],
		`Birinci satır sonu\nikinci satır[^xwiki-1] başı.\n\n[^xwiki-1]: 💬 “sonu ikinci satır” — ${SAID}\n`,
	],
	[
		"after the footnotes of the note",
		"Metin[^1] burada.\n\n[^1]: Gerçek dipnot.\n",
		[thread(4, "burada")],
		`Metin[^1] ==💬burada==[^xwiki-4].\n\n[^1]: Gerçek dipnot.\n\n[^xwiki-4]: 💬 ${SAID}\n`,
	],
	[
		"comments without a place in the text: headings, code, addresses, changed or repeated text",
		"# Kapsam\n\nBütçe arttı, bütçe azaldı. Adres https://example.com/yol burada.\n\n```js\nconst value = 1;\n```\n",
		[thread(1, "Kapsam"), thread(2, "const value"), thread(3, "artık yok"), thread(4, "tçe"), thread(5, "example.com/yol")],
		"# Kapsam\n\nBütçe arttı, bütçe azaldı. Adres https://example.com/yol burada.\n\n```js\nconst value = 1;\n```\n\n" +
			"💬[^xwiki-1][^xwiki-2][^xwiki-3][^xwiki-4][^xwiki-5]\n\n" +
			`[^xwiki-1]: 💬 “Kapsam” — ${SAID}\n[^xwiki-2]: 💬 “const value” — ${SAID}\n[^xwiki-3]: 💬 “artık yok” — ${SAID}\n` +
			`[^xwiki-4]: 💬 “tçe” — ${SAID}\n[^xwiki-5]: 💬 “example.com/yol” — ${SAID}\n`,
	],
];

for (const [name, note, threads, expected] of NOTES) {
	test(`inline comments: ${name}`, () => {
		const shown = addInlineComments(note, threads);
		assert.equal(shown, expected);
		// What a pull adds is all that is removed again.
		assert.equal(stripInlineComments(shown).trim(), note.trim());
		// Publishing the note sends the page what it sends without the comments, whatever is done with %%comments%%.
		for (const comments of ["remove", "macro"] as const) {
			assert.equal(convertNote(shown, () => null, { comments }).markdown, convertNote(note, () => null, { comments }).markdown);
		}
	});
}

test("a note without inline comments is left as it is", () => {
	const note = "Metin[^1] ve ==💬vurgu== burada.\n\n[^1]: Dipnot.\n";
	assert.equal(addInlineComments(note, []), note);
	assert.equal(stripInlineComments(note), note);
});

test("replies follow their comment, on one line", () => {
	const threads: CommentThread[] = [
		{
			...thread(7, "metin"),
			entries: [
				{ author: "Ayşe_Y", date: WHEN, text: "İlk satır\n\nikinci `kod` satırı %%" },
				{ author: "Mehmet Kaya", text: "Tamam." },
			],
		},
	];
	assert.equal(
		addInlineComments("Bir metin.\n", threads),
		"Bir ==💬metin==[^xwiki-7].\n\n[^xwiki-7]: 💬 **Ayşe\\_Y** · 2026-11-20 14:03: İlk satır<br>ikinci 'kod' satırı %\\%<br>↳ **Mehmet Kaya**: Tamam.\n",
	);
});

test("marks are removed wherever an edit of the note left them, but not from code", () => {
	const edited = [
		"Başta ==💬bir== kalan vurgu, sonda kalan başvuru[^xwiki-2] ve ==💬tam==[^xwiki-3] olan.",
		"",
		"`[^xwiki-9]` kod içinde kalır.",
		"",
		"💬[^xwiki-4]",
		"",
		"[^xwiki-2]: 💬 **A**: iki",
		"  devam satırı",
		"[^1]: Gerçek dipnot.",
		"[^xwiki-3]: 💬 **A**: üç",
		"",
	].join("\n");
	assert.equal(
		stripInlineComments(edited).trim(),
		"Başta ==💬bir== kalan vurgu, sonda kalan başvuru ve tam olan.\n\n`[^xwiki-9]` kod içinde kalır.\n\n\n[^1]: Gerçek dipnot.",
	);
});

test("reads comments and their selections from the REST API", () => {
	const comments = parseComments({
		links: [],
		comments: [
			{ id: 0, pageId: "xwiki:S.P.WebHome", author: "XWiki.ayilmaz", authorName: "Ayşe Yılmaz", date: WHEN, highlight: null, text: "Güncel mi?", replyTo: null },
			{ id: 1, author: "xwiki:XWiki.mkaya", authorName: "", date: new Date(WHEN + 60_000).toISOString(), text: "Evet.", replyTo: 0 },
			{ id: 2, author: "XWiki.ayilmaz", authorName: "Ayşe Yılmaz", date: WHEN + 120_000, text: "Sayfa yorumu", replyTo: null },
			{ id: 3, author: "XWiki.ayilmaz", authorName: "Ayşe Yılmaz", text: "Ona yanıt", replyTo: 2 },
			{ text: "no id" },
		],
	});
	assert.deepEqual(
		comments.map(({ id, author, date, replyTo }) => ({ id, author, date, replyTo })),
		[
			{ id: 0, author: "Ayşe Yılmaz", date: WHEN, replyTo: undefined },
			{ id: 1, author: "mkaya", date: WHEN + 60_000, replyTo: 0 },
			{ id: 2, author: "Ayşe Yılmaz", date: WHEN + 120_000, replyTo: undefined },
			{ id: 3, author: "Ayşe Yılmaz", date: undefined, replyTo: 2 },
		],
	);

	const property = (name: string, value: string) => ({ name, value, type: "String", attributes: [], links: [] });
	const selections = parseSelections({
		title: "P",
		content: "…",
		objects: {
			links: [],
			objectSummaries: [
				{ className: "XWiki.TagClass", number: 0, properties: [property("tags", "a|b")] },
				{
					className: "XWiki.XWikiComments",
					number: 0,
					properties: [property("comment", "Güncel mi?"), property("selection", "1,2M TL"), property("selectionLeftContext", "bütçesi "), property("selectionRightContext", " olarak"), property("state", "SAFE")],
				},
				{ className: "XWiki.XWikiComments", number: 1, properties: [property("comment", "Evet."), property("selection", ""), property("replyto", "0")] },
				{ className: "XWiki.XWikiComments", number: 2, properties: [property("comment", "Sayfa yorumu")] },
			],
		},
	});
	assert.deepEqual([...selections], [[0, { selection: "1,2M TL", before: "bütçesi ", after: " olarak" }]]);
	assert.deepEqual(parseSelections({ title: "P" }).size, 0);
	assert.deepEqual(parseComments(null), []);

	// Only the inline comment and the reply to it: comments on the page as a whole stay on XWiki.
	assert.deepEqual(commentThreads(comments, selections, "markdown/1.2"), [
		{
			id: 0,
			selection: "1,2M TL",
			before: "bütçesi ",
			after: " olarak",
			entries: [
				{ id: 0, replyTo: undefined, author: "Ayşe Yılmaz", date: WHEN, text: "Güncel mi?" },
				{ id: 1, replyTo: 0, author: "mkaya", date: WHEN + 60_000, text: "Evet." },
			],
			replies: [1],
		},
	]);
});

test("replies are kept with their comment, and mentions in comments are shown by name", () => {
	const selections = new Map([[0, { selection: "metin", before: "", after: "" }]]);
	const threads = commentThreads(
		[
			{ id: 0, author: "A", text: "Düzeltelim" },
			{ id: 1, author: "B", text: "Tamam", replyTo: 0 },
			{ id: 2, author: "A", text: "Teşekkürler", replyTo: 1 },
		],
		selections,
		"markdown/1.2",
	);
	assert.deepEqual(threads[0].replies, [1, 2]);
	// Mentions in comments are shown by the plugin's links when it knows the user.
	const named = commentThreads(
		[{ id: 0, author: "A", text: 'Bakar mısın {{mention reference="XWiki.jane\\.doe" style="FULL_NAME" anchor="XWiki-jane-doe-ab12cd"/}}?' }],
		selections,
		"markdown/1.2",
		(reference) => (reference === "XWiki.jane\\.doe" ? "[@Jane Doe](https://w/bin/view/XWiki/jane.doe)" : undefined),
	);
	assert.equal(named[0].entries[0].text, "Bakar mısın [@Jane Doe](https://w/bin/view/XWiki/jane.doe)?");
	assert.equal(
		commentThreads([{ id: 0, author: "A", text: '{{mention reference="XWiki.jane\\.doe" style="FULL_NAME" anchor="a"/}} bak' }], selections, "markdown/1.2")[0].entries[0].text,
		"@jane.doe bak",
	);
});

test("comment text: mentions, and XWiki syntax on pages written in it", () => {
	const selections = new Map([[0, { selection: "x", before: "", after: "" }]]);
	const said = (text: string, syntax: string) => commentThreads([{ id: 0, author: "A", text }], selections, syntax)[0].entries[0].text;
	assert.equal(said('{{mention reference="XWiki.mkaya" style="FULL_NAME" anchor="XWiki-mkaya-abc"/}} bakar mısın?', "markdown/1.2"), "@mkaya bakar mısın?");
	assert.equal(said("Bu **kalın** kalsın", "markdown/1.2"), "Bu **kalın** kalsın");
	assert.equal(said("Bu //italik// olsun", "xwiki/2.1").trim(), "Bu *italik* olsun");
});

test("a comment written in Obsidian is attached to the text of the page", () => {
	const note =
		'---\nxwiki-reference: "S.P.WebHome"\ntags: bütçe\n---\n# Plan\n\n' +
		"Bu **çok önemli** bir [nokta](https://x.com/a) ve bütçe arttı. Sonra ==💬bütçe==[^xwiki-3] azaldı (geçen yıl).\n\n" +
		"[^xwiki-3]: 💬 **A**: bütçe hakkında\n";
	// The page as XWiki shows it: no markup, and none of the comments.
	const page = "Plan\n\nBu çok önemli bir nokta ve bütçe arttı. Sonra bütçe azaldı (geçen yıl).\n";
	const select = (selected: string, nth = 0, source = note) => {
		let from = -1;
		for (let i = 0; i <= nth; i++) from = source.indexOf(selected, from + 1);
		return selectionOnPage(source, from, from + selected.length, page);
	};
	// Markup of the note is not part of the selection XWiki gets.
	assert.deepEqual(select("**çok önemli** bir [nokta](https://x.com/a)"), { selection: "çok önemli bir nokta", context: "çok önemli bir nokta", offset: 0 });
	assert.deepEqual(select("(geçen yıl)"), { selection: "geçen yıl", context: "geçen yıl", offset: 0 });
	// A text that is on the page twice is sent with the text around the one that was selected.
	assert.deepEqual(select("bütçe", 1), { selection: "bütçe", context: " nokta ve bütçe arttı. So", offset: 10 });
	assert.deepEqual(select("bütçe", 2), { selection: "bütçe", context: "tı. Sonra bütçe azaldı (g", offset: 10 });
	// Properties and the comments shown in the note are not text of the page.
	assert.equal(select("bütçe", 0), null);
	assert.equal(select("bütçe hakkında"), null);
	assert.equal(select("\n\n"), null);
	// Text edited in the note since the last publish is not on the page yet.
	assert.equal(select("Sonra ==💬bütçe==[^xwiki-3] düştü", 0, note.replace("azaldı", "düştü")), null);
});

test("finds the comment at the cursor", () => {
	const line = "Sonra ==💬bütçe==[^xwiki-3] azaldı ve [^xwiki-5] burada";
	assert.equal(commentAt(line, 8), 3);
	assert.equal(commentAt(line, 0), 3);
	assert.equal(commentAt(line, 40), 5);
	assert.equal(commentAt("[^xwiki-12]: 💬 **A**: yorum[^xwiki-3]", 25), 12);
	assert.equal(commentAt("Dipnotlu[^1] düz satır", 3), null);
});

test("reads the answers of the annotations API and page versions", () => {
	assert.deepEqual(parseAnnotationAnswer({ responseCode: 0, responseMessage: null, annotatedContent: { content: "<p>a</p>", annotations: [] } }), { ok: true, message: "", html: "<p>a</p>" });
	assert.deepEqual(parseAnnotationAnswer({ responseCode: 1, responseMessage: "boom", annotatedContent: null }), { ok: false, message: "boom", html: "" });
	assert.equal(parseAnnotationAnswer(null).ok, false);
	assert.equal(isNextVersion("3.4", "3.5"), true);
	assert.equal(isNextVersion("3.4", "4.1"), true);
	assert.equal(isNextVersion("3.4", "3.6"), false);
	assert.equal(isNextVersion("3.4", "3.4"), false);
	assert.equal(isNextVersion("", "1.1"), false);
});

test("finds the comments a selected icon stands for", () => {
	const note = [
		"| Sunum Adı | Versiyon |",
		"| --- | --- |",
		"| ==💬Genel Sunum==[^xwiki-0] | v1.0 |",
		"",
		"Metin ==💬bütçe==[^xwiki-3] ve yine ==💬bütçe==[^xwiki-4].",
		"",
		"💬[^xwiki-5][^xwiki-6]",
		"",
		"[^xwiki-0]: 💬 **Alex Smith** · 2026-11-23 16:48: Test yorum.",
		"[^xwiki-3]: 💬 **A**: üç",
		"[^xwiki-4]: 💬 **A**: dört",
		"[^xwiki-5]: 💬 “kayıp” — **A**: beş",
		"[^xwiki-6]: 💬 “kayıp 2” — **A**: altı",
	].join("\n");
	// In a table cell, the highlight is followed by its reference shown as "xwiki-0".
	assert.deepEqual(commentsAtIcon(note, "💬Genel Sunum", "💬Genel Sunumxwiki-0"), [0]);
	// The same text commented twice: both comments.
	assert.deepEqual(commentsAtIcon(note, "💬bütçe", "Metin 💬bütçe3 ve yine 💬bütçe4."), [3, 4]);
	// The line of comments without a place in the text, and a footnote.
	assert.deepEqual(commentsAtIcon(note, "💬xwiki-5xwiki-6", "💬xwiki-5xwiki-6"), [5, 6]);
	assert.deepEqual(commentsAtIcon(note, "", "xwiki-0 💬 Alex Smith · 2026-11-23 16:48: Test yorum."), [0]);
	// The icon of the line of comments without a place, its references hidden.
	assert.deepEqual(commentsAtIcon(note, "💬", "💬"), [5, 6]);
	// An icon that is just text.
	assert.deepEqual(commentsAtIcon(note, "💬 bir emoji", "Bir 💬 bir emoji"), []);
});

test("resolved comments, from the wiki's resolution service, are shown as resolved", () => {
	const resolutions = parseResolutions({ canResolve: true, resolved: { "0": { by: "XWiki.asmith", name: "Alex Smith", at: 1795503080325 } } });
	assert.deepEqual(resolutions, { canResolve: true, resolved: new Map([[0, { by: "XWiki.asmith", name: "Alex Smith", at: 1795503080325 }]]) });
	assert.deepEqual(parseResolutions({ canResolve: false, resolved: {} }), { canResolve: false, resolved: new Map() });
	// Anything else means that the wiki has no such service.
	assert.equal(parseResolutions(null), null);
	assert.equal(parseResolutions({ error: "page not found" }), null);
	assert.equal(parseResolutions("<html>login</html>"), null);

	const selections = new Map([
		[0, { selection: "Genel Sunum", before: "", after: "" }],
		[1, { selection: "v1.0", before: "", after: "" }],
	]);
	const comments = [
		{ id: 0, author: "Alex Smith", text: "Test yorum." },
		{ id: 1, author: "Ayşe", text: "Sürüm doğru mu?" },
	];
	const threads = commentThreads(comments, selections, "markdown/1.2", undefined, resolutions);
	assert.equal(threads[0].resolved?.name, "Alex Smith");
	assert.equal(threads[1].resolved, undefined);
	// Resolved comments are shown too, their footnote saying so.
	const shown = addInlineComments("| Genel Sunum | v1.0 |\n", threads);
	// A resolved comment has the ✅ icon, in the text and in its footnote.
	assert.ok(shown.includes("==✅Genel Sunum==[^xwiki-0]") && shown.includes("==💬v1.0==[^xwiki-1]"), shown);
	assert.match(shown, /^\[\^xwiki-0\]: ✅ Resolved by Alex Smith · \d{4}-\d{2}-\d{2} \d{2}:\d{2} — \*\*Alex Smith\*\*: Test yorum\.$/m);
	assert.deepEqual(commentsAtIcon(shown, "✅Genel Sunum", "✅Genel Sunum"), [0]);
	assert.equal(commentAt("| ==✅Genel Sunum==[^xwiki-0] | v1.0 |", 4), 0);
	// Published without any of it, whatever the user did to the marks.
	assert.equal(convertNote(shown, () => null).markdown, convertNote("| Genel Sunum | v1.0 |\n", () => null).markdown);
	assert.match(shown, /^\[\^xwiki-1\]: 💬 \*\*Ayşe\*\*: Sürüm doğru mu\?$/m);
	assert.deepEqual([...shownResolved(shown)], [0]);
	// And stripped like any other comment.
	assert.equal(stripInlineComments(shown).trim(), "| Genel Sunum | v1.0 |");
});

test("every comment of a thread can be answered or deleted, with the replies below it", () => {
	const selections = new Map([[0, { selection: "metin", before: "", after: "" }]]);
	const [thread] = commentThreads(
		[
			{ id: 0, author: "A", text: "Kök" },
			{ id: 1, author: "B", text: "Yanıt", replyTo: 0 },
			{ id: 2, author: "C", text: "Yanıta yanıt", replyTo: 1 },
			{ id: 3, author: "D", text: "İkinci yanıt", replyTo: 0 },
		],
		selections,
		"markdown/1.2",
	);
	assert.deepEqual(commentsBelow(thread, 1), [2, 1]);
	assert.deepEqual(commentsBelow(thread, 3), [3]);
	assert.deepEqual(commentsBelow(thread, 0), [3, 2, 1, 0]);
	assert.deepEqual(
		thread.entries.map((entry) => replyDepth(thread, entry)),
		[0, 1, 2, 1],
	);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { convertNote, type LinkResolver } from "../src/converter.ts";
import { convertFromXWiki, XWIKI_IMAGE, XWIKI_LINK, type ReverseResolver } from "../src/reverse.ts";
import { anchorFor, headingIds, normalizeXWikiId } from "../src/obsidian-syntax.ts";

const OTHER = "S.Other.WebHome";
const IMG = "https://w/bin/download/S/P/WebHome/img.png";

const forward: LinkResolver = (linkpath) => {
	if (linkpath === "img.png") return { kind: "attachment", vaultPath: "img.png", name: "img.png", url: IMG };
	if (linkpath === "Other" || linkpath === "Other.md") {
		return { kind: "page", url: "https://w/bin/view/S/Other/", reference: OTHER, headings: ["Giriş", "Giriş"] };
	}
	return null;
};

const backward: ReverseResolver = (target, image) => {
	if (target === `${XWIKI_LINK}${encodeURIComponent(`doc:${OTHER}`)}` || target === `${XWIKI_LINK}${encodeURIComponent(OTHER)}`) {
		return { kind: "note", linktext: "Other", basename: "Other", headings: ["Giriş", "Giriş"], blocks: ["abc123"] };
	}
	if (target === `${XWIKI_IMAGE}${encodeURIComponent("img.png")}` || (image && target === "img.png")) return { kind: "attachment", name: "img.png" };
	return null;
};

const publish = (note: string) => convertNote(note, forward, { xwikiReferences: true, hardLineBreaks: true }).markdown;
const pull = (markdown: string) => convertFromXWiki(markdown, backward, { hardLineBreaks: true }).markdown;

test("computes heading anchors as XWiki does", () => {
	assert.equal(normalizeXWikiId("Giriş"), "Giri15F");
	assert.equal(normalizeXWikiId("Başlangıç Notları"), "Ba15Flang131E7Notlar131");
	assert.equal(normalizeXWikiId("Kapsam ve Hedefler (v2)"), "KapsamveHedefler28v229");
	assert.deepEqual(headingIds(["A", "**A**", "B"]), ["HA", "HA-1", "HB"]);
	assert.equal(anchorFor(["Giriş", "Giriş"], "giriş"), "HGiri15F");
	assert.equal(anchorFor([], "^abc"), "abc");
});

/** Notes that must come back unchanged after publish then pull, with what XWiki receives. */
const ROUND_TRIPS: [string, string, string][] = [
	["heading link", "Bkz. [[Other#Giriş]].", 'Bkz. [[Other > Giriş|doc:S.Other.WebHome|anchor="HGiri15F"]].'],
	["aliased heading link", "Bkz. [[Other#Giriş|giriş bölümü]].", 'Bkz. [[giriş bölümü|doc:S.Other.WebHome|anchor="HGiri15F"]].'],
	["same-note heading link", "# Amaç\n\nYukarı bak: [[#Amaç]].", "# Amaç\n\nYukarı bak: [[Amaç||anchor=\"HAmaE7\"]]."],
	["block link and block id", "Bkz. [[Other#^abc123]].\n\nÖnemli paragraf. ^def456", 'Bkz. [[Other > ^abc123|doc:S.Other.WebHome|anchor="abc123"]].\n\nÖnemli paragraf. {{id name="def456"/}}'],
	["same-note block link", "Paragraf. ^def456\n\nBkz. [[#^def456]].", 'Paragraf. {{id name="def456"/}}\n\nBkz. [[^def456||anchor="def456"]].'],
	["note embed", "![[Other]]", '{{display reference="S.Other.WebHome"/}}'],
	["section embed", "![[Other#Giriş]]", '{{display reference="S.Other.WebHome" section="HGiri15F"/}}'],
	["image", "![[img.png]] ve ![[img.png|Kedi]]", "![[img.png]] ve ![[Kedi|img.png]]"],
	["sized image", "![[img.png|300]] ![[img.png|300x200]]", '{{content syntax="xwiki/2.1"}}[[image:img.png||width="300"]]{{/content}} {{content syntax="xwiki/2.1"}}[[image:img.png||width="300" height="200"]]{{/content}}'],
	["callout", "> [!warning] Dikkat\n> İçerik **kalın**\n> - madde", '{{warning title="Dikkat"}}\nİçerik **kalın**\n- madde\n{{/warning}}'],
	["folded callout of another type", "> [!tip]- Kapalı\n> gizli", '{{success title="Kapalı" cssClass="obsidian-callout-tip obsidian-callout-folded"}}\ngizli\n{{/success}}'],
	["callout without title", "> [!info]\n> metin", "{{info}}\nmetin\n{{/info}}"],
	["nested callout", "> [!note] Dış\n> metin\n> > [!bug] İç\n> > hata", '{{info title="Dış" cssClass="obsidian-callout-note"}}\nmetin\n{{error title="İç" cssClass="obsidian-callout-bug"}}\nhata\n{{/error}}\n{{/info}}'],
	["callout with code", "> [!note] Kod\n> ```js\n> a~b [[Other]]\n> ```", '{{info title="Kod" cssClass="obsidian-callout-note"}}\n```js\na~b [[Other]]\n```\n{{/info}}'],
	["highlight", "Bu ==önemli== bir cümle.", "Bu <mark>önemli</mark> bir cümle."],
	[
		"coloured highlights",
		"==🟢Bu not== ve ==🔴acil iş==, ==🟣mor==",
		'<mark class="obsidian-highlight-green" style="background-color: rgba(8, 185, 78, 0.3)">Bu not</mark> ve <mark class="obsidian-highlight-red" style="background-color: rgba(233, 49, 71, 0.3)">acil iş</mark>, <mark class="obsidian-highlight-purple" style="background-color: rgba(120, 82, 238, 0.3)">mor</mark>',
	],
	[
		"square-coloured highlight",
		"==🟦mavi kare==",
		'<mark class="obsidian-highlight-blue-square" style="background-color: rgba(8, 109, 221, 0.3)">mavi kare</mark>',
	],
	["highlight of an emoji that is not a colour", "==⚫siyah== ve ==🟢==", "<mark>⚫siyah</mark> ve <mark>🟢</mark>"],
	["task list", "- [ ] yapılacak\n- [x] bitti\n- [X] iptal", "- ☐ yapılacak\n- ☑ bitti\n- ☒ iptal"],
	["footnote", "Metin[^1] ve devamı[^2].\n\n[^1]: Birinci not.\n[^2]: İkinci [[Other]] notu.", "Metin{{footnote}}Birinci not.{{/footnote}} ve devamı{{footnote}}İkinci [[Other|doc:S.Other.WebHome]] notu.{{/footnote}}."],
	["single line breaks", "Satır bir\nSatır iki\n\n- madde\n  devamı", "Satır bir  \nSatır iki\n\n- madde  \n  devamı"],
	["characters Markdown 1.2 reads as syntax", "Yaklaşık ~5 gün, H~2~O ve 2^10^.\n: tanım değil\n*[KYS]: kısaltma değil", "Yaklaşık &#126;5 gün, H&#126;2&#126;O ve 2&#94;10&#94;.  \n&#58; tanım değil  \n&#42;[KYS]: kısaltma değil"],
	["table with aliased link", "| A | B |\n| --- | --- |\n| [[Other\\|takma]] |  |", "| A | B |\n| --- | --- |\n| [[takma\\|doc:S.Other.WebHome]] | &nbsp; |"],
	[
		"table with heading link and sized image",
		"| A | B |\n| --- | --- |\n| [[Other#Giriş]] | ![[img.png\\|300]] |",
		'| A | B |\n| --- | --- |\n| [[Other > Giriş\\|doc:S.Other.WebHome\\|anchor="HGiri15F"]] | {{content syntax="xwiki/2.1"}}[[image:img.png\\|\\|width="300"]]{{/content}} |',
	],
	["strikethrough and code stay", "~~eski~~ `a~b ==c==`", "~~eski~~ `a~b ==c==`"],
	[
		"unclosed macro tags",
		"Şablon {{title}} ve {{/x}} metin; {{toc/}} ve {{info}}kutu{{/info}} çalışır.",
		"Şablon &#123;{title}} ve &#123;{/x}} metin; {{toc/}} ve {{info}}kutu{{/info}} çalışır.",
	],
];

for (const [name, note, xwiki] of ROUND_TRIPS) {
	test(`round trip: ${name}`, () => {
		const published = publish(note);
		assert.equal(published, `${xwiki}\n`);
		assert.equal(pull(published), `${note}\n`);
	});
}

test("comments are removed by default and can be kept as comment macros", () => {
	const note = "Görünür %%gizli not%% metin.\n\n%%\nçok satırlı\n%%";
	assert.equal(convertNote(note, forward).markdown, "Görünür  metin.\n");
	const kept = convertNote(note, forward, { comments: "macro" }).markdown;
	assert.equal(kept, "Görünür {{comment}}gizli not{{/comment}} metin.\n\n{{comment}}\nçok satırlı\n{{/comment}}\n");
	assert.equal(convertFromXWiki(kept, backward, { comments: "macro" }).markdown, `${note}\n`);
	// Without the option, comment macros written on XWiki stay macros, so publishing does not drop them.
	assert.equal(convertFromXWiki("a {{comment}}b{{/comment}}", backward).markdown, "a {{comment}}b{{/comment}}\n");
});

test("Markdown links to headings keep their target", () => {
	const published = publish("[detay](Other.md#Giriş)");
	assert.equal(published, '[[detay|doc:S.Other.WebHome|anchor="HGiri15F"]]\n');
	assert.equal(pull(published), "[[Other#Giriş|detay]]\n");
});

test("inline footnotes become footnote macros", () => {
	assert.equal(publish("Metin^[kısa [[Other]] not]."), "Metin{{footnote}}kısa [[Other|doc:S.Other.WebHome]] not{{/footnote}}.\n");
});

test("message boxes written on XWiki become callouts, other boxes stay macros", () => {
	assert.equal(pull("{{info}}\nNot\n{{/info}}"), "> [!info]\n> Not\n");
	assert.equal(pull('{{warning title="Başlık" cssClass="custom"}}\nx\n{{/warning}}'), '{{warning title="Başlık" cssClass="custom"}}\nx\n{{/warning}}\n');
	assert.equal(pull('{{info width="50%"}}\nx\n{{/info}}'), '{{info width="50%"}}\nx\n{{/info}}\n');
	assert.equal(pull("```\n{{info}}\nx\n{{/info}}\n```"), "```\n{{info}}\nx\n{{/info}}\n```\n");
});

test("line breaks written by the XWiki editor are removed when they are plain line breaks in Obsidian", () => {
	assert.equal(pull("a  \nb\\\nc"), "a\nb\nc\n");
	assert.equal(convertFromXWiki("a  \nb", backward).markdown, "a  \nb\n");
});

test("embeds of pages whose reference has escapes are published as links", () => {
	const dotted: LinkResolver = () => ({ kind: "page", url: "https://w/bin/view/S/A.1/", reference: "S.A\\.1.WebHome" });
	assert.equal(convertNote("![[A.1]]", dotted, { xwikiReferences: true }).markdown, "[[A.1|doc:S.A\\.1.WebHome]]\n");
});

test("links fall back to URLs when the reference cannot be written as a wiki link", () => {
	const odd: LinkResolver = () => ({ kind: "page", url: "https://w/bin/view/S/A%5Bb%5D/", reference: "S.A[b].WebHome" });
	assert.equal(convertNote("[[Note]]", odd, { xwikiReferences: true }).markdown, "[Note](https://w/bin/view/S/A%5Bb%5D/)\n");
});

test("a macro closed after a code block is not escaped, tags inside code are left alone", () => {
	const note = "{{info}}\nÖnce\n\n```\nkod {{x}}\n```\n\nSonra\n{{/info}}";
	assert.equal(publish(note), `${note}\n`);
});

test("escapes written as backslashes by earlier builds or the XWiki editor are read back too", () => {
	assert.equal(pull("a \\~b\\~ 2\\^3 \\{{title}}\n\\: x"), "a ~b~ 2^3 {{title}}\n: x\n");
});

test("links to formatted headings come back without the formatting", () => {
	const bold: LinkResolver = () => ({ kind: "page", url: "https://w/bin/view/S/Other/", reference: OTHER, headings: ["**1.1 Amaç**"] });
	const back: ReverseResolver = (target) =>
		target.startsWith(XWIKI_LINK) ? { kind: "note", linktext: "Other", basename: "Other", headings: ["**1.1 Amaç**"], blocks: [] } : null;
	for (const note of ["[[Other#1.1 Amaç]]", "[[Other#1.1 Amaç|kapsam]]", "![[Other#1.1 Amaç]]"]) {
		const published = convertNote(note, bold, { xwikiReferences: true }).markdown;
		assert.match(published, /H1\.1AmaE7/);
		assert.equal(convertFromXWiki(published, back).markdown, `${note}\n`);
	}
});

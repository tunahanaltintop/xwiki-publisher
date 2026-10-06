import { test } from "node:test";
import assert from "node:assert/strict";
import { xwiki21ToMarkdown } from "../src/xwiki21.ts";

test("keeps macros exactly as written", () => {
	const source = [
		"= Proje durumu =",
		"",
		'{{openproject instance="main" query="status=open" columns="id,subject"/}}',
		"",
		'Satır içi {{openproject workPackage="1234"/}} makro.',
		"",
		'{{openproject project="demo"}}',
		"içerik",
		"{{/openproject}}",
	].join("\n");
	assert.equal(
		xwiki21ToMarkdown(source),
		[
			"# Proje durumu",
			"",
			'{{openproject instance="main" query="status=open" columns="id,subject"/}}',
			"",
			'Satır içi {{openproject workPackage="1234"/}} makro.',
			"",
			'{{openproject project="demo"}}',
			"içerik",
			"{{/openproject}}",
			"",
		].join("\n"),
	);
});

test("keeps nested and parameterised macros, converts wiki content of box macros", () => {
	const source = '{{toc/}}\n\n{{info title="Not"}}\n//önemli// bilgi\n{{/info}}\n\n{{velocity}}\n#set($x = "}}")\n$x\n{{/velocity}}';
	assert.equal(xwiki21ToMarkdown(source), '{{toc/}}\n\n{{info title="Not"}}\n*önemli* bilgi\n{{/info}}\n\n{{velocity}}\n#set($x = "}}")\n$x\n{{/velocity}}\n');
});

test("converts code macros and verbatim to fenced code", () => {
	assert.equal(xwiki21ToMarkdown('{{code language="java"}}\nint a = 1;\n{{/code}}'), "```java\nint a = 1;\n```\n");
	assert.equal(xwiki21ToMarkdown("{{{\n**not bold**\n}}}"), "```\n**not bold**\n```\n");
	assert.equal(xwiki21ToMarkdown("Use {{{**x**}}} and ##mono##."), "Use `**x**` and `mono`.\n");
});

test("converts headings, formatting, lists and quotes", () => {
	const source = [
		"== Başlık ==",
		"**kalın** //italik// __altı çizili__ --üstü çizili-- ^^üst^^ ,,alt,,",
		"https://example.com//path stays",
		"",
		"* bir",
		"** iki",
		"1. ilk",
		"11. alt",
		"",
		"> alıntı",
		">> iç",
		"",
		"----",
	].join("\n");
	assert.equal(
		xwiki21ToMarkdown(source),
		[
			"## Başlık",
			"",
			"**kalın** *italik* altı çizili ~~üstü çizili~~ ^üst^ ~alt~  ",
			"https://example.com//path stays",
			"",
			"- bir",
			"   - iki",
			"1. ilk",
			"   1. alt",
			"",
			"> alıntı",
			"> > iç",
			"",
			"---",
			"",
		].join("\n"),
	);
});

test("converts links and images to Markdown 1.2 wiki syntax", () => {
	const source =
		"[[Ana sayfa>>Main.WebHome]] [[Space.Page]] [[site>>https://example.com]] [[https://x.org]] " +
		'[[dosya>>attach:rapor.pdf]] [[image:logo.png]] [[image:Space.Page@diagram.png||alt="Diyagram" width="300"]] [[image:https://e.com/a.png]]';
	assert.equal(
		xwiki21ToMarkdown(source),
		"[[Ana sayfa|Main.WebHome]] [[Space.Page|Space.Page]] [site](https://example.com) <https://x.org> " +
			"[[dosya|attach:rapor.pdf]] ![[logo.png|logo.png]] ![[Diyagram|Space.Page@diagram.png]] ![a.png](https://e.com/a.png)\n",
	);
});

test("converts tables, with and without header rows", () => {
	assert.equal(
		xwiki21ToMarkdown("|=Ad|=Durum\n|[[A>>X.Y]]|**açık**\n|b|c|"),
		"| Ad | Durum |\n| --- | --- |\n| [[A\\|X.Y]] | **açık** |\n| b | c |\n",
	);
	assert.equal(xwiki21ToMarkdown("|a|b\n|c|d"), "|  |  |\n| --- | --- |\n| a | b |\n| c | d |\n");
});

test("drops parameters and groups, keeps paragraph line breaks", () => {
	assert.equal(xwiki21ToMarkdown('(% class="box" %)\n(((\nbir\niki\\\\üç\n)))'), "bir  \niki  \nüç\n");
	// "~" escapes the next character only.
	assert.equal(xwiki21ToMarkdown("a ~[~[not a link]]"), "a \\[\\[not a link]]\n");
});

test("handles image links and macros inside table cells", () => {
	// Obsidian has no linked embeds: an image used as a link keeps the image.
	assert.equal(xwiki21ToMarkdown('[[[[image:logo.png||alt="Logo"]]>>Main.WebHome]]'), "![[Logo|logo.png]]\n");
	assert.equal(xwiki21ToMarkdown("|a|{{info}}x|y{{/info}}|"), "|  |  |\n| --- | --- |\n| a | {{info}}x\\|y{{/info}} |\n");
});

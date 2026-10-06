import { test } from "node:test";
import assert from "node:assert/strict";
import { convertNote, type LinkResolver } from "../src/converter.ts";

const resolve: LinkResolver = (linkpath) => {
	if (linkpath === "img.png" || linkpath === "assets/img.png") {
		return { kind: "attachment", vaultPath: "assets/img.png", name: "img.png", url: "https://w/bin/download/S/P/WebHome/img.png" };
	}
	if (linkpath === "doc.pdf") {
		return { kind: "attachment", vaultPath: "doc.pdf", name: "doc.pdf", url: "https://w/bin/download/S/P/WebHome/doc.pdf" };
	}
	if (linkpath === "Other" || linkpath === "Other.md") return { kind: "page", url: "https://w/bin/view/S/Other" };
	return null;
};

test("strips frontmatter and comments", () => {
	const { markdown } = convertNote("---\ntags: [a]\n---\n# Title\nkeep %%secret%% this\n", resolve);
	assert.equal(markdown, "# Title\nkeep  this\n");
});

test("converts wiki embeds of images and collects attachments", () => {
	const { markdown, attachments } = convertNote("![[img.png|300]] and ![[img.png|A cat]]", resolve);
	assert.equal(markdown, "![img.png](https://w/bin/download/S/P/WebHome/img.png) and ![A cat](https://w/bin/download/S/P/WebHome/img.png)\n");
	assert.deepEqual([...attachments], [["img.png", "assets/img.png"]]);
});

test("converts wiki links with alias and heading", () => {
	const { markdown } = convertNote("See [[Other]], [[Other|that]], [[Other#Intro]] and [[Missing]].", resolve);
	assert.equal(
		markdown,
		"See [Other](https://w/bin/view/S/Other), [that](https://w/bin/view/S/Other), [Other > Intro](https://w/bin/view/S/Other) and Missing.\n",
	);
});

test("rewrites local markdown links and images, keeps external ones", () => {
	const { markdown, attachments } = convertNote(
		"![x](assets/img.png) [file](doc.pdf) [n](Other.md) [web](https://example.com) ![r](https://e.com/a.png)",
		resolve,
	);
	assert.equal(
		markdown,
		"![x](https://w/bin/download/S/P/WebHome/img.png) [file](https://w/bin/download/S/P/WebHome/doc.pdf) [n](https://w/bin/view/S/Other) [web](https://example.com) ![r](https://e.com/a.png)\n",
	);
	assert.equal(attachments.size, 2);
});

test("leaves code untouched", () => {
	const input = "```md\n[[Other]] %%x%%\n```\nInline `[[Other]]` here [[Other]]";
	const { markdown } = convertNote(input, resolve);
	assert.equal(markdown, "```md\n[[Other]] %%x%%\n```\nInline `[[Other]]` here [Other](https://w/bin/view/S/Other)\n");
});

test("resolves aliased wiki links inside tables", () => {
	const { markdown } = convertNote("| a | [[Other\\|that]] |", resolve);
	assert.equal(markdown, "| a | [that](https://w/bin/view/S/Other) |\n");
});

test("fills empty table cells so XWiki keeps the columns", () => {
	const { markdown } = convertNote("| A | B | C |\n| --- | :-: | --- |\n| x |  |  |\n| y |\n\n|not | a table|\ntext", resolve);
	assert.equal(
		markdown,
		"| A | B | C |\n| --- | :-: | --- |\n| x | &nbsp; | &nbsp; |\n| y | &nbsp; | &nbsp; |\n\n|not | a table|\ntext\n",
	);
});

test("leaves indented code blocks and HTML comments untouched", () => {
	const { markdown } = convertNote("Text\n\n    [[Other]] in code\n\n<!-- [[Other]] --> [[Other]]\n\n- list\n    - [[Other]]", resolve);
	assert.equal(
		markdown,
		"Text\n\n    [[Other]] in code\n\n<!-- [[Other]] --> [Other](https://w/bin/view/S/Other)\n\n- list\n    - [Other](https://w/bin/view/S/Other)\n",
	);
});

test("indented lines inside lists are list content, not code", () => {
	const { markdown } = convertNote("- item\n\n    continuation [[Other]]\n\n1. a\n\n\tmore [[Other]]", resolve);
	assert.equal(
		markdown,
		"- item\n\n    continuation [Other](https://w/bin/view/S/Other)\n\n1. a\n\n\tmore [Other](https://w/bin/view/S/Other)\n",
	);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { convertFromXWiki, extractMarkdown, type ReverseResolver } from "../src/reverse.ts";

const resolve: ReverseResolver = (target, image) => {
	if (image && !target.includes("/")) return { kind: "attachment", name: target };
	if (target === "https://w/bin/download/S/P/WebHome/doc.pdf") return { kind: "attachment", name: "doc.pdf" };
	if (target === "https://w/bin/view/S/Other") return { kind: "note", linktext: "Other", basename: "Other" };
	return null;
};

test("only Markdown syntax pages are supported", () => {
	assert.equal(extractMarkdown("# A", "markdown/1.2"), "# A");
	assert.equal(extractMarkdown("# A", "markdown/1.1"), "# A");
	assert.equal(extractMarkdown("{{markdown}}\nx\n{{/markdown}}", "xwiki/2.1"), null);
	assert.equal(extractMarkdown("plain", "xwiki/2.1"), null);
});

test("turns images, attachments and page links back into wiki links", () => {
	const { markdown, attachments } = convertFromXWiki(
		"![test.png](test.png) ![A cat](cat.png) [doc.pdf](https://w/bin/download/S/P/WebHome/doc.pdf) " +
			"[Other](https://w/bin/view/S/Other) [that](https://w/bin/view/S/Other) [web](https://example.com) ![r](https://e.com/a.png)",
		resolve,
	);
	assert.equal(
		markdown,
		"![[test.png]] ![[cat.png|A cat]] [[doc.pdf]] [[Other]] [[Other|that]] [web](https://example.com) ![r](https://e.com/a.png)\n",
	);
	assert.deepEqual([...attachments], ["test.png", "cat.png", "doc.pdf"]);
});

test("leaves code untouched", () => {
	const { markdown } = convertFromXWiki("```\n![x](x.png)\n```\n`![y](y.png)`", resolve);
	assert.equal(markdown, "```\n![x](x.png)\n```\n`![y](y.png)`\n");
});

test("images published as download URLs come back as embeds", () => {
	const resolveDownload: ReverseResolver = (target) =>
		target === "https://w/bin/download/S/P/WebHome/img.png" ? { kind: "attachment", name: "img.png" } : null;
	const { markdown, attachments } = convertFromXWiki("![img.png](https://w/bin/download/S/P/WebHome/img.png)", resolveDownload);
	assert.equal(markdown, "![[img.png]]\n");
	assert.deepEqual([...attachments], ["img.png"]);
});

test("attachments link to the downloaded file when its path is known", () => {
	const resolveSaved: ReverseResolver = (target) =>
		target === "https://w/bin/download/S/P/WebHome/img.png" ? { kind: "attachment", name: "img.png", linktext: "assets/img 1.png" } : null;
	const { markdown } = convertFromXWiki("![img.png](https://w/bin/download/S/P/WebHome/img.png)", resolveSaved);
	assert.equal(markdown, "![[assets/img 1.png]]\n");
});

import { XWIKI_IMAGE, XWIKI_LINK } from "../src/reverse.ts";

test("resolves Markdown 1.2 wiki-style links and images", () => {
	const seen: string[] = [];
	const resolveRefs: ReverseResolver = (target, image) => {
		seen.push(`${image ? "img" : "link"} ${target}`);
		if (target === `${XWIKI_LINK}${encodeURIComponent("Docs.Guide")}`) return { kind: "note", linktext: "Guide", basename: "Guide" };
		if (target === `${XWIKI_LINK}${encodeURIComponent("Other.Page")}`) return { kind: "url", url: "https://w/bin/view/Other/Page" };
		if (target === `${XWIKI_IMAGE}${encodeURIComponent("logo.png")}`) return { kind: "attachment", name: "logo.png" };
		return null;
	};
	const { markdown, attachments } = convertFromXWiki("[[Rehber|Docs.Guide]] [[Other.Page]] ![[Logo|logo.png]] {{toc/}}", resolveRefs);
	assert.equal(markdown, "[[Guide|Rehber]] [Other.Page](https://w/bin/view/Other/Page) ![[logo.png|Logo]] {{toc/}}\n");
	assert.deepEqual([...attachments], ["logo.png"]);
	assert.equal(seen.length, 3);
});

test("escapes the alias separator of wiki links inside tables", () => {
	const resolveRefs: ReverseResolver = (target) =>
		target === `${XWIKI_LINK}${encodeURIComponent("Docs.Guide")}` ? { kind: "note", linktext: "Guide", basename: "Guide" } : null;
	const { markdown } = convertFromXWiki("| a | [[Rehber\\|Docs.Guide]] |", resolveRefs);
	assert.equal(markdown, "| a | [[Guide\\|Rehber]] |\n");
});

test("empties table cells that were filled on publish", () => {
	const { markdown } = convertFromXWiki("| A | B | C |\n| --- | --- | --- |\n| x | &nbsp; | &nbsp; |\nText &nbsp; stays", () => null);
	assert.equal(markdown, "| A | B | C |\n| --- | --- | --- |\n| x |  |  |\nText &nbsp; stays\n");
});

test("unwraps linked images and keeps regular links with bracketed labels", () => {
	const resolveDownload: ReverseResolver = (target) =>
		target === "https://w/bin/download/S/P/WebHome/a.png" ? { kind: "attachment", name: "a.png", linktext: "assets/a.png" } : null;
	const { markdown } = convertFromXWiki(
		"[![a.png](https://w/bin/download/S/P/WebHome/a.png)](https://w/bin/download/S/P/WebHome/a.png) See [[1]](https://example.com)",
		resolveDownload,
	);
	assert.equal(markdown, "![[assets/a.png]] See [[1]](https://example.com)\n");
});

test("keeps images that link somewhere else", () => {
	const { markdown } = convertFromXWiki("[![badge](https://w/b.png)](https://ci.example.com/build)", () => null);
	assert.equal(markdown, "[![badge](https://w/b.png)](https://ci.example.com/build)\n");
});

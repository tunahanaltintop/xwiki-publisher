import { test } from "node:test";
import assert from "node:assert/strict";
import { collectSyntaxIds } from "../src/syntaxes.ts";

test("collects syntax ids from any JSON shape", () => {
	const json = { links: [{ href: "https://w/rest/syntaxes" }], syntaxes: ["xwiki/2.1", "markdown/1.1", "plain/1.0", "html/5.0"] };
	assert.deepEqual(collectSyntaxIds(json), ["xwiki/2.1", "markdown/1.1", "plain/1.0", "html/5.0"]);
	assert.deepEqual(collectSyntaxIds({ syntax: [{ id: "markdown/1.2" }] }), ["markdown/1.2"]);
});

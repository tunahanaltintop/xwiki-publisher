import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeToken } from "../src/token.ts";

test("normalizeToken strips Bearer prefix, quotes and whitespace", () => {
	assert.equal(normalizeToken("  Bearer abc^X/def \n"), "abc^X/def");
	assert.equal(normalizeToken("bearer   abc"), "abc");
	assert.equal(normalizeToken('"abc"'), "abc");
	assert.equal(normalizeToken("abc"), "abc");
});

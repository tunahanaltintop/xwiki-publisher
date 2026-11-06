import { test } from "node:test";
import assert from "node:assert/strict";
import {
	describeLinks,
	failedReport,
	OpenProjectError,
	type PageLink,
	RELATION_LINK_TYPE,
	relationLinkIn,
	syncPageLinks,
	type WikiLinkApi,
	workPackagesIn,
} from "../src/openproject.ts";

const base = "https://op.example.com";
const link: PageLink = { provider: "instance-1", identifier: "page-1" };

test("finds every work package link form", () => {
	const text = [
		`[Görev](${base}/work_packages/1)`,
		`${base}/wp/2`,
		`<${base}/projects/demo/work_packages/3/activity>`,
		`[detay](${base}/projects/demo/work_packages/details/4/overview?query_id=7)`,
		`${base}/work_packages/details/5/overview#activity-9`,
		`${base}/work_packages/proj-6`,
	].join("\n");
	assert.deepEqual(workPackagesIn(text, base), ["1", "2", "3", "4", "5", "PROJ-6"]);
});

test("lists a work package once", () => {
	assert.deepEqual(workPackagesIn(`${base}/work_packages/1 ${base}/wp/1 ${base}/projects/x/work_packages/1/activity`, base), ["1"]);
});

test("accepts either scheme, a trailing slash and a subfolder in the setting", () => {
	assert.deepEqual(workPackagesIn(`http://op.example.com/work_packages/1`, `${base}/`), ["1"]);
	assert.deepEqual(workPackagesIn(`${base}/sub/wp/2 ${base}/wp/3`, `${base}/sub`), ["2"]);
});

test("ignores links that are not work packages of this OpenProject", () => {
	const text = [
		"https://other.example.com/work_packages/1",
		"https://op.example.com.evil.test/work_packages/2",
		`${base}/api/v3/work_packages/3`,
		`${base}/work_packages/new`,
		`${base}/work_packages/4x`,
		`${base}/projects/demo/work_packages`,
	].join("\n");
	assert.deepEqual(workPackagesIn(text, base), []);
});

test("ignores links in code", () => {
	const text = ["```", `${base}/work_packages/1`, "```", `\`${base}/work_packages/2\``, `${base}/work_packages/3`].join("\n");
	assert.deepEqual(workPackagesIn(text, base), ["3"]);
});

test("finds nothing without a URL", () => {
	assert.deepEqual(workPackagesIn(`${base}/work_packages/1`, ""), []);
});

test("finds links in pages not written in Markdown", () => {
	assert.deepEqual(workPackagesIn(`[[Görev>>${base}/work_packages/1]]`, base), ["1"]);
});

/** Records the calls made to OpenProject over the links in `linked` (work package → link id). */
function fakeApi(linked: Record<string, number>, overrides: Partial<WikiLinkApi> = {}): { api: WikiLinkApi; calls: string[] } {
	const calls: string[] = [];
	const api: WikiLinkApi = {
		findLink: (workPackage) => {
			calls.push(`find ${workPackage}`);
			return Promise.resolve(linked[workPackage] ?? null);
		},
		createLink: (workPackage) => {
			calls.push(`create ${workPackage}`);
			return Promise.resolve();
		},
		deleteLink: (id) => {
			calls.push(`delete ${id}`);
			return Promise.resolve();
		},
		...overrides,
	};
	return { api, calls };
}

test("links new work packages and never duplicates a link", async () => {
	const { api, calls } = fakeApi({ "2": 20 });
	const report = await syncPageLinks(api, link, [], ["1", "2"]);
	assert.deepEqual(report.linked, ["1"]);
	assert.deepEqual(report.existing, ["2"]);
	assert.deepEqual(calls, ["find 1", "create 1", "find 2"]);
});

test("removes the link of a work package that left the page", async () => {
	const { api, calls } = fakeApi({ "1": 10, "2": 20 });
	const report = await syncPageLinks(api, link, ["1", "2"], ["2"]);
	assert.deepEqual(report.removed, ["1"]);
	assert.deepEqual(report.existing, ["2"]);
	assert.ok(calls.includes("delete 10"));
	assert.ok(!calls.includes("delete 20"));
});

test("removing a link that does not exist deletes nothing", async () => {
	const { api, calls } = fakeApi({});
	const report = await syncPageLinks(api, link, ["1"], []);
	assert.deepEqual(report.notLinked, ["1"]);
	assert.deepEqual(calls, ["find 1"]);
});

test("removes before linking, so a work package with a new link form stays linked", async () => {
	const { api, calls } = fakeApi({ "1": 10 });
	await syncPageLinks(api, link, ["1"], ["PROJ-1"]);
	assert.deepEqual(calls, ["find 1", "delete 10", "find PROJ-1", "create PROJ-1"]);
});

test("does not touch work packages the page never linked", async () => {
	const { api, calls } = fakeApi({ "9": 90 });
	await syncPageLinks(api, link, ["1"], ["1"]);
	assert.ok(!calls.some((call) => call.includes("9")));
});

test("a failed work package does not stop the others", async () => {
	const { api } = fakeApi(
		{},
		{
			findLink: (workPackage) => (workPackage === "1" ? Promise.reject(new OpenProjectError("Not found (404).", 404)) : Promise.resolve(null)),
		},
	);
	const report = await syncPageLinks(api, link, [], ["1", "2"]);
	assert.deepEqual(report.failed, [{ workPackage: "1", action: "link", message: "Not found (404)." }]);
	assert.deepEqual(report.linked, ["2"]);
});

test("still attempts the link when the existing links cannot be read", async () => {
	const { api, calls } = fakeApi({}, { findLink: () => Promise.reject(new OpenProjectError("Server error (500)", 500)) });
	const report = await syncPageLinks(api, link, [], ["1"]);
	assert.deepEqual(report.linked, ["1"]);
	assert.deepEqual(calls, ["create 1"]);
});

test("explains a refused link when the existing links could not be read", async () => {
	const { api } = fakeApi(
		{},
		{
			findLink: () => Promise.reject(new OpenProjectError("Server error (500)", 500)),
			createLink: () => Promise.reject(new OpenProjectError("Identifier has already been taken (422)", 422)),
		},
	);
	const report = await syncPageLinks(api, link, [], ["1"]);
	assert.equal(report.failed.length, 1);
	assert.match(report.failed[0].message, /already been taken.*could not list the links/);
});

test("a removal fails when the links cannot be read", async () => {
	const { api, calls } = fakeApi({}, { findLink: () => Promise.reject(new OpenProjectError("Server error (500)", 500)) });
	const report = await syncPageLinks(api, link, ["1"], []);
	assert.equal(report.failed[0].action, "remove");
	assert.match(report.failed[0].message, /could not list the links/);
	assert.deepEqual(calls, []);
});

const element = { id: 7, identifier: "page-1", wikiPageLinkType: RELATION_LINK_TYPE, _links: { provider: { href: "/api/v3/wiki_providers/instance-1" } } };

test("reads the id of the matching link", () => {
	assert.equal(relationLinkIn({ _embedded: { elements: [element] } }, link), 7);
});

test("does not mistake other links for the page's link", () => {
	const others = [
		{ ...element, identifier: "page-2" },
		{ ...element, wikiPageLinkType: "urn:openproject-org:api:v3:wikiPageLinks:Inline" },
		{ ...element, _links: { provider: { href: "/api/v3/wiki_providers/instance-2" } } },
	];
	assert.equal(relationLinkIn({ _embedded: { elements: others } }, link), null);
	assert.equal(relationLinkIn({}, link), null);
	assert.equal(relationLinkIn(null, link), null);
});

test("describes what happened to the links of a note", () => {
	const message = describeLinks("Plan", {
		linked: ["1", "PROJ-2"],
		existing: ["3"],
		removed: ["4"],
		notLinked: ["5"],
		failed: [
			{ workPackage: "6", action: "link", message: "Denied." },
			{ workPackage: "7", action: "link", message: "Denied." },
			{ workPackage: "8", action: "remove", message: "Gone." },
		],
	});
	assert.equal(
		message,
		'OpenProject links of "Plan": linked #1, PROJ-2; already linked #3; removed #4; was not linked #5; could not link #6, #7: Denied.; could not remove #8: Gone.',
	);
});

test("a page that cannot be identified fails every link", () => {
	assert.deepEqual(failedReport(["1", "2"], ["2", "3"], "No API.").failed, [
		{ workPackage: "1", action: "remove", message: "No API." },
		{ workPackage: "2", action: "link", message: "No API." },
		{ workPackage: "3", action: "link", message: "No API." },
	]);
});

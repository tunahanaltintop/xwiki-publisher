import { requestUrl, RequestUrlResponse } from "obsidian";
import { PageLocation, parseReference, parseXWikiUrl, serializeSpaceReference, splitSpaceReference, XWikiUrl } from "./location";
import { collectSyntaxIds } from "./syntaxes";
import { normalizeToken } from "./token";

export type AuthScheme = "bearer" | "basic" | "header";

export interface XWikiConnection {
	baseUrl: string;
	wiki: string;
	token: string;
	authScheme: AuthScheme;
	/** Username for the `basic` scheme. */
	username: string;
	/** Header name for the `header` scheme. */
	headerName: string;
}

export interface PageContent {
	title: string;
	content: string;
	syntax: string;
}

export interface RemotePage {
	title: string;
	syntax: string;
	content: string;
	/** Page version such as `3.1`; changes on every save, including attachment uploads. */
	version: string;
}

export interface RemoteAttachment {
	name: string;
	/** Attachment version; empty when the server does not report it. */
	version: string;
}

/** Attachments can be large; give their transfers more time than regular REST calls. */
const ATTACHMENT_TIMEOUT_MS = 5 * 60_000;

export class XWikiError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "XWikiError";
	}
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;")
		// Characters that are illegal in XML 1.0 would make XWiki reject the whole page.
		// eslint-disable-next-line no-control-regex -- removing control characters is the point of this regex
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function header(headers: Record<string, string>, name: string): string | undefined {
	const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
	return key ? headers[key] : undefined;
}

export interface ConnectionInfo {
	/** User XWiki authenticated the request as, when the server reports it. */
	user?: string;
}

function utf8ToBase64(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = "";
	bytes.forEach((b) => (binary += String.fromCharCode(b)));
	return btoa(binary);
}

export class XWikiClient {
	constructor(private readonly connection: XWikiConnection) {}

	private get base(): string {
		return this.connection.baseUrl.replace(/\/+$/, "");
	}

	private authHeaders(): Record<string, string> {
		const { authScheme, username, headerName } = this.connection;
		const token = normalizeToken(this.connection.token);
		switch (authScheme) {
			case "basic":
				return { Authorization: `Basic ${utf8ToBase64(`${username}:${token}`)}` };
			case "header":
				return { [headerName || "Authorization"]: token };
			case "bearer":
			default:
				return { Authorization: `Bearer ${token}` };
		}
	}

	private pageRestUrl(location: PageLocation): string {
		const spaces = location.spaces.map((s) => `spaces/${encodeURIComponent(s)}`).join("/");
		return `${this.base}/rest/wikis/${encodeURIComponent(this.connection.wiki)}/${spaces}/pages/${encodeURIComponent(location.page)}`;
	}

	/**
	 * URL of the page in the XWiki UI. Nested pages end with a slash (`/bin/view/A/B/`), which XWiki always resolves
	 * to `A.B.WebHome`; without it, `/bin/view/A/B` would mean the terminal page `A.B` when one exists.
	 */
	viewUrl(location: PageLocation): string {
		const spaces = location.spaces.map(encodeURIComponent).join("/");
		return location.page === "WebHome"
			? `${this.base}/bin/view/${spaces}/`
			: `${this.base}/bin/view/${spaces}/${encodeURIComponent(location.page)}`;
	}

	/** Public download URL of an attachment of the page. */
	attachmentUrl(location: PageLocation, name: string): string {
		const parts = [...location.spaces, location.page, name].map(encodeURIComponent);
		return `${this.base}/bin/download/${parts.join("/")}`;
	}

	/** Recognises view and download URLs of this XWiki instance. */
	parseUrl(url: string): XWikiUrl | null {
		return parseXWikiUrl(url, this.base);
	}

	/** requestUrl has no timeout of its own; give up after a while instead of waiting forever. */
	private withTimeout<T>(request: Promise<T>, url: string, ms: number): Promise<T> {
		let timer = 0;
		const timeout = new Promise<never>((_, reject) => {
			timer = window.setTimeout(() => reject(new XWikiError(`XWiki did not answer within ${ms / 1000} s (${url.split("?")[0]}).`)), ms);
		});
		return Promise.race([request, timeout]).finally(() => window.clearTimeout(timer));
	}

	private async send(
		params: Parameters<typeof requestUrl>[0] & object,
		options: { allowNotFound?: boolean; timeoutMs?: number } = {},
	): Promise<RequestUrlResponse> {
		const { allowNotFound = false, timeoutMs = 60_000 } = options;
		const response = await this.withTimeout(requestUrl({ ...params, throw: false }), params.url, timeoutMs);
		if (allowNotFound && response.status === 404) return response;
		if (response.status >= 400) {
			// Never log request headers: they contain the token.
			console.error("XWiki Publisher: request failed", {
				method: params.method,
				url: params.url,
				status: response.status,
				wwwAuthenticate: header(response.headers, "www-authenticate"),
				xwikiUser: header(response.headers, "xwiki-user"),
				body: response.text?.slice(0, 500),
			});
			throw new XWikiError(this.describeError(response));
		}
		return response;
	}

	private describeError(response: RequestUrlResponse): string {
		const user = header(response.headers, "xwiki-user");
		const authenticated = !!user && !/XWikiGuest$/.test(user);
		// XWiki reports missing rights as 401 too, with "Error number 9001" and the document in the body.
		const denied = /Access denied in (\w+) mode on document (\S+)/.exec(response.text ?? "");
		if (denied && authenticated) {
			let doc = denied[2];
			try {
				doc = decodeURIComponent(doc);
			} catch {
				// keep raw reference
			}
			return `Access denied: ${user} has no ${denied[1]} right on ${doc}. Check the target space or ask an XWiki admin.`;
		}
		switch (response.status) {
			case 401:
				return authenticated
					? `Access denied (401) for ${user}. The user may lack rights on the target page.`
					: "Authentication failed (401). Check your XWiki token.";
			case 403:
				return "Access denied (403). The token user has no edit right on this page.";
			case 404:
				return "Not found (404). Check the XWiki URL and wiki name.";
			default:
				return `XWiki request failed with status ${response.status}.`;
		}
	}

	/**
	 * Parses a JSON answer. A login page or a proxy error page (HTML) instead of JSON means the request did not
	 * reach the REST API as the token user.
	 */
	private json(response: RequestUrlResponse, url: string): unknown {
		try {
			return response.json as unknown;
		} catch {
			throw new XWikiError(
				`XWiki did not answer with JSON (${url.split("?")[0]}). Check the XWiki URL and that the token is accepted; a login page may have been returned.`,
			);
		}
	}

	/**
	 * Checks that the REST API is reachable and that the token is accepted.
	 * XWiki answers most GET requests for guests too, so the reported user is what proves authentication.
	 */
	async testConnection(): Promise<ConnectionInfo> {
		const url = `${this.base}/rest/wikis/${encodeURIComponent(this.connection.wiki)}`;
		const response = await this.send({ url, method: "GET", headers: { ...this.authHeaders(), Accept: "application/json" } });
		this.json(response, url);
		const user = header(response.headers, "xwiki-user");
		const version = header(response.headers, "xwiki-version");
		console.debug("XWiki Publisher: connection test", { status: response.status, user, version });
		if (user && /XWikiGuest$/.test(user)) {
			throw new XWikiError("XWiki is reachable but the token was not accepted (request ran as guest).");
		}
		return { user };
	}

	private syntaxCache?: Promise<string[]>;

	/** Syntax ids the server can parse, e.g. `xwiki/2.1`, `markdown/1.2`. */
	getSyntaxes(): Promise<string[]> {
		const url = `${this.base}/rest/syntaxes`;
		this.syntaxCache ??= this.send({ url, method: "GET", headers: { ...this.authHeaders(), Accept: "application/json" } }).then((response) =>
			collectSyntaxIds(this.json(response, url)),
		);
		return this.syntaxCache;
	}

	/** Creates or updates a page. Returns `true` when the page was created. */
	async putPage(location: PageLocation, page: PageContent): Promise<boolean> {
		const body =
			'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
			'<page xmlns="http://www.xwiki.org">' +
			`<title>${escapeXml(page.title)}</title>` +
			`<syntax>${escapeXml(page.syntax)}</syntax>` +
			`<content>${escapeXml(page.content)}</content>` +
			"</page>";
		const response = await this.send({
			url: this.pageRestUrl(location),
			method: "PUT",
			contentType: "application/xml; charset=UTF-8",
			headers: { ...this.authHeaders(), Accept: "application/xml" },
			body,
		});
		return response.status === 201;
	}

	/** Reads a page, or returns `null` when it does not exist. */
	async getPage(location: PageLocation): Promise<RemotePage | null> {
		const url = this.pageRestUrl(location);
		const response = await this.send({ url, method: "GET", headers: { ...this.authHeaders(), Accept: "application/json" } }, { allowNotFound: true });
		if (response.status === 404) return null;
		const json = (this.json(response, url) ?? {}) as Partial<Record<keyof RemotePage, unknown>>;
		const text = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value) : "");
		return { title: text(json.title), syntax: text(json.syntax), content: text(json.content), version: text(json.version) };
	}

	/**
	 * Full page as shown in the browser. Unlike the plain rendering it includes content displayed by sheets
	 * (application pages whose data lives in objects), so it is what users see in `#xwikicontent`.
	 */
	async getViewHtml(location: PageLocation): Promise<string> {
		const response = await this.send({
			url: this.viewUrl(location),
			method: "GET",
			headers: { ...this.authHeaders(), Accept: "text/html" },
		});
		return response.text;
	}

	/** Names of the attachments of a page. */
	/** Attachments of a page with their versions, which change whenever a new file is uploaded. */
	async listAttachments(location: PageLocation): Promise<RemoteAttachment[]> {
		return this.listAll(
			`${this.pageRestUrl(location)}/attachments`,
			(json) => {
				const attachments = (json as { attachments?: { name?: unknown; version?: unknown }[] }).attachments ?? [];
				return attachments
					.filter((a): a is { name: string; version?: unknown } => typeof a.name === "string")
					.map((a) => ({ name: a.name, version: typeof a.version === "string" || typeof a.version === "number" ? String(a.version) : "" }));
			},
			(attachment) => attachment.name,
		);
	}

	/**
	 * Rendered HTML of the page content only (no skin), with macros executed: used to convert pages that are not
	 * written in Markdown.
	 */
	async getRenderedHtml(location: PageLocation): Promise<string> {
		// Same address as the view (nested pages end with "/"), served by the "get" action without the skin.
		const response = await this.send({
			url: `${this.viewUrl(location).replace("/bin/view/", "/bin/get/")}?xpage=plain`,
			method: "GET",
			headers: { ...this.authHeaders(), Accept: "text/html" },
		});
		return response.text;
	}

	/** Fetches a REST listing page by page; stops when the server ignores paging and repeats itself. */
	private async listAll<T>(url: string, pick: (json: unknown) => T[], key: (item: T) => string): Promise<T[]> {
		const pageSize = 100;
		const items: T[] = [];
		const seen = new Set<string>();
		for (let start = 0; ; start += pageSize) {
			const separator = url.includes("?") ? "&" : "?";
			const pageUrl = `${url}${separator}start=${start}&number=${pageSize}`;
			const response = await this.send({ url: pageUrl, method: "GET", headers: { ...this.authHeaders(), Accept: "application/json" } });
			const batch = pick(this.json(response, pageUrl));
			const fresh = batch.filter((item) => !seen.has(key(item)));
			fresh.forEach((item) => seen.add(key(item)));
			items.push(...fresh);
			if (batch.length < pageSize || fresh.length === 0) return items;
		}
	}

	/** All spaces of the wiki, nested ones included, as space name chains. */
	async listSpaces(): Promise<string[][]> {
		const ids = await this.listAll(
			`${this.base}/rest/wikis/${encodeURIComponent(this.connection.wiki)}/spaces`,
			(json) => {
				const spaces = (json as { spaces?: { id?: unknown }[] }).spaces ?? [];
				return spaces.map((space) => space.id).filter((id): id is string => typeof id === "string");
			},
			(id) => id,
		);
		// Space ids look like `xwiki:Parent.Child`; wiki ids cannot contain a colon.
		return ids.map((id) => splitSpaceReference(id.slice(id.indexOf(":") + 1)));
	}

	/** Names of the pages directly inside a space. */
	async listPages(spaces: string[]): Promise<string[]> {
		const path = spaces.map((s) => `spaces/${encodeURIComponent(s)}`).join("/");
		return this.listAll(
			`${this.base}/rest/wikis/${encodeURIComponent(this.connection.wiki)}/${path}/pages`,
			(json) => {
				const pages = (json as { pageSummaries?: { name?: unknown }[] }).pageSummaries ?? [];
				return pages.map((page) => page.name).filter((name): name is string => typeof name === "string");
			},
			(name) => name,
		);
	}

	/**
	 * Pages at or below a space found through the Solr index; used when the space listing does not show the space.
	 * Solr is the query type XWiki allows for regular users by default (XWQL/HQL are often disabled over REST).
	 * The index is updated asynchronously, so pages saved a few seconds ago may be missing.
	 */
	async queryPagesUnder(root: string[]): Promise<PageLocation[]> {
		const space = serializeSpaceReference(root).replace(/(["\\])/g, "\\$1");
		const query = `type:DOCUMENT AND (space_prefix:"${space}" OR space_exact:"${space}")`;
		const ids = await this.listAll(
			`${this.base}/rest/wikis/${encodeURIComponent(this.connection.wiki)}/query?type=solr&q=${encodeURIComponent(query)}`,
			(json) => {
				const results = (json as { searchResults?: { id?: unknown; pageFullName?: unknown }[] }).searchResults ?? [];
				return results
					.map((result) => (typeof result.pageFullName === "string" ? result.pageFullName : result.id))
					.filter((id): id is string => typeof id === "string");
			},
			(id) => id,
		);
		// Ids may carry the wiki (`xwiki:`) prefix; translations of a page share the same reference.
		const unique = new Set(ids.map((id) => (/^[^.:]+:/.test(id) ? id.slice(id.indexOf(":") + 1) : id)));
		return [...unique].map(parseReference).filter((location): location is PageLocation => location !== null);
	}

	async getAttachment(location: PageLocation, name: string): Promise<ArrayBuffer> {
		const response = await this.send(
			{ url: `${this.pageRestUrl(location)}/attachments/${encodeURIComponent(name)}`, method: "GET", headers: this.authHeaders() },
			{ timeoutMs: ATTACHMENT_TIMEOUT_MS },
		);
		return response.arrayBuffer;
	}

	async putAttachment(location: PageLocation, name: string, data: ArrayBuffer): Promise<void> {
		await this.send(
			{
				url: `${this.pageRestUrl(location)}/attachments/${encodeURIComponent(name)}`,
				method: "PUT",
				contentType: "application/octet-stream",
				headers: { ...this.authHeaders(), Accept: "application/xml" },
				body: data,
			},
			{ timeoutMs: ATTACHMENT_TIMEOUT_MS },
		);
	}
}

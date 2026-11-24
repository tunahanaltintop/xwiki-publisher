import { requestUrl, RequestUrlResponse } from "obsidian";
import { CommentResolutions, CommentSelection, PageSelection, parseAnnotationAnswer, parseComments, parseResolutions, parseSelections, RemoteComment } from "./inline-comments";
import { MentionUser, parseUsers } from "./mentions";
import { PageLocation, parseReference, parseXWikiUrl, serializeReference, serializeSpaceReference, splitSpaceReference, XWikiUrl } from "./location";
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
	/** Token XWiki wants back with a form it is sent; every answer of its REST API carries it. */
	private formToken?: string;
	/** Names of users already asked for, by reference: a sync mentions the same users on many pages. */
	private readonly userNames = new Map<string, Promise<string | undefined>>();

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
		this.formToken = header(response.headers, "xwiki-form-token") ?? this.formToken;
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
				return "Access denied (403). The token user has no right to do this on the page.";
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

	/** Deletes the page with its attachments; the pages below it stay. A page that no longer exists is not an error. */
	async deletePage(location: PageLocation): Promise<void> {
		await this.send({ url: this.pageRestUrl(location), method: "DELETE", headers: { ...this.authHeaders(), Accept: "application/json" } }, { allowNotFound: true });
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

	/** Comments of a page, replies included, with the names of their authors. */
	async listComments(location: PageLocation): Promise<RemoteComment[]> {
		return this.listAll(`${this.pageRestUrl(location)}/comments?prettyNames=true`, parseComments, (comment) => String(comment.id));
	}

	/**
	 * Text each inline comment (annotation) of a page is attached to, by comment id. XWiki keeps it in the comment
	 * objects of the page, which the comment listing does not show.
	 */
	async getCommentSelections(location: PageLocation): Promise<Map<number, CommentSelection>> {
		const url = `${this.pageRestUrl(location)}?objects=true`;
		const response = await this.send({ url, method: "GET", headers: { ...this.authHeaders(), Accept: "application/json" } }, { allowNotFound: true });
		return response.status === 404 ? new Map() : parseSelections(this.json(response, url));
	}

	/**
	 * XWiki's user search, the one its editor lists users from after `@`. It is a page template, asked through
	 * `page`, which must be a page the user can view.
	 */
	private async suggestUsers(page: PageLocation, parameters: Record<string, string>): Promise<MentionUser[]> {
		const query = Object.entries({ xpage: "uorgsuggest", media: "json", uorg: "user", ...parameters })
			.map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
			.join("&");
		const url = `${this.viewUrl(page).replace("/bin/view/", "/bin/get/")}?${query}`;
		const response = await this.send({ url, method: "GET", headers: { ...this.authHeaders(), Accept: "application/json" } });
		return parseUsers(this.json(response, url));
	}

	/** Users whose login or name contains `input`, in the order XWiki suggests them for a mention. */
	searchUsers(page: PageLocation, input: string, limit = 8): Promise<MentionUser[]> {
		return this.suggestUsers(page, { input, limit: String(limit) });
	}

	/** Name of a user as XWiki shows it, by the reference of a mention; `undefined` when it cannot be read. */
	userName(page: PageLocation, reference: string): Promise<string | undefined> {
		let name = this.userNames.get(reference);
		if (!name) {
			name = this.suggestUsers(page, { input: reference, exactMatch: "true" }).then(
				(users) => users.find((user) => user.reference === reference)?.name,
				() => undefined,
			);
			this.userNames.set(reference, name);
		}
		return name;
	}

	private annotationsUrl(location: PageLocation): string {
		return `${this.pageRestUrl(location)}/annotations`;
	}

	/**
	 * The page as XWiki renders it for commenting: the HTML whose text its inline comments are attached to. The page
	 * must exist.
	 */
	async getAnnotatedHtml(location: PageLocation): Promise<string> {
		const url = this.annotationsUrl(location);
		const response = await this.send({ url, method: "GET", headers: { ...this.authHeaders(), Accept: "application/json" } }, { allowNotFound: true });
		if (response.status === 404) throw new XWikiError("XWiki has no annotations API: inline comments cannot be added from here.");
		const answer = parseAnnotationAnswer(this.json(response, url));
		if (!answer.ok) throw new XWikiError(`XWiki could not render the page for commenting: ${answer.message || "no reason given"}`);
		return answer.html;
	}

	/**
	 * Adds an inline comment (annotation) on a text of the page, as the signed-in user. Sent like XWiki's own comment
	 * dialog does: as a form, which XWiki accepts with the token it gave in an earlier answer. Needs comment right.
	 */
	async addAnnotation(location: PageLocation, target: PageSelection, text: string): Promise<void> {
		const url = this.annotationsUrl(location);
		// Any answer of the REST API carries the token; versions that do not ask for one do not send one.
		if (!this.formToken) await this.send({ url: this.pageRestUrl(location), method: "GET", headers: { ...this.authHeaders(), Accept: "application/json" } }, { allowNotFound: true });
		const form = { selection: target.selection, selectionContext: target.context, selectionOffset: String(target.offset), comment: text };
		const response = await this.send({
			url,
			method: "POST",
			contentType: "application/x-www-form-urlencoded; charset=UTF-8",
			headers: { ...this.authHeaders(), Accept: "application/json", ...(this.formToken ? { "XWiki-Form-Token": this.formToken } : {}) },
			body: Object.entries(form)
				.map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
				.join("&"),
		});
		const answer = parseAnnotationAnswer(this.json(response, url));
		if (!answer.ok) throw new XWikiError(`XWiki did not save the comment: ${answer.message || "no reason given"}`);
	}

	/** Page of the wiki that tells which comments are resolved, on wikis that have comment resolution. */
	private resolutionUrl(location: PageLocation): string {
		const page = `${this.connection.wiki}:${serializeReference(location)}`;
		return `${this.base}/bin/get/Tools/CommentResolve/?xpage=plain&outputSyntax=plain&page=${encodeURIComponent(page)}`;
	}

	/** Whether the wiki has comment resolution; asked once. */
	private resolutionSupported?: boolean;

	/**
	 * Which comments of a page are resolved, from the wiki's comment resolution service; `null` when the wiki has
	 * none, which is then not asked again.
	 */
	async getCommentResolutions(location: PageLocation): Promise<CommentResolutions | null> {
		if (this.resolutionSupported === false) return null;
		const url = this.resolutionUrl(location);
		const response = await this.send({ url, method: "GET", headers: { ...this.authHeaders(), Accept: "application/json" } }, { allowNotFound: true });
		let resolutions: CommentResolutions | null = null;
		if (response.status !== 404) {
			try {
				resolutions = parseResolutions(response.json);
			} catch {
				resolutions = null;
			}
		}
		this.resolutionSupported = resolutions !== null;
		return resolutions;
	}

	/**
	 * Resolves or reopens an inline comment through the wiki's comment resolution service, as its comment panel does:
	 * a form, sent with the token XWiki gave in an earlier answer. Returns the resolution state of the page after it.
	 */
	async setCommentResolved(location: PageLocation, id: number, resolved: boolean): Promise<CommentResolutions> {
		// Any answer of the REST API carries the token.
		if (!this.formToken) await this.send({ url: this.pageRestUrl(location), method: "GET", headers: { ...this.authHeaders(), Accept: "application/json" } }, { allowNotFound: true });
		const form: Record<string, string> = { action: "set", id: String(id), resolved: resolved ? "1" : "0", form_token: this.formToken ?? "" };
		const url = this.resolutionUrl(location);
		const response = await this.send({
			url,
			method: "POST",
			contentType: "application/x-www-form-urlencoded; charset=UTF-8",
			headers: { ...this.authHeaders(), Accept: "application/json", ...(this.formToken ? { "XWiki-Form-Token": this.formToken } : {}) },
			body: Object.entries(form)
				.map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
				.join("&"),
		});
		let state: CommentResolutions | null = null;
		try {
			state = parseResolutions(response.json);
		} catch {
			state = null;
		}
		if (!state) throw new XWikiError("XWiki did not answer as its comment resolution service does: the comment may not be resolved.");
		if (state.resolved.has(id) !== resolved) throw new XWikiError(resolved ? "XWiki did not resolve the comment." : "XWiki did not reopen the comment.");
		return state;
	}

	/** Deletes a comment of a page (its object); one that is already gone is not an error. Needs edit right. */
	async deleteComment(location: PageLocation, id: number): Promise<void> {
		await this.send(
			{ url: `${this.pageRestUrl(location)}/objects/XWiki.XWikiComments/${id}`, method: "DELETE", headers: { ...this.authHeaders(), Accept: "application/json" } },
			{ allowNotFound: true },
		);
	}

	/** Adds a comment to a page as the signed-in user, as a reply to the comment `replyTo`. Needs edit right. */
	async addComment(location: PageLocation, text: string, replyTo?: number): Promise<void> {
		const body =
			'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
			'<comment xmlns="http://www.xwiki.org">' +
			`<text>${escapeXml(text)}</text>` +
			(replyTo === undefined ? "" : `<replyTo>${replyTo}</replyTo>`) +
			"</comment>";
		await this.send({
			url: `${this.pageRestUrl(location)}/comments`,
			method: "POST",
			contentType: "application/xml; charset=UTF-8",
			headers: { ...this.authHeaders(), Accept: "application/xml" },
			body,
		});
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

	private openProjectInstance?: Promise<string>;

	/** A value from the REST API of the XWiki OpenProject extension; a 404 means that the extension is missing. */
	private async openProjectValue(path: string, key: string): Promise<string> {
		const url = `${this.base}/rest/openproject/${path}`;
		const response = await this.send({ url, method: "GET", headers: { ...this.authHeaders(), Accept: "application/json" } }, { allowNotFound: true });
		if (response.status === 404) throw new XWikiError("XWiki has no OpenProject integration API; an administrator installs the OpenProject Integration (Pro) extension.");
		const value = ((this.json(response, url) ?? {}) as Record<string, unknown>)[key];
		if (typeof value !== "string" && typeof value !== "number") throw new XWikiError(`XWiki's OpenProject integration did not report "${key}".`);
		return String(value);
	}

	/** Identifier of this XWiki in OpenProject: the universal identifier of its wiki provider there. */
	getOpenProjectInstanceId(): Promise<string> {
		this.openProjectInstance ??= this.openProjectValue("metadata", "instanceId");
		return this.openProjectInstance;
	}

	/** Identifier of a page in OpenProject's wiki page links; it stays the same when the page moves. */
	getOpenProjectPageId(location: PageLocation): Promise<string> {
		const reference = `${this.connection.wiki}:${serializeReference(location)}`;
		return this.openProjectValue(`documents?docRef=${encodeURIComponent(reference)}`, "id");
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

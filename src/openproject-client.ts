import { requestUrl, RequestUrlResponse } from "obsidian";
import { OpenProjectError, PageLink, RELATION_LINK_TYPE, relationLinkIn, WikiLinkApi } from "./openproject";
import { normalizeToken } from "./token";

export interface OpenProjectConnection {
	baseUrl: string;
	token: string;
}

const TIMEOUT_MS = 60_000;

function filters(link: PageLink): string {
	return encodeURIComponent(
		JSON.stringify([
			{ provider: { operator: "=", values: [link.provider] } },
			{ identifier: { operator: "=", values: [link.identifier] } },
			{ wiki_page_link_type: { operator: "=", values: [RELATION_LINK_TYPE] } },
		]),
	);
}

export class OpenProjectClient implements WikiLinkApi {
	/** The user of the token: new links are recorded with this user as their author. */
	private user?: Promise<{ id: number; name: string }>;

	constructor(private readonly connection: OpenProjectConnection) {}

	private get base(): string {
		return this.connection.baseUrl.replace(/\/+$/, "");
	}

	/** API path as OpenProject expects it in links, which includes the path of an instance below a subfolder. */
	private apiPath(path: string): string {
		return `${new URL(this.base).pathname.replace(/\/+$/, "")}/api/v3/${path}`;
	}

	private headers(): Record<string, string> {
		return { Authorization: `Bearer ${normalizeToken(this.connection.token)}`, Accept: "application/hal+json" };
	}

	/** requestUrl has no timeout of its own; give up after a while instead of waiting forever. */
	private withTimeout<T>(request: Promise<T>, url: string): Promise<T> {
		let timer = 0;
		const timeout = new Promise<never>((_, reject) => {
			timer = window.setTimeout(() => reject(new OpenProjectError(`OpenProject did not answer within ${TIMEOUT_MS / 1000} s (${url.split("?")[0]}).`)), TIMEOUT_MS);
		});
		return Promise.race([request, timeout]).finally(() => window.clearTimeout(timer));
	}

	private async send(method: string, path: string, body?: unknown): Promise<RequestUrlResponse> {
		const url = `${this.base}/api/v3/${path}`;
		const response = await this.withTimeout(
			requestUrl({
				url,
				method,
				headers: this.headers(),
				throw: false,
				...(body === undefined ? {} : { contentType: "application/json", body: JSON.stringify(body) }),
			}),
			url,
		);
		if (response.status >= 400) {
			// Never log request headers: they contain the token.
			console.error("XWiki Publisher: OpenProject request failed", { method, url, status: response.status, body: response.text?.slice(0, 500) });
			throw new OpenProjectError(this.describeError(response), response.status);
		}
		return response;
	}

	private describeError(response: RequestUrlResponse): string {
		switch (response.status) {
			case 401:
				return "Authentication failed (401). Check your OpenProject token.";
			case 403:
				return "Access denied (403). The token user may lack the \"Manage wiki page links\" permission.";
			case 404:
				return "Not found (404). The work package does not exist or the token user cannot see it.";
		}
		try {
			const text = (response.json as { message?: unknown }).message;
			if (typeof text === "string" && text) return `${text} (${response.status})`;
		} catch {
			// Not JSON: a proxy or login page.
		}
		return `OpenProject request failed with status ${response.status}.`;
	}

	/** A login page or a proxy error page instead of JSON means the request did not reach the API as the token user. */
	private json(response: RequestUrlResponse, path: string): unknown {
		try {
			return response.json as unknown;
		} catch {
			throw new OpenProjectError(`OpenProject did not answer with JSON (${path.split("?")[0]}). Check the OpenProject URL; a login page may have been returned.`);
		}
	}

	private currentUser(): Promise<{ id: number; name: string }> {
		this.user ??= this.send("GET", "users/me").then((response) => {
			const { id, name } = (this.json(response, "users/me") ?? {}) as { id?: unknown; name?: unknown };
			// Anonymous visitors have no id: the instance answered without accepting the token.
			if (typeof id !== "number") throw new OpenProjectError("OpenProject is reachable but the token was not accepted.");
			return { id, name: typeof name === "string" ? name : String(id) };
		});
		return this.user;
	}

	/** Checks that the API is reachable and that the token is accepted; returns the name of its user. */
	async testConnection(): Promise<string> {
		return (await this.currentUser()).name;
	}

	/** Checks that this OpenProject offers wiki page links and has `provider` as an enabled wiki provider. */
	async checkWikiProvider(provider: string): Promise<void> {
		// Filtering by a page nobody links keeps the answer empty, so it does not depend on the user's link to XWiki.
		const path = `wiki_page_links?filters=${filters({ provider, identifier: "xwiki-publisher-connection-test" })}`;
		try {
			await this.send("GET", path);
		} catch (error) {
			if (error instanceof OpenProjectError && error.status === 404) {
				throw new OpenProjectError("OpenProject has no wiki page link API; version 17.6 or later is needed.", 404);
			}
			if (error instanceof OpenProjectError && error.status === 400) {
				throw new OpenProjectError(`This XWiki (${provider}) is not an enabled wiki provider of OpenProject; an administrator adds it under Administration → Wikis.`, 400);
			}
			throw error;
		}
	}

	async findLink(workPackage: string, link: PageLink): Promise<number | null> {
		const path = `work_packages/${encodeURIComponent(workPackage)}/wiki_page_links?filters=${filters(link)}`;
		return relationLinkIn(this.json(await this.send("GET", path), path), link);
	}

	async createLink(workPackage: string, link: PageLink): Promise<void> {
		const { id } = await this.currentUser();
		await this.send("POST", `work_packages/${encodeURIComponent(workPackage)}/wiki_page_links`, {
			_type: "Collection",
			_embedded: {
				elements: [
					{
						identifier: link.identifier,
						wiki_page_link_type: RELATION_LINK_TYPE,
						author: { href: this.apiPath(`users/${id}`) },
						provider: { href: this.apiPath(`wiki_providers/${encodeURIComponent(link.provider)}`) },
					},
				],
			},
		});
	}

	async deleteLink(id: number): Promise<void> {
		await this.send("DELETE", `wiki_page_links/${id}`);
	}
}

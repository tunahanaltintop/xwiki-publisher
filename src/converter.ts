/**
 * Converts Obsidian-flavoured Markdown into Markdown that the XWiki Markdown syntax (markdown/1.2) understands.
 * This module is free of Obsidian imports so it can be unit tested with plain Node.
 */

export type ResolvedLink =
	| { kind: "attachment"; vaultPath: string; name: string; url: string }
	| { kind: "page"; url: string };

/** Resolves a link path (without `#heading` and `|alias`) relative to the note being converted. */
export type LinkResolver = (linkpath: string) => ResolvedLink | null;

export interface ConvertResult {
	markdown: string;
	/** Attachments referenced by the note: attachment name -> vault path. */
	attachments: Map<string, string>;
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp", "avif"]);

function isImage(name: string): boolean {
	const dot = name.lastIndexOf(".");
	return dot >= 0 && IMAGE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

function isExternal(url: string): boolean {
	return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("#") || url.startsWith("//");
}

export function stripFrontmatter(content: string): string {
	const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(content);
	return match ? content.slice(match[0].length) : content;
}

function splitTarget(raw: string): { target: string; heading?: string; alias?: string } {
	// Inside tables Obsidian writes the alias separator as `\|`.
	const inner = raw.replace(/\\\|/g, "|");
	const pipe = inner.indexOf("|");
	const ref = pipe >= 0 ? inner.slice(0, pipe) : inner;
	const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() : undefined;
	const hash = ref.indexOf("#");
	const target = (hash >= 0 ? ref.slice(0, hash) : ref).trim();
	const heading = hash >= 0 ? ref.slice(hash + 1).trim() : undefined;
	return { target, heading: heading || undefined, alias: alias || undefined };
}

/** `![[img.png|300]]` / `|300x200` are size hints, not alt texts. */
function isSizeHint(alias: string): boolean {
	return /^\d+(x\d+)?$/.test(alias);
}

function lastSegment(path: string): string {
	const name = path.split("/").pop() ?? path;
	return name.replace(/\.md$/i, "");
}

function escapeLabel(label: string): string {
	return label.replace(/([[\]])/g, "\\$1");
}

function wrapUrl(url: string): string {
	return /[\s()]/.test(url) ? `<${url}>` : url;
}

/** Splits a Markdown table row into trimmed cells; escaped pipes (`\|`) stay inside their cell. */
function splitTableRow(line: string): string[] {
	let row = line.trim();
	if (row.startsWith("|")) row = row.slice(1);
	if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
	const cells: string[] = [];
	let cell = "";
	for (let i = 0; i < row.length; i++) {
		if (row[i] === "\\" && row[i + 1] === "|") {
			cell += "\\|";
			i++;
		} else if (row[i] === "|") {
			cells.push(cell);
			cell = "";
		} else {
			cell += row[i];
		}
	}
	cells.push(cell);
	return cells.map((c) => c.trim());
}

/** Text written in empty table cells: XWiki drops empty Markdown cells, which shifts or merges the columns. */
export const EMPTY_CELL = "&nbsp;";

/**
 * Gives every row of every table as many cells as its header and fills empty cells with a non-breaking space,
 * so XWiki keeps the column structure.
 */
function fillTableCells(text: string): string {
	const lines = text.split("\n");
	for (let i = 1; i < lines.length; i++) {
		const header = splitTableRow(lines[i - 1]);
		const delimiter = splitTableRow(lines[i]);
		const isTable =
			lines[i - 1].includes("|") && delimiter.length === header.length && delimiter.every((cell) => /^:?-+:?$/.test(cell));
		if (!isTable) continue;
		const width = header.length;
		const fill = (line: string) => {
			const cells = splitTableRow(line);
			while (cells.length < width) cells.push("");
			return `| ${cells.map((cell) => cell || EMPTY_CELL).join(" | ")} |`;
		};
		lines[i - 1] = fill(lines[i - 1]);
		for (let j = i + 1; j < lines.length && lines[j].includes("|") && lines[j].trim(); j++) lines[j] = fill(lines[j]);
	}
	return lines.join("\n");
}

function convertText(text: string, resolve: LinkResolver, attachments: Map<string, string>): string {
	// Obsidian comments are private and never published.
	let out = text.replace(/%%[\s\S]*?%%/g, "");

	const renderEmbedOrLink = (embed: boolean, label: string, resolved: ResolvedLink | null, fallback: string): string => {
		if (!resolved) return fallback;
		if (resolved.kind === "attachment") {
			attachments.set(resolved.name, resolved.vaultPath);
			if (embed && isImage(resolved.name)) {
				// XWiki Markdown treats a bare file name as a relative URL, not as an attachment: use the download URL.
				return `![${escapeLabel(label)}](${wrapUrl(resolved.url)})`;
			}
			return `[${escapeLabel(label)}](${wrapUrl(resolved.url)})`;
		}
		return `[${escapeLabel(label)}](${wrapUrl(resolved.url)})`;
	};

	// Wiki embeds: ![[file]]
	out = out.replace(/!\[\[([^\]\n]+)\]\]/g, (whole, inner: string) => {
		const { target, heading, alias } = splitTarget(inner);
		const resolved = resolve(target);
		const label = alias && !isSizeHint(alias) ? alias : lastSegment(target);
		if (resolved?.kind === "page") {
			// Note transclusion is not supported in XWiki: degrade to a link.
			return renderEmbedOrLink(false, heading ? `${label} > ${heading}` : label, resolved, label);
		}
		return renderEmbedOrLink(true, label, resolved, whole);
	});

	// Wiki links: [[Note#Heading|Alias]]
	out = out.replace(/\[\[([^\]\n]+)\]\]/g, (_whole, inner: string) => {
		const { target, heading, alias } = splitTarget(inner);
		const label = alias ?? (heading ? (target ? `${lastSegment(target)} > ${heading}` : heading) : lastSegment(target));
		if (!target) return label;
		return renderEmbedOrLink(false, label, resolve(target), label);
	});

	// Standard Markdown links/images pointing to local vault files.
	out = out.replace(
		/(!?)\[([^\]\n]*)\]\((?:<([^>\n]+)>|([^)\s]+))(\s+"[^"\n]*")?\)/g,
		(whole, bang: string, label: string, angled?: string, plain?: string) => {
			const raw = angled ?? plain ?? "";
			if (isExternal(raw)) return whole;
			let decoded = raw;
			try {
				decoded = decodeURI(raw);
			} catch {
				// keep raw value
			}
			const target = decoded.split("#")[0];
			if (!target) return whole;
			const resolved = resolve(target);
			if (!resolved) return whole;
			return renderEmbedOrLink(bang === "!", label || lastSegment(target), resolved, whole);
		},
	);

	return out;
}

/**
 * Applies `transform` to every part of `markdown` that is not code: fenced code blocks and inline code spans
 * are passed through untouched.
 */
export function transformOutsideCode(markdown: string, transform: (text: string) => string): string {
	const lines = markdown.split("\n");
	const output: string[] = [];
	let buffer: string[] = [];
	let fence: string | null = null;

	const flush = () => {
		if (buffer.length === 0) return;
		const codeSpans: string[] = [];
		// Code spans are swapped for placeholders built from private-use characters, which never occur in notes.
		const masked = buffer.join("\n").replace(/(`+)[\s\S]*?\1|<!--[\s\S]*?-->/g, (span) => {
			codeSpans.push(span);
			return `\uE000${codeSpans.length - 1}\uE001`;
		});
		output.push(transform(masked).replace(/\uE000(\d+)\uE001/g, (_m, i: string) => codeSpans[Number(i)]));
		buffer = [];
	};

	let previousBlank = true;
	let indentedCode = false;
	let inList = false;
	for (const line of lines) {
		const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
		const listItem = /^\s*([-*+]|\d+[.)])\s/.test(line);
		// An indented code block starts after a blank line with 4 spaces or a tab, but not inside a list, where
		// indented lines continue the list item.
		const indented = /^( {4}|\t)/.test(line) && !listItem;
		if (listItem) inList = true;
		else if (line.trim() && !/^\s/.test(line)) inList = false;
		if (fence === null && !inList && (indentedCode || (previousBlank && indented))) {
			if (indented || !line.trim()) {
				if (!indentedCode) flush();
				indentedCode = true;
				output.push(line);
				previousBlank = !line.trim();
				continue;
			}
			indentedCode = false;
		}
		previousBlank = !line.trim();
		if (fence === null && fenceMatch) {
			flush();
			fence = fenceMatch[1];
			output.push(line);
		} else if (fence !== null) {
			output.push(line);
			if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length && line.trim() === fenceMatch[1]) {
				fence = null;
			}
		} else {
			buffer.push(line);
		}
	}
	flush();
	return output.join("\n");
}

/** Converts a whole note (frontmatter included) into XWiki Markdown. Code is left untouched. */
export function convertNote(content: string, resolve: LinkResolver): ConvertResult {
	const attachments = new Map<string, string>();
	const markdown = transformOutsideCode(stripFrontmatter(content), (text) => fillTableCells(convertText(text, resolve, attachments)));
	return { markdown: markdown.trim() + "\n", attachments };
}

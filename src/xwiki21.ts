/**
 * Converts XWiki 2.x syntax into XWiki Markdown 1.2 from the page source, without executing anything.
 *
 * Macro calls (`{{openproject …/}}`, `{{toc/}}`, `{{info}}…{{/info}}`…) are copied as they are: Markdown 1.2 accepts
 * the same macro syntax, so they keep working once the note is published back. Links and images use the wiki-style
 * syntax of Markdown 1.2 (`[[label|Space.Page]]`, `![[alt|file.png]]`) so XWiki references survive unchanged.
 * Free of Obsidian imports so it can be unit tested.
 */

/** Macros whose content is wiki syntax: it is converted too, since the page around it becomes Markdown. */
const WIKI_CONTENT_MACROS = new Set(["info", "warning", "error", "success", "box"]);

interface MacroCall {
	name: string;
	/** Raw parameter text, including its leading space, e.g. ` language="java"`. */
	params: string;
	/** Macro content, or `null` for a self-closing call. */
	content: string | null;
	/** Offset just after the call. */
	end: number;
}

/** Reads the macro call starting at `start` (at `{{`), including nested calls of the same macro. */
function readMacro(src: string, start: number): MacroCall | null {
	const nameMatch = /^\{\{([A-Za-z][\w.-]*)/.exec(src.slice(start));
	if (!nameMatch) return null;
	const name = nameMatch[1];
	// End of the opening tag: the first `}}` outside quoted parameter values.
	let i = start + nameMatch[0].length;
	let quote: string | null = null;
	for (; i < src.length - 1; i++) {
		const ch = src[i];
		if (quote) {
			if (ch === "\\") i++;
			else if (ch === quote) quote = null;
		} else if (ch === '"' || ch === "'") {
			quote = ch;
		} else if (ch === "}" && src[i + 1] === "}") {
			break;
		}
	}
	if (i >= src.length - 1) return null;
	const tagEnd = i + 2;
	const inner = src.slice(start + nameMatch[0].length, i);
	if (inner.trimEnd().endsWith("/")) {
		return { name, params: inner.trimEnd().slice(0, -1), content: null, end: tagEnd };
	}
	if (inner && !/^\s/.test(inner)) return null;

	// Find the matching closing tag, counting nested calls of the same macro.
	const opening = new RegExp(`\\{\\{${name.replace(/[.-]/g, "\\$&")}(?=[\\s/}])`, "g");
	const closing = `{{/${name}}}`;
	let depth = 1;
	let cursor = tagEnd;
	while (depth > 0) {
		const close = src.indexOf(closing, cursor);
		if (close < 0) return null;
		opening.lastIndex = cursor;
		const open = opening.exec(src);
		if (open && open.index < close) {
			const nested = readMacro(src, open.index);
			if (nested && nested.content === null) {
				cursor = nested.end;
				continue;
			}
			depth++;
			cursor = open.index + 2;
			continue;
		}
		depth--;
		cursor = close + closing.length;
	}
	const contentEnd = cursor - closing.length;
	return { name, params: inner, content: src.slice(tagEnd, contentEnd).replace(/^\n/, "").replace(/\n$/, ""), end: cursor };
}

function parameter(params: string, key: string): string | undefined {
	const match = new RegExp(`(?:^|\\s)${key}\\s*=\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|'([^']*)'|(\\S+))`).exec(params);
	return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

function fence(content: string, language = ""): string {
	const longest = Math.max(2, ...(content.match(/`+/g) ?? []).map((ticks) => ticks.length));
	const ticks = "`".repeat(longest + 1);
	return `${ticks}${language}\n${content.replace(/\n$/, "")}\n${ticks}`;
}

function codeSpan(content: string): string {
	const ticks = content.includes("`") ? "``" : "`";
	const pad = content.startsWith("`") || content.endsWith("`") ? " " : "";
	return `${ticks}${pad}${content}${pad}${ticks}`;
}

function renderMacro(call: MacroCall, source: string): string {
	if (call.name === "code" && call.content !== null) {
		const language = parameter(call.params, "language");
		return fence(call.content, language && language !== "none" ? language : "");
	}
	if (WIKI_CONTENT_MACROS.has(call.name) && call.content !== null) {
		return `{{${call.name}${call.params}}}\n${xwiki21ToMarkdown(call.content).trim()}\n{{/${call.name}}}`;
	}
	return source;
}

/** Placeholders built from private-use characters, which never occur in pages. */
class Placeholders {
	private readonly values: string[] = [];

	add(value: string): string {
		this.values.push(value);
		return `${this.values.length - 1}`;
	}

	restore(text: string): string {
		let out = text;
		for (let guard = 0; guard < 10 && out.includes(""); guard++) {
			out = out.replace(/(\d+)/g, (_m, i: string) => this.values[Number(i)]);
		}
		return out;
	}
}

function isUrl(target: string): boolean {
	return /^(https?|ftp|mailto):/i.test(target);
}

function wrapUrl(url: string): string {
	return /[\s()]/.test(url) ? `<${url}>` : url;
}

function convertImage(reference: string, params: string): string {
	const target = reference.trim();
	const alt = parameter(params, "alt") ?? target.slice(target.lastIndexOf("@") + 1).split("/").pop() ?? "";
	if (isUrl(target)) return `![${alt}](${wrapUrl(target)})`;
	return `![[${alt}|${target}]]`;
}

function convertLink(inner: string): string {
	const separator = inner.indexOf(">>");
	const rawLabel = separator >= 0 ? inner.slice(0, separator) : undefined;
	let target = separator >= 0 ? inner.slice(separator + 2) : inner;
	const paramsAt = target.indexOf("||");
	const params = paramsAt >= 0 ? target.slice(paramsAt + 2) : "";
	if (paramsAt >= 0) target = target.slice(0, paramsAt);
	target = target.trim();

	if (rawLabel === undefined && /^image:/i.test(target)) return convertImage(target.slice("image:".length), params);
	// An image used as a link label: keep the image, Obsidian has no linked embeds.
	const imageLabel = rawLabel !== undefined ? /^\s*\[\[image:([\s\S]*?)\]\]\s*$/.exec(rawLabel) : null;
	if (imageLabel) {
		const [reference, ...imageParams] = imageLabel[1].split("||");
		return convertImage(reference, imageParams.join("||"));
	}
	const label = rawLabel !== undefined ? inline(rawLabel).trim() : undefined;
	if (/^url:/i.test(target)) target = target.slice("url:".length);
	if (isUrl(target)) return label ? `[${label}](${wrapUrl(target)})` : `<${target}>`;
	return `[[${label ?? target}|${target}]]`;
}

/** Replaces every `[[…]]` link, matching nested brackets such as `[[[[image:a.png]]>>Page]]`. */
function replaceLinks(text: string, convert: (inner: string) => string): string {
	let out = "";
	let i = 0;
	while (i < text.length) {
		const start = text.indexOf("[[", i);
		if (start < 0) break;
		let depth = 0;
		let end = -1;
		for (let j = start; j < text.length - 1; j++) {
			if (text.startsWith("[[", j)) {
				depth++;
				j++;
			} else if (text.startsWith("]]", j)) {
				depth--;
				j++;
				if (depth === 0) {
					end = j + 1;
					break;
				}
			}
		}
		if (end < 0) break;
		out += text.slice(i, start) + convert(text.slice(start + 2, end - 2));
		i = end;
	}
	return out + text.slice(i);
}

/** Converts inline XWiki 2.x markup of one line or table cell. */
function inline(text: string): string {
	const keep = new Placeholders();
	let out = text;

	// Verbatim, macros, links and URLs first: their text must not be read as formatting.
	out = out.replace(/\{\{\{([\s\S]*?)\}\}\}/g, (_m, verbatim: string) => keep.add(codeSpan(verbatim)));
	let macroAt = out.indexOf("{{");
	while (macroAt >= 0) {
		const call = readMacro(out, macroAt);
		if (call) {
			const source = out.slice(macroAt, call.end);
			const rendered = call.name === "code" && call.content !== null ? codeSpan(call.content) : source;
			const placeholder = keep.add(rendered);
			out = out.slice(0, macroAt) + placeholder + out.slice(call.end);
			macroAt = out.indexOf("{{", macroAt + placeholder.length);
		} else {
			macroAt = out.indexOf("{{", macroAt + 2);
		}
	}
	out = replaceLinks(out, (link) => keep.add(convertLink(link)));
	out = out.replace(/~(.)/g, (_m, ch: string) => keep.add(/[\\`*_{}[\]()#+\-.!|<>~^]/.test(ch) ? `\\${ch}` : ch));
	out = out.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>\]|)]+/gi, (url) => keep.add(url));

	out = out
		// Parameters such as (% class="x" %) have no Markdown equivalent.
		.replace(/\(%[\s\S]*?%\)/g, "")
		.replace(/\/\/(?=\S)([\s\S]*?\S)\/\//g, "*$1*")
		.replace(/__(?=\S)([\s\S]*?\S)__/g, "$1")
		.replace(/--(?=\S)([^\n]*?\S)--/g, "~~$1~~")
		.replace(/##(?=\S)([^\n]*?\S)##/g, (_m, code: string) => keep.add(codeSpan(code)))
		.replace(/\^\^(?=\S)([^\n]*?\S)\^\^/g, "^$1^")
		.replace(/,,(?=\S)([^\n]*?\S),,/g, "~$1~")
		.replace(/\\\\/g, "  \n");

	return keep.restore(out);
}

function convertTable(lines: string[]): string {
	const rows = lines.map((line) => {
		const keep = new Placeholders();
		// Separators inside links, macros and escapes are not cell boundaries.
		let masked = replaceLinks(line.trim(), (inner) => keep.add(`[[${inner}]]`));
		// Whole macro calls, content included, so pipes inside them do not split the cell.
		for (let at = masked.indexOf("{{"); at >= 0; at = masked.indexOf("{{", at + 1)) {
			const call = readMacro(masked, at);
			if (call) masked = masked.slice(0, at) + keep.add(masked.slice(at, call.end)) + masked.slice(call.end);
		}
		masked = masked.replace(/~\|/g, (part) => keep.add(part)).replace(/^!=/, "|=");
		// A closing "|" at the end of the row does not open another cell.
		const cells = masked.split("|").slice(1);
		if (cells.length > 1 && masked.endsWith("|") && !masked.endsWith("~|")) cells.pop();
		return cells
			.map((cell) => {
				const header = cell.startsWith("=");
				const content = inline(keep.restore(header ? cell.slice(1) : cell)).trim().replace(/\|/g, "\\|").replace(/\n/g, "<br>");
				return { header, content };
			});
	});
	const width = Math.max(...rows.map((row) => row.length));
	const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
	const headed = rows[0]?.every((cell) => cell.header) ?? false;
	const header = headed ? rows[0].map((cell) => cell.content) : [];
	const body = headed ? rows.slice(1) : rows;
	return [line(header), line(Array.from({ length: width }, () => "---")), ...body.map((row) => line(row.map((cell) => cell.content)))].join("\n");
}

/** Converts a whole page written in XWiki 2.x syntax into Markdown 1.2. */
export function xwiki21ToMarkdown(source: string): string {
	const src = source.replace(/\r\n?/g, "\n");
	const blocks: string[] = [];
	let paragraph: string[] = [];
	let pos = 0;

	const flush = () => {
		if (paragraph.length === 0) return;
		// A line break inside an XWiki paragraph is a real line break: keep it as a Markdown hard break.
		blocks.push(paragraph.map((line) => inline(line)).join("  \n"));
		paragraph = [];
	};
	const lineAt = (offset: number) => {
		const newline = src.indexOf("\n", offset);
		const end = newline < 0 ? src.length : newline;
		return { text: src.slice(offset, end), next: newline < 0 ? src.length : newline + 1 };
	};
	/** Collects the following lines that match `test`, starting with the current one. */
	const collect = (test: (line: string) => boolean): string[] => {
		const lines: string[] = [];
		while (pos < src.length) {
			const { text, next } = lineAt(pos);
			if (!test(text.trim())) break;
			lines.push(text.trim());
			pos = next;
		}
		return lines;
	};

	while (pos < src.length) {
		const { text, next } = lineAt(pos);
		const line = text.trim().replace(/^\(%[\s\S]*?%\)\s*/, "");

		if (!line || line === "(((" || line === ")))") {
			flush();
			pos = next;
			continue;
		}

		// Standalone verbatim block: {{{ … }}}
		if (line.startsWith("{{{")) {
			const start = pos + text.indexOf("{{{");
			const close = src.indexOf("}}}", start + 3);
			if (close >= 0 && !lineAt(close + 3).text.trim()) {
				flush();
				blocks.push(fence(src.slice(start + 3, close).replace(/^\n/, "")));
				pos = lineAt(close + 3).next;
				continue;
			}
		}

		// Standalone macro: copied as it is (code becomes a fenced block).
		if (line.startsWith("{{")) {
			const start = pos + text.indexOf("{{");
			const call = readMacro(src, start);
			if (call && !lineAt(call.end).text.trim()) {
				flush();
				blocks.push(renderMacro(call, src.slice(start, call.end)));
				pos = lineAt(call.end).next;
				continue;
			}
		}

		const heading = /^(={1,6})\s*(.*?)\s*=*$/.exec(line);
		if (heading && line.startsWith("=")) {
			flush();
			blocks.push(`${"#".repeat(heading[1].length)} ${inline(heading[2])}`);
			pos = next;
			continue;
		}

		if (/^-{4,}$/.test(line)) {
			flush();
			blocks.push("---");
			pos = next;
			continue;
		}

		const listItem = /^(\*+|1+\.)\s+/;
		if (listItem.test(line)) {
			flush();
			const items = collect((l) => listItem.test(l.replace(/^\(%[\s\S]*?%\)\s*/, "")));
			blocks.push(
				items
					.map((item) => {
						const clean = item.replace(/^\(%[\s\S]*?%\)\s*/, "");
						const marker = listItem.exec(clean)?.[1] ?? "*";
						const depth = marker.replace(".", "").length;
						const bullet = marker.endsWith(".") ? "1." : "-";
						return `${"   ".repeat(depth - 1)}${bullet} ${inline(clean.slice(marker.length).trim())}`;
					})
					.join("\n"),
			);
			continue;
		}

		if (line.startsWith("|") || line.startsWith("!=")) {
			flush();
			blocks.push(convertTable(collect((l) => l.startsWith("|") || l.startsWith("!="))));
			continue;
		}

		if (line.startsWith(">")) {
			flush();
			blocks.push(
				collect((l) => l.startsWith(">"))
					.map((quoted) => {
						const depth = /^>+/.exec(quoted)?.[0].length ?? 1;
						return `${"> ".repeat(depth)}${inline(quoted.slice(depth).trim())}`;
					})
					.join("\n"),
			);
			continue;
		}

		const term = /^;\s*(.*)$/.exec(line);
		if (term) {
			flush();
			blocks.push(`**${inline(term[1])}**`);
			pos = next;
			continue;
		}
		const definition = /^:\s*(.*)$/.exec(line);
		paragraph.push(definition ? definition[1] : line);
		pos = next;
	}
	flush();
	return blocks.join("\n\n").trim() + "\n";
}

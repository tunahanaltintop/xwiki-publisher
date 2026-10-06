/** Pulls every `name/version` string out of the /rest/syntaxes JSON, whatever its exact shape. */
export function collectSyntaxIds(json: unknown): string[] {
	const found = new Set<string>();
	const visit = (value: unknown): void => {
		if (typeof value === "string") {
			if (/^[a-z][\w+.-]*\/\d+(\.\d+)*$/i.test(value)) found.add(value);
		} else if (Array.isArray(value)) {
			value.forEach(visit);
		} else if (value && typeof value === "object") {
			Object.values(value).forEach(visit);
		}
	};
	visit(json);
	return [...found];
}

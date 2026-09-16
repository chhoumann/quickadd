import { extractScriptFromMarkdown } from "./extractScriptFromMarkdown";

const MARKDOWN_FILE_EXTENSION_REGEX = /\.md$/i;

export type UserScriptSecretOptionDetection = {
	names: Set<string>;
	foundSecretOptions: boolean;
};

function skipWhitespaceAndComments(source: string, index: number): number {
	let current = index;
	while (current < source.length) {
		const char = source[current];
		const next = source[current + 1];

		if (/\s/.test(char)) {
			current += 1;
			continue;
		}

		if (char === "/" && next === "/") {
			const newline = source.indexOf("\n", current + 2);
			current = newline === -1 ? source.length : newline + 1;
			continue;
		}

		if (char === "/" && next === "*") {
			const end = source.indexOf("*/", current + 2);
			current = end === -1 ? source.length : end + 2;
			continue;
		}

		return current;
	}

	return current;
}

function readStringLiteral(
	source: string,
	index: number,
): { value: string; end: number } | null {
	const quote = source[index];
	if (quote !== "\"" && quote !== "'" && quote !== "`") return null;

	let value = "";
	for (let current = index + 1; current < source.length; current++) {
		const char = source[current];

		if (char === "\\") {
			const escaped = source[current + 1];
			if (escaped === undefined) return null;
			value += escaped;
			current += 1;
			continue;
		}

		if (char === quote) {
			return { value, end: current + 1 };
		}

		value += char;
	}

	return null;
}

function readIdentifier(
	source: string,
	index: number,
): { value: string; end: number } | null {
	const match = /^[A-Za-z_$][\w$]*/.exec(source.slice(index));
	if (!match) return null;

	return {
		value: match[0],
		end: index + match[0].length,
	};
}

function findMatchingDelimiter(
	source: string,
	openIndex: number,
	open: "{" | "[",
	close: "}" | "]",
): number {
	let depth = 0;

	for (let current = openIndex; current < source.length; current++) {
		const char = source[current];
		const next = source[current + 1];

		if (char === "\"" || char === "'" || char === "`") {
			const literal = readStringLiteral(source, current);
			if (!literal) return -1;
			current = literal.end - 1;
			continue;
		}

		if (char === "/" && next === "/") {
			const newline = source.indexOf("\n", current + 2);
			current = newline === -1 ? source.length : newline;
			continue;
		}

		if (char === "/" && next === "*") {
			const end = source.indexOf("*/", current + 2);
			if (end === -1) return -1;
			current = end + 1;
			continue;
		}

		if (char === open) {
			depth += 1;
			continue;
		}

		if (char === close) {
			depth -= 1;
			if (depth === 0) return current;
		}
	}

	return -1;
}

function collectStringConstants(source: string): Map<string, string> {
	const constants = new Map<string, string>();
	const regex = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(["'`])/g;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(source)) !== null) {
		const literal = readStringLiteral(source, regex.lastIndex - 1);
		if (!literal) continue;
		constants.set(match[1], literal.value);
		regex.lastIndex = literal.end;
	}

	return constants;
}

function findOptionsObjectSpans(source: string): Array<{ start: number; end: number }> {
	const spans: Array<{ start: number; end: number }> = [];
	const constants = collectStringConstants(source);
	let current = 0;

	while (current < source.length) {
		current = skipWhitespaceAndComments(source, current);
		const char = source[current];

		if (char === "\"" || char === "'" || char === "`") {
			const literal = readStringLiteral(source, current);
			current = literal ? literal.end : current + 1;
			continue;
		}

		const key = readOptionKey(source, current, constants);
		if (!key) {
			current += 1;
			continue;
		}

		current = skipWhitespaceAndComments(source, key.end);
		if (source[current] !== ":") {
			current = key.end;
			continue;
		}

		current = skipWhitespaceAndComments(source, current + 1);
		if (key.name !== "options") continue;
		if (source[current] !== "{") continue;

		const end = findMatchingDelimiter(source, current, "{", "}");
		if (end === -1) break;
		spans.push({ start: current + 1, end });
		current = end + 1;
	}

	return spans;
}

function readOptionKey(
	source: string,
	index: number,
	constants: ReadonlyMap<string, string>,
): { name: string | null; end: number } | null {
	if (source[index] === "\"" || source[index] === "'" || source[index] === "`") {
		const literal = readStringLiteral(source, index);
		if (!literal) return null;
		return { name: literal.value, end: literal.end };
	}

	if (source[index] === "[") {
		const current = skipWhitespaceAndComments(source, index + 1);
		const identifier = readIdentifier(source, current);
		const end = findMatchingDelimiter(source, index, "[", "]");
		if (end === -1) return null;
		const afterIdentifier = identifier
			? skipWhitespaceAndComments(source, identifier.end)
			: current;

		return {
			name:
				identifier && afterIdentifier === end
					? (constants.get(identifier.value) ?? null)
					: null,
			end: end + 1,
		};
	}

	const identifier = readIdentifier(source, index);
	if (!identifier) return null;

	return {
		name: identifier.value,
		end: identifier.end,
	};
}

function readTopLevelObjectProperties(source: string): Map<string, unknown> {
	const properties = new Map<string, unknown>();
	let current = 0;

	while (current < source.length) {
		current = skipWhitespaceAndComments(source, current);
		if (source[current] === ",") {
			current += 1;
			continue;
		}
		if (current >= source.length) break;

		const key = readOptionKey(source, current, new Map());
		if (!key?.name) {
			current += 1;
			continue;
		}

		current = skipWhitespaceAndComments(source, key.end);
		if (source[current] !== ":") {
			current += 1;
			continue;
		}

		current = skipWhitespaceAndComments(source, current + 1);
		if (
			source[current] === "\"" ||
			source[current] === "'" ||
			source[current] === "`"
		) {
			const literal = readStringLiteral(source, current);
			if (!literal) break;
			properties.set(key.name, literal.value);
			current = literal.end;
			continue;
		}

		if (source.slice(current, current + 4) === "true") {
			properties.set(key.name, true);
			current += 4;
			continue;
		}

		if (source.slice(current, current + 5) === "false") {
			properties.set(key.name, false);
			current += 5;
			continue;
		}

		const open = source[current];
		if (open === "{" || open === "[") {
			const end = findMatchingDelimiter(source, current, open, open === "{" ? "}" : "]");
			if (end === -1) break;
			current = end + 1;
			continue;
		}

		while (current < source.length && source[current] !== ",") {
			current += 1;
		}
	}

	return properties;
}

function optionBodyDeclaresSecret(body: string): boolean {
	const properties = readTopLevelObjectProperties(body);
	const type = properties.get("type");
	const secret = properties.get("secret");

	return type === "secret" || ((type === "text" || type === "input") && secret === true);
}

export function detectUserScriptSecretOptions(
	source: string,
	path?: string,
): UserScriptSecretOptionDetection {
	const sourceToInspect =
		path && MARKDOWN_FILE_EXTENSION_REGEX.test(path)
			? (extractScriptFromMarkdown(source).code ?? "")
			: source;
	const names = new Set<string>();
	let foundSecretOptions = false;
	const constants = collectStringConstants(sourceToInspect);

	for (const { start, end } of findOptionsObjectSpans(sourceToInspect)) {
		let current = start;

		while (current < end) {
			current = skipWhitespaceAndComments(sourceToInspect, current);
			if (sourceToInspect[current] === ",") {
				current += 1;
				continue;
			}
			if (current >= end) break;

			const key = readOptionKey(sourceToInspect, current, constants);
			if (!key) {
				current += 1;
				continue;
			}

			current = skipWhitespaceAndComments(sourceToInspect, key.end);
			if (sourceToInspect[current] !== ":") {
				current += 1;
				continue;
			}

			current = skipWhitespaceAndComments(sourceToInspect, current + 1);
			if (sourceToInspect[current] !== "{") {
				current += 1;
				continue;
			}

			const valueEnd = findMatchingDelimiter(
				sourceToInspect,
				current,
				"{",
				"}",
			);
			if (valueEnd === -1 || valueEnd > end) break;

			const body = sourceToInspect.slice(current + 1, valueEnd);
			if (optionBodyDeclaresSecret(body)) {
				foundSecretOptions = true;
				if (key.name) names.add(key.name);
			}

			current = valueEnd + 1;
		}
	}

	return { names, foundSecretOptions };
}


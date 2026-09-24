import { quoteYamlDouble } from "./yamlScalarQuoting";
import type { WarnSink } from "./warnSink";

export type MultiValueFormat = "auto" | "inline" | "spaced" | "yaml" | "markdown";

const MULTI_VALUE_FORMATS = new Set<MultiValueFormat>([
	"auto",
	"inline",
	"spaced",
	"yaml",
	"markdown",
]);

export function parseMultiValueFormat(
	raw: string,
	tokenDisplay: string,
	warn?: WarnSink,
): MultiValueFormat | undefined {
	const normalized = raw.trim().toLowerCase();
	if (MULTI_VALUE_FORMATS.has(normalized as MultiValueFormat)) {
		return normalized as MultiValueFormat;
	}

	warn?.(
		`QuickAdd: Unsupported multi-select format "${raw}" in "${tokenDisplay}". Supported formats: auto, inline, spaced, yaml, markdown.`,
	);
	return undefined;
}

function currentLineIndent(input: string, matchStart: number): string {
	const lineStart = input.lastIndexOf("\n", matchStart - 1) + 1;
	return input.slice(lineStart, matchStart).match(/^\s*/)?.[0] ?? "";
}

/**
 * Whether a list property Capture writes this token's list as one item per pick:
 * a list-shaped format (inline and spaced ask for one joined item) on a line of its own.
 */
export function writesPicksAsItems(args: {
	input: string;
	matchStart: number;
	matchEnd: number;
	format?: MultiValueFormat;
}): boolean {
	if (args.format === "inline" || args.format === "spaced") return false;
	const lineStart = args.input.lastIndexOf("\n", args.matchStart - 1) + 1;
	const lineEnd = args.input.indexOf("\n", args.matchEnd);
	return args.input.slice(lineStart, args.matchStart).trim() === ""
		&& args.input.slice(args.matchEnd, lineEnd === -1 ? undefined : lineEnd).trim() === "";
}

function renderMarkdownItem(value: string): string {
	return `- ${value.replace(/\r\n?|\n/g, "\n  ")}`;
}

/**
 * Renders an explicitly requested multi-select output shape. `undefined` means
 * the caller should retain the legacy context-sensitive `auto` behavior.
 */
export function renderExplicitMultiValue(args: {
	input: string;
	matchStart: number;
	values: readonly unknown[];
	format: MultiValueFormat;
}): string | undefined {
	const { input, matchStart, values, format } = args;
	const strings = values.map((value) => String(value));

	switch (format) {
		case "auto":
			return undefined;
		case "inline":
			return strings.join(",");
		case "spaced":
			return strings.join(", ");
		case "yaml":
			return `[${strings.map(quoteYamlDouble).join(", ")}]`;
		case "markdown": {
			if (strings.length === 0) return "";
			const indent = currentLineIndent(input, matchStart);
			return strings.map(renderMarkdownItem).join(`\n${indent}`);
		}
		default: {
			const _exhaustive: never = format;
			return _exhaustive;
		}
	}
}

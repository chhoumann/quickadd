import { quoteYamlDouble } from "./yamlScalarQuoting";
import type { WarnSink } from "./warnSink";

export type MultiValueFormat = "auto" | "inline" | "yaml" | "markdown";

const MULTI_VALUE_FORMATS = new Set<MultiValueFormat>([
	"auto",
	"inline",
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
		`QuickAdd: Unsupported multi-select format "${raw}" in "${tokenDisplay}". Supported formats: auto, inline, yaml, markdown.`,
	);
	return undefined;
}

function currentLineIndent(input: string, matchStart: number): string {
	const lineStart = input.lastIndexOf("\n", matchStart - 1) + 1;
	return input.slice(lineStart, matchStart).match(/^\s*/)?.[0] ?? "";
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
	if (format === "auto") return undefined;

	const strings = values.map((value) => String(value));
	if (format === "inline") return strings.join(",");
	if (format === "yaml") {
		return `[${strings.map(quoteYamlDouble).join(", ")}]`;
	}

	if (strings.length === 0) return "";
	const indent = currentLineIndent(input, matchStart);
	return strings.map(renderMarkdownItem).join(`\n${indent}`);
}

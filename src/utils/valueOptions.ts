import { extractBareFlagPart, parseBooleanFlag, parsePipeKeyValue } from "./pipeSyntax";
import { parseMultiValueFormat, type MultiValueFormat } from "./multiValueFormat";
import type { MultiEmit } from "./valueSyntax";
import type { WarnSink } from "./warnSink";

const NUMERIC_RANGE_OPTION_KEYS = new Set(["min", "max", "step"]);

const VALUE_OPTION_KEYS = new Set([
	"label",
	"default",
	"custom",
	"type",
	"case",
	"text",
	"optional",
	"trim",
	"multi",
	"format",
]);

// `name` is recognized ONLY on the named `{{VALUE:...}}` grammar, never on the
// anonymous `{{VALUE|...}}` grammar (which shares parseOptions). Gating it here
// keeps `{{VALUE|name:x}}` parsing its old "name:x" default unchanged.
const NAMED_VALUE_OPTION_KEYS = new Set([...VALUE_OPTION_KEYS, "name"]);

export type ParsedOptions = {
	label?: string;
	caseStyle?: string;
	defaultValue: string;
	allowCustomInput: boolean;
	usesOptions: boolean;
	inputTypeOverride?: string;
	minRaw?: string;
	maxRaw?: string;
	stepRaw?: string;
	displayValuesRaw?: string;
	optionalExplicit?: boolean;
	trimExplicit?: boolean;
	name?: string;
	multiSelect?: boolean;
	multiEmit?: MultiEmit;
	multiFormat?: MultiValueFormat;
};

export function extractBareValueFlags(parts: string[]): {
	remaining: string[];
	optional: boolean;
	trim: boolean;
} {
	const { remaining: withoutOptional, found: optional } =
		extractBareFlagPart(parts, "optional");
	const { remaining, found: trim } = extractBareFlagPart(
		withoutOptional,
		"trim",
	);
	return { remaining, optional, trim };
}

export function parseOptions(
	optionParts: string[],
	hasOptions: boolean,
	allowName: boolean,
	tokenDisplay: string,
	warn: WarnSink,
): ParsedOptions {
	const parts = optionParts.map((part) => {
		const raw = part.trim();
		return { raw, option: parsePipeKeyValue(raw) };
	});
	const optionKeys = allowName ? NAMED_VALUE_OPTION_KEYS : VALUE_OPTION_KEYS;
	const allowNumericOptions = parts.some(({ option }) =>
		option?.key === "type" && ["number", "slider"].includes(option.value.toLowerCase()),
	);
	const recognizes = (key: string) => optionKeys.has(key) ||
		(allowNumericOptions && NUMERIC_RANGE_OPTION_KEYS.has(key));
	const usesOptions = parts.some(({ raw, option }) =>
		(option && recognizes(option.key)) ||
		(hasOptions && ["custom", "multi"].includes(raw.toLowerCase())),
	);

	if (!usesOptions) {
		return {
			defaultValue: optionParts.join("|").trim(),
			allowCustomInput: false,
			usesOptions: false,
		};
	}

	const options: ParsedOptions = {
		defaultValue: "",
		allowCustomInput: false,
		usesOptions: true,
		multiSelect: false,
	};

	for (const { raw, option } of parts) {

		if (hasOptions && raw.toLowerCase() === "custom") {
			options.allowCustomInput = true;
			continue;
		}

		if (hasOptions && raw.toLowerCase() === "multi") {
			options.multiSelect = true;
			continue;
		}

		if (!option || !recognizes(option.key)) continue;
		const { key, value } = option;

		switch (key) {
			case "label":
				if (value) options.label = value;
				break;
			case "case":
				if (value) options.caseStyle = value;
				break;
			case "default":
				options.defaultValue = value;
				break;
			case "custom":
				options.allowCustomInput = parseBooleanFlag(value);
				break;
			case "type":
				if (value) options.inputTypeOverride = value;
				break;
			case "min":
				options.minRaw = value;
				break;
			case "max":
				options.maxRaw = value;
				break;
			case "step":
				options.stepRaw = value;
				break;
			case "text":
				options.displayValuesRaw = value;
				break;
			case "optional":
				options.optionalExplicit = parseBooleanFlag(value);
				break;
			case "trim":
				options.trimExplicit = parseBooleanFlag(value);
				break;
			case "multi":
				options.multiSelect = true;
				options.multiEmit =
					value.trim().toLowerCase() === "linklist" ? "linklist" : "text";
				break;
			case "format":
				options.multiFormat = parseMultiValueFormat(value, tokenDisplay, warn);
				break;
			case "name":
				if (value) options.name = value;
				else
					warn(
						`QuickAdd: empty |name: ignored in "${tokenDisplay}"; provide a variable name, e.g. {{VALUE:a,b|name:category}}.`,
					);
				break;
			default:
				break;
		}
	}

	return options;
}

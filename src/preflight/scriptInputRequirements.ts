import type { FieldType, FieldRequirement } from "./fieldRequirements";
import type { NumericInputConfig, ParsedOptions, SliderConfig } from "src/utils/valueSyntaxTypes";
import { resolveNumericInput } from "src/utils/valueNumeric";
import { SILENT_WARN } from "src/utils/warnSink";
import { hasNonStringOptions } from "src/api/requestInputOptions";

const VALID_FIELD_TYPES: FieldType[] = [
	"text",
	"number",
	"textarea",
	"dropdown",
	"slider",
	"date",
	"field-suggest",
	"file-picker",
	"suggester",
];

function isFieldType(value: unknown): value is FieldType {
	return (
		typeof value === "string" &&
		VALID_FIELD_TYPES.includes(value as FieldType)
	);
}

export function toFieldRequirement(input: unknown): FieldRequirement | null {
	if (!input || typeof input !== "object") return null;

	const value = input as Record<string, unknown>;
	const id = value.id;
	const type = value.type;
	if (typeof id !== "string" || !isFieldType(type)) return null;
	const numericConfig = parseNumericConfig(value.numericConfig);
	const sliderConfig = parseSliderConfig(value.sliderConfig);
	const fieldType = type === "slider" && !sliderConfig ? "number" : type;
	const options = Array.isArray(value.options) ? (value.options as unknown[]) : undefined;
	const runtimeOnly = hasNonStringOptions(options);
	const stringOptions = runtimeOnly ? undefined : (options as string[] | undefined);
	const defaultValue = value.defaultValue;
	const suggesterConfig = parseSuggesterConfig(value.suggesterConfig);
	const renderItem = (value.suggesterConfig as { renderItem?: unknown } | undefined)?.renderItem;

	return {
		id,
		label: typeof value.label === "string" ? value.label : id,
		type: fieldType,
		placeholder:
			typeof value.placeholder === "string" ? value.placeholder : undefined,
		defaultValue: typeof defaultValue === "string" ? defaultValue : undefined,
		defaultValues: Array.isArray(defaultValue)
			? defaultValue.filter((entry): entry is string => typeof entry === "string")
			: undefined,
		numericConfig: sliderConfig ?? numericConfig,
		sliderConfig,
		options: stringOptions,
		displayOptions: stringOptions && parseDisplayOptions(value.displayOptions, stringOptions),
		suggesterConfig,
		renderOption: !runtimeOnly && typeof renderItem === "function"
			? (option, el) => (renderItem as (value: string, el: HTMLElement) => void)(option, el)
			: undefined,
		runtimeOnly: runtimeOnly ? true : undefined,
		dateFormat:
			typeof value.dateFormat === "string" ? value.dateFormat : undefined,
		description:
			typeof value.description === "string" ? value.description : undefined,
		optional: typeof value.optional === "boolean" ? value.optional : undefined,
		source: "script",
	};
}

/**
 * A script's numeric settings as the raw options a {{VALUE}} token carries, so
 * both are validated by one rule. A value that is not a number is not a valid
 * one, except a missing slider step, which defaults to 1.
 */
function numericOptions(value: unknown): ParsedOptions {
	const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
	const asRaw = (entry: unknown) => typeof entry === "number" ? String(entry) : undefined;
	return {
		defaultValue: "",
		allowCustomInput: false,
		usesOptions: false,
		minRaw: asRaw(raw.min),
		maxRaw: asRaw(raw.max),
		stepRaw: raw.step === undefined ? undefined : asRaw(raw.step) ?? "",
	};
}

function parseDisplayOptions(value: unknown, options: string[]): string[] | undefined {
	if (typeof value === "function") {
		return options.map((option, index) => String(value(option, index, options)));
	}
	return Array.isArray(value)
		? options.map((option, index) => (typeof value[index] === "string" ? value[index] : option))
		: undefined;
}

function parseSuggesterConfig(value: unknown): FieldRequirement["suggesterConfig"] {
	if (!value || typeof value !== "object") return undefined;
	const raw = value as Record<string, unknown>;
	const flag = (key: string) => (typeof raw[key] === "boolean" ? raw[key] : undefined);
	return {
		allowCustomInput: flag("allowCustomInput"),
		caseSensitive: flag("caseSensitive"),
		multiSelect: flag("multiSelect"),
		returnArray: flag("returnArray"),
		separator: typeof raw.separator === "string" ? raw.separator : undefined,
	};
}

function parseNumericConfig(value: unknown): NumericInputConfig | undefined {
	return resolveNumericInput(numericOptions(value), "", "number", SILENT_WARN).numericConfig;
}

function parseSliderConfig(value: unknown): SliderConfig | undefined {
	return resolveNumericInput(numericOptions(value), "", "slider", SILENT_WARN).sliderConfig;
}

export function getQuickAddScriptInputs(value: unknown): unknown[] {
	if (!value || (typeof value !== "object" && typeof value !== "function")) return [];
	const quickadd = (value as { quickadd?: unknown }).quickadd;
	if (!quickadd || typeof quickadd !== "object") return [];
	const inputs = (quickadd as { inputs?: unknown }).inputs;
	return Array.isArray(inputs) ? inputs : [];
}

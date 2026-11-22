import type { FieldType, FieldRequirement } from "./fieldRequirements";
import type { NumericInputConfig, ParsedOptions, SliderConfig } from "src/utils/valueSyntaxTypes";
import { resolveNumericInput } from "src/utils/valueNumeric";
import { SILENT_WARN } from "src/utils/warnSink";

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

	return {
		id,
		label: typeof value.label === "string" ? value.label : id,
		type: fieldType,
		placeholder:
			typeof value.placeholder === "string" ? value.placeholder : undefined,
		defaultValue:
			typeof value.defaultValue === "string" ? value.defaultValue : undefined,
		numericConfig: sliderConfig ?? numericConfig,
		sliderConfig,
		options: Array.isArray(value.options)
			? value.options.filter((entry): entry is string => typeof entry === "string")
			: undefined,
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

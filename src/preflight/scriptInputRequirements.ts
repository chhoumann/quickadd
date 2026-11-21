import type { FieldType, FieldRequirement } from "./fieldRequirements";
import type { NumericInputConfig, SliderConfig } from "src/utils/valueSyntax";
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
	const stringOptions = options?.filter((entry): entry is string => typeof entry === "string");
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
		renderOption: typeof renderItem === "function"
			? (option, el) => (renderItem as (value: string, el: HTMLElement) => void)(option, el)
			: undefined,
		runtimeOnly: hasNonStringOptions(options) ? true : undefined,
		dateFormat:
			typeof value.dateFormat === "string" ? value.dateFormat : undefined,
		description:
			typeof value.description === "string" ? value.description : undefined,
		optional: typeof value.optional === "boolean" ? value.optional : undefined,
		source: "script",
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
	if (!value || typeof value !== "object") return undefined;
	const raw = value as Record<string, unknown>;
	const min = typeof raw.min === "number" && Number.isFinite(raw.min)
		? raw.min
		: undefined;
	const max = typeof raw.max === "number" && Number.isFinite(raw.max)
		? raw.max
		: undefined;
	const step = typeof raw.step === "number" && Number.isFinite(raw.step) && raw.step > 0
		? raw.step
		: undefined;
	if (min !== undefined && max !== undefined && max < min) {
		return step === undefined ? undefined : { step };
	}
	const config: NumericInputConfig = {};
	if (min !== undefined) config.min = min;
	if (max !== undefined) config.max = max;
	if (step !== undefined) config.step = step;
	return Object.keys(config).length > 0 ? config : undefined;
}

function parseSliderConfig(value: unknown): SliderConfig | undefined {
	if (!value || typeof value !== "object") return undefined;
	const raw = value as Record<string, unknown>;
	const min = typeof raw.min === "number" ? raw.min : undefined;
	const max = typeof raw.max === "number" ? raw.max : undefined;
	const step = raw.step === undefined
		? 1
		: typeof raw.step === "number"
			? raw.step
			: undefined;
	if (
		min === undefined ||
		max === undefined ||
		step === undefined ||
		!Number.isFinite(min) ||
		!Number.isFinite(max) ||
		!Number.isFinite(step) ||
		max <= min ||
		step <= 0
	) {
		return undefined;
	}
	return { min, max, step };
}


export function getQuickAddScriptInputs(value: unknown): unknown[] {
	if (!value || (typeof value !== "object" && typeof value !== "function")) return [];
	const quickadd = (value as { quickadd?: unknown }).quickadd;
	if (!quickadd || typeof quickadd !== "object") return [];
	const inputs = (quickadd as { inputs?: unknown }).inputs;
	return Array.isArray(inputs) ? inputs : [];
}

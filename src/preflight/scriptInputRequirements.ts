import type { FieldType, FieldRequirement } from "./fieldRequirements";
import type { NumericInputConfig, SliderConfig } from "src/utils/valueSyntax";

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

export function getQuickAddScriptInputs(userScript: unknown): unknown[] {
	const readInputs = (value: unknown): unknown[] => {
		if (
			!value ||
			(typeof value !== "object" && typeof value !== "function")
		) {
			return [];
		}
		const quickadd = (value as { quickadd?: unknown }).quickadd;
		if (!quickadd || typeof quickadd !== "object") return [];
		const inputs = (quickadd as { inputs?: unknown }).inputs;
		return Array.isArray(inputs) ? inputs : [];
	};

	return readInputs(userScript);
}


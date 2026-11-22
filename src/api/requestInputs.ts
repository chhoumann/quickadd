import type { App } from "obsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type { FieldRequirement } from "../preflight/RequirementCollector";
import { OnePageInputModal } from "../preflight/OnePageInputModal";
import type { NumericInputConfig, SliderConfig } from "../utils/valueSyntaxTypes";
import { formatISODate } from "../utils/dateParser";
import { decodeDateToken } from "../utils/dateTokenCodec";
import { routePrompt, scriptPromptHeadless } from "../interactive/routePrompt";

function sanitizeNumericConfig(
	value: NumericInputConfig | undefined,
): NumericInputConfig | undefined {
	if (!value || typeof value !== "object") return undefined;
	const config: NumericInputConfig = {};
	if (typeof value.min === "number" && Number.isFinite(value.min)) {
		config.min = value.min;
	}
	if (typeof value.max === "number" && Number.isFinite(value.max)) {
		config.max = value.max;
	}
	if (
		config.min !== undefined &&
		config.max !== undefined &&
		config.max < config.min
	) {
		delete config.min;
		delete config.max;
	}
	if (
		typeof value.step === "number" &&
		Number.isFinite(value.step) &&
		value.step > 0
	) {
		config.step = value.step;
	}
	return Object.keys(config).length > 0 ? config : undefined;
}

type RequestSliderConfig = {
	min: number;
	max: number;
	step?: number;
};

function sanitizeSliderConfig(
	value: RequestSliderConfig | undefined,
): SliderConfig | undefined {
	if (!value || typeof value !== "object") return undefined;
	const { min, max } = value;
	const step = value.step ?? 1;
	if (
		typeof min !== "number" ||
		typeof max !== "number" ||
		typeof step !== "number" ||
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

export async function requestInputs(app: App, choiceExecutor: IChoiceExecutor, inputs: Array<{
	id: string;
	label?: string;
	type:
	| "text"
	| "number"
	| "textarea"
	| "dropdown"
	| "date"
	| "field-suggest"
	| "suggester"
	| "slider";
	placeholder?: string;
	defaultValue?: string;
	numericConfig?: NumericInputConfig;
	sliderConfig?: RequestSliderConfig;
	options?: string[];
	dateFormat?: string;
	description?: string;
	optional?: boolean;
	suggesterConfig?: {
		allowCustomInput?: boolean;
		caseSensitive?: boolean;
		multiSelect?: boolean;
	};
}>): Promise<Record<string, string>> {
	// If all inputs already have values, return them immediately
	const existing: Record<string, string> = {};
	const missing: FieldRequirement[] = [];
	for (const spec of inputs) {
		const val = choiceExecutor.variables.get(spec.id) as
			| string
			| undefined;
		// Empty string is considered intentional and should not be re-asked
		if (val !== undefined && val !== null) {
			existing[spec.id] = String(val);
			continue;
		}
		const sliderConfig = sanitizeSliderConfig(spec.sliderConfig);
		const numericConfig =
			sliderConfig ?? sanitizeNumericConfig(spec.numericConfig);
		const type =
			spec.type === "slider" && !sliderConfig ? "number" : spec.type;

		missing.push({
			id: spec.id,
			label: spec.label ?? spec.id,
			type,
			placeholder: spec.placeholder,
			defaultValue: spec.defaultValue,
			numericConfig,
			sliderConfig,
			options: spec.options,
			dateFormat: spec.dateFormat,
			description: spec.description,
			optional: spec.optional,
			suggesterConfig: spec.suggesterConfig,
			source: "script",
		});
	}

	let collected: Record<string, string> = {};
	if (missing.length > 0) {
		collected = await routePrompt(choiceExecutor, {
			// A remote interactive session (Raycast) answers the batch form.
			remote: async (provider) =>
				Object.fromEntries(
					Object.entries(await provider.requestInputs(missing)).map(([key, value]) => [
						key,
						Array.isArray(value) ? value.join(", ") : value,
					]),
				),
			headless: scriptPromptHeadless(
				"an input form",
				missing.map((input) => input.label).join(", "),
				`Pass ${missing.map((input) => input.id).join(", ")} in vars, or re-run with the ui flag.`,
			),
			app: () =>
				new OnePageInputModal(app, missing, choiceExecutor.variables).waitForClose,
		});
	}

	// A multi-select field leaves ", " after the last pick, ready for the next
	// one. That separator is not part of the answer.
	for (const spec of inputs) {
		const value = collected[spec.id];
		if (spec.type === "suggester" && spec.suggesterConfig?.multiSelect && typeof value === "string") {
			collected[spec.id] = value.replace(/,\s*$/, "");
		}
	}

	const rawResult = { ...existing, ...collected };

	// The modal omits blank/unparseable date keys so the preflight
	// flow can re-prompt sequentially. Scripts have no such
	// fallback - keep the requestInputs contract that every
	// requested id resolves (empty answer = "").
	for (const spec of inputs) {
		if (rawResult[spec.id] === undefined) rawResult[spec.id] = "";
	}

	// Store raw values (including @date:ISO) for downstream processors
	Object.entries(rawResult).forEach(([k, v]) =>
		choiceExecutor.variables.set(k, v),
	);

	// Return user-friendly values that honor dateFormat when provided
	const formattedResult: Record<string, string> = {};
	for (const spec of inputs) {
		const value = rawResult[spec.id];
		let output = value;
		const iso = spec.type === "date" && spec.dateFormat ? decodeDateToken(value) : null;
		if (iso !== null && spec.dateFormat) {
			const formatted = formatISODate(iso, spec.dateFormat);
			if (formatted) output = formatted;
		}

		formattedResult[spec.id] = output;
	}

	return formattedResult;
}

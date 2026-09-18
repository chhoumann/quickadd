import type { App } from "obsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type { FieldRequirement } from "../preflight/RequirementCollector";
import { OnePageInputModal } from "../preflight/OnePageInputModal";
import type { NumericInputConfig, SliderConfig } from "../utils/valueSyntax";
import { formatISODate } from "../utils/dateParser";
import { rethrowPromptError } from "./promptApi";

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
		// Route the batch form to a remote interactive session (Raycast)
		// when one is driving this run; otherwise open the Obsidian modal.
		const provider = choiceExecutor?.promptProvider;
		if (provider) {
			try {
				const providerAnswers = await provider.requestInputs(missing);
				collected = Object.fromEntries(
					Object.entries(providerAnswers).map(([key, value]) => [
						key,
						Array.isArray(value) ? value.join(", ") : value,
					]),
				);
			} catch (error) {
				rethrowPromptError(error);
			}
		} else {
			const modal = new OnePageInputModal(
				app,
				missing,
				choiceExecutor.variables,
			);
			try {
				collected = await modal.waitForClose;
			} catch (error) {
				rethrowPromptError(error);
			}
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
		if (value === undefined) continue;

		let output = value;
		if (
			spec.type === "date" &&
			spec.dateFormat &&
			typeof value === "string" &&
			value.startsWith("@date:")
		) {
			const iso = value.slice(6);
			const formatted = formatISODate(iso, spec.dateFormat);
			if (formatted) output = formatted;
		}

		formattedResult[spec.id] = output;
	}

	return formattedResult;
}

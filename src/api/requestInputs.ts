import type { App } from "obsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type { FieldRequirement } from "../preflight/RequirementCollector";
import { OnePageInputModal } from "../preflight/OnePageInputModal";
import type { NumericInputConfig, SliderConfig } from "../utils/valueSyntax";
import { formatISODate } from "../utils/dateParser";
import { rethrowPromptError } from "./promptApi";
import { abortIfHeadless } from "../interactive/routePrompt";
import { type OnePageFormHeader, sanitizeOnePageFormHeader } from "../preflight/formHeader";
import type { FormAnswer } from "../interactive/promptProvider";
import {
	encodeRequestInputOptions,
	isMultiSelectSuggester,
	multiSelectSeparator,
	resolveExistingVariableValue,
	shouldReturnArray,
	type EncodedRequestInputOptions,
	type RequestInputSpec,
	type RequestSliderConfig,
	type StringRequestInputSpec,
} from "./requestInputOptions";

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

export type { RequestInputSpec };
export type RequestInputsOptions = OnePageFormHeader;

export interface RequestInputs {
	(inputs: readonly StringRequestInputSpec[], options?: RequestInputsOptions): Promise<Record<string, string>>;
	(inputs: readonly RequestInputSpec<any>[], options?: RequestInputsOptions): Promise<Record<string, unknown>>;
}

function toRequirement(spec: RequestInputSpec<unknown>, codec: EncodedRequestInputOptions): FieldRequirement {
	const sliderConfig = sanitizeSliderConfig(spec.sliderConfig);
	const config = spec.suggesterConfig;
	return {
		id: spec.id,
		label: spec.label ?? spec.id,
		type: spec.type === "slider" && !sliderConfig ? "number" : spec.type,
		placeholder: spec.placeholder,
		defaultValue: codec.defaultValue,
		defaultValues: codec.defaultValues,
		numericConfig: sliderConfig ?? sanitizeNumericConfig(spec.numericConfig),
		sliderConfig,
		options: codec.options,
		displayOptions: codec.displayOptions,
		renderOption: codec.renderOption,
		dateFormat: spec.dateFormat,
		description: spec.description,
		optional: spec.optional,
		suggesterConfig: config && {
			allowCustomInput: config.allowCustomInput,
			caseSensitive: config.caseSensitive,
			multiSelect: config.multiSelect,
			returnArray: config.returnArray,
			separator: config.separator,
		},
		source: "script",
	};
}

function decodeAnswer(
	spec: RequestInputSpec<unknown>,
	codec: EncodedRequestInputOptions,
	answer: FormAnswer | undefined,
): unknown {
	if (isMultiSelectSuggester(spec)) {
		const picks = typeof answer === "string" ? (answer ? [answer] : []) : (answer ?? []);
		return shouldReturnArray(spec)
			? picks.map(codec.decode)
			: picks.map(codec.text).join(multiSelectSeparator(spec));
	}
	if (answer === undefined) return "";
	if (Array.isArray(answer)) return answer.join(", ");
	return spec.type === "suggester" || spec.type === "dropdown" ? codec.decode(answer) : answer;
}

export function requestInputs(
	app: App,
	choiceExecutor: IChoiceExecutor,
	inputs: readonly StringRequestInputSpec[],
	options?: RequestInputsOptions,
): Promise<Record<string, string>>;
export function requestInputs(
	app: App,
	choiceExecutor: IChoiceExecutor,
	inputs: readonly RequestInputSpec<any>[],
	options?: RequestInputsOptions,
): Promise<Record<string, unknown>>;
export async function requestInputs(
	app: App,
	choiceExecutor: IChoiceExecutor,
	inputs: readonly RequestInputSpec<unknown>[],
	options?: RequestInputsOptions,
): Promise<Record<string, unknown>> {
	const rawResult: Record<string, unknown> = {};
	const codecs = new Map<string, EncodedRequestInputOptions>();
	const missing: FieldRequirement[] = [];
	for (const spec of inputs) {
		const val = choiceExecutor.variables.get(spec.id);
		if (val !== undefined && val !== null) {
			rawResult[spec.id] = resolveExistingVariableValue(spec, val);
			continue;
		}
		const codec = encodeRequestInputOptions(spec);
		codecs.set(spec.id, codec);
		missing.push(toRequirement(spec, codec));
	}

	let collected: Record<string, FormAnswer> = {};
	if (missing.length > 0) {
		const formHeader = sanitizeOnePageFormHeader(options);
		abortIfHeadless(
			choiceExecutor,
			"an input form",
			formHeader?.title ?? missing.map((input) => input.label).join(", "),
			`Pass ${missing.map((input) => input.id).join(", ")} in vars, or re-run with the ui flag.`,
		);
		// Route the batch form to a remote interactive session (Raycast)
		// when one is driving this run; otherwise open the Obsidian modal.
		const provider = choiceExecutor?.promptProvider;
		if (provider) {
			try {
				collected = await provider.requestInputs(missing, formHeader);
			} catch (error) {
				rethrowPromptError(error);
			}
		} else {
			const modal = new OnePageInputModal(
				app,
				missing,
				choiceExecutor.variables,
				formHeader,
			);
			try {
				collected = await modal.waitForClose;
			} catch (error) {
				rethrowPromptError(error);
			}
			for (const [id, picks] of modal.multiSelections) collected[id] = picks;
		}
	}

	for (const spec of inputs) {
		const codec = codecs.get(spec.id);
		if (codec) rawResult[spec.id] = decodeAnswer(spec, codec, collected[spec.id]);
	}

	// Store raw values (including @date:ISO) for downstream processors
	Object.entries(rawResult).forEach(([k, v]) =>
		choiceExecutor.variables.set(k, v),
	);

	// Return user-friendly values that honor dateFormat when provided
	const formattedResult: Record<string, unknown> = {};
	for (const spec of inputs) {
		const value = rawResult[spec.id];
		let output = value;
		if (
			spec.type === "date" &&
			spec.dateFormat &&
			typeof value === "string" &&
			value.startsWith("@date:")
		) {
			const formatted = formatISODate(value.slice(6), spec.dateFormat);
			if (formatted) output = formatted;
		}
		formattedResult[spec.id] = output;
	}

	return formattedResult;
}

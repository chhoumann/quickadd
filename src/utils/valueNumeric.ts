import type { NumericInputConfig, SliderConfig, ValueInputType } from "./valueSyntax";
import type { ParsedOptions } from "./valueOptions";
import { SILENT_WARN, type WarnSink } from "./warnSink";

function parseFiniteNumber(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	const parsed = Number(trimmed);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function hasNumericConfig(options: ParsedOptions): boolean {
	return (
		options.minRaw !== undefined ||
		options.maxRaw !== undefined ||
		options.stepRaw !== undefined
	);
}

function buildNumericConfig(
	options: ParsedOptions,
	tokenDisplay: string,
	warn: WarnSink,
): NumericInputConfig | undefined {
	const min = parseFiniteNumber(options.minRaw);
	const max = parseFiniteNumber(options.maxRaw);
	const step = parseFiniteNumber(options.stepRaw);
	const config: NumericInputConfig = {};

	for (const [key, raw, value] of [
		["min", options.minRaw, min],
		["max", options.maxRaw, max],
	] as const) {
		if (raw === undefined) continue;
		if (value === undefined) {
			warn(`QuickAdd: Ignoring invalid ${key} in VALUE token "${tokenDisplay}".`);
		} else {
			config[key] = value;
		}
	}

	if (
		config.min !== undefined &&
		config.max !== undefined &&
		config.max < config.min
	) {
		warn(
			`QuickAdd: Ignoring invalid numeric range in VALUE token "${tokenDisplay}"; max must be greater than or equal to min.`,
		);
		delete config.min;
		delete config.max;
	}

	if (options.stepRaw !== undefined) {
		if (step === undefined || step <= 0) {
			warn(
				`QuickAdd: Ignoring invalid step in VALUE token "${tokenDisplay}"; step must be greater than 0.`,
			);
		} else {
			config.step = step;
		}
	}

	return Object.keys(config).length > 0 ? config : undefined;
}

export function resolveNumericInput(
	options: ParsedOptions,
	tokenDisplay: string,
	inputTypeOverride: ValueInputType | undefined,
	warn: WarnSink,
): {
	inputTypeOverride?: ValueInputType;
	numericConfig?: NumericInputConfig;
	sliderConfig?: SliderConfig;
} {
	if (inputTypeOverride !== "number" && inputTypeOverride !== "slider") {
		if (hasNumericConfig(options)) {
			warn(
				`QuickAdd: Ignoring numeric range options in "${tokenDisplay}" because type is not number or slider.`,
			);
		}
		return { inputTypeOverride };
	}

	if (inputTypeOverride !== "slider") {
		const numericConfig = buildNumericConfig(options, tokenDisplay, warn);
		return { inputTypeOverride, numericConfig };
	}

	const min = parseFiniteNumber(options.minRaw);
	const max = parseFiniteNumber(options.maxRaw);
	const step = options.stepRaw === undefined
		? 1
		: parseFiniteNumber(options.stepRaw);
	const invalidReason =
		min === undefined || max === undefined
			? "slider requires finite min and max values"
			: max <= min
				? "max must be greater than min"
				: step === undefined || step <= 0
					? "step must be greater than 0"
					: undefined;

	if (invalidReason) {
		warn(
			`QuickAdd: Invalid slider configuration in "${tokenDisplay}" (${invalidReason}); falling back to type:number.`,
		);
		// Silent: the fallback re-parses the same min/max/step and would repeat
		// the complaint the slider message just made.
		const numericConfig = buildNumericConfig(options, tokenDisplay, SILENT_WARN);
		return { inputTypeOverride: "number", numericConfig };
	}

	const sliderConfig: SliderConfig = {
		min: min as number,
		max: max as number,
		step: step as number,
	};
	return {
		inputTypeOverride,
		numericConfig: sliderConfig,
		sliderConfig,
	};
}

function decimalPlaces(value: number): number {
	const asString = String(value);
	const exponentMatch = /e-(\d+)$/i.exec(asString);
	if (exponentMatch) return Number(exponentMatch[1]);
	const decimalIndex = asString.indexOf(".");
	return decimalIndex === -1 ? 0 : asString.length - decimalIndex - 1;
}

function formatRoundedNumber(value: number, precision: number): string {
	return String(Number(value.toFixed(precision)));
}

export function normalizeNumericValue(
	value: string | undefined,
	config?: NumericInputConfig,
): string {
	const trimmed = value?.trim() ?? "";
	if (!trimmed) return "";

	const parsed = Number(trimmed);
	if (!Number.isFinite(parsed)) return "";

	const min = config?.min;
	const max = config?.max;
	let normalized = parsed;
	if (min !== undefined) normalized = Math.max(min, normalized);
	if (max !== undefined) normalized = Math.min(max, normalized);

	if (config?.step !== undefined && config.step > 0) {
		const base = min ?? 0;
		const stepsFromBase = Math.round((normalized - base) / config.step);
		normalized = base + stepsFromBase * config.step;
		if (min !== undefined) normalized = Math.max(min, normalized);
		if (max !== undefined) normalized = Math.min(max, normalized);
		const precision = Math.max(
			decimalPlaces(base),
			decimalPlaces(config.step),
		);
		return formatRoundedNumber(normalized, precision);
	}

	return String(normalized);
}

export function normalizeSliderValue(
	value: string | undefined,
	config: SliderConfig,
): string {
	const normalized = normalizeNumericValue(value, config);
	return normalized || String(config.min);
}

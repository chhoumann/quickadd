import type { Model } from "./Provider";
import type { OpenAIModelParameters } from "./OpenAIModelParameters";

/**
 * Sampling parameters and automatic recovery when a model rejects them.
 *
 * Current frontier models reject sampling parameters outright with a 400
 * (verified live 2026-07-07): OpenAI reasoning models answer
 * `unsupported_parameter` / "Unsupported value: 'temperature'", and Anthropic's
 * current generation answers "`temperature` is deprecated for this model."
 * A settings slider must never turn into an opaque hard failure, so the
 * request layer (1) drops sampling params proactively when the model's
 * metadata says they are unsupported, and (2) retries once without them when a
 * provider rejects them anyway — telling the user what happened.
 */

export const SAMPLING_PARAM_KEYS = [
	"temperature",
	"top_p",
	"frequency_penalty",
	"presence_penalty",
] as const;

export type SamplingParamKey = (typeof SAMPLING_PARAM_KEYS)[number];

/** Human labels for notices — mirror the names shown in command settings. */
const PARAM_LABELS: Record<SamplingParamKey, string> = {
	temperature: "Temperature",
	top_p: "Top P",
	frequency_penalty: "Frequency Penalty",
	presence_penalty: "Presence Penalty",
};

export function sentSamplingParams(
	params: Partial<OpenAIModelParameters>,
): SamplingParamKey[] {
	return SAMPLING_PARAM_KEYS.filter(
		(key) => typeof params[key] === "number",
	);
}

/** New object with every sampling parameter removed; other keys untouched. */
export function stripSamplingParams(
	params: Partial<OpenAIModelParameters>,
): Partial<OpenAIModelParameters> {
	const stripped = { ...params };
	for (const key of SAMPLING_PARAM_KEYS) {
		delete stripped[key];
	}
	return stripped;
}

/**
 * Proactive drop: when the model's metadata says sampling parameters are
 * unsupported, remove them before the request is ever sent. Unknown metadata
 * (undefined) sends them and relies on the reactive retry instead.
 */
export function applySamplingSupport(
	model: Pick<Model, "supportsTemperature">,
	params: Partial<OpenAIModelParameters>,
): Partial<OpenAIModelParameters> {
	if (model.supportsTemperature === false && sentSamplingParams(params).length > 0) {
		return stripSamplingParams(params);
	}
	return params;
}

// Provider phrasings that identify a rejected SAMPLING parameter (as opposed
// to any other bad-request error). Matched against the collected error text:
//  - OpenAI:    "Unsupported parameter: 'temperature' is not supported ..."
//               "Unsupported value: 'temperature' does not support 0.7 ..."
//  - Anthropic: "`temperature` is deprecated for this model."
//  - OpenAI-compatible servers: "Unrecognized request argument supplied: top_p"
//  - Pydantic-style gateways:   "temperature: Extra inputs are not permitted"
const SAMPLING_KEY_PATTERN = SAMPLING_PARAM_KEYS.join("|");
const UNSUPPORTED_SAMPLING_PATTERNS: RegExp[] = [
	new RegExp(
		`unsupported (?:parameter|value)[^.]{0,40}['\`"]?(?:${SAMPLING_KEY_PATTERN})['\`"]?`,
		"i",
	),
	new RegExp(
		`['\`"]?(?:${SAMPLING_KEY_PATTERN})['\`"]?[^.]{0,40}(?:is deprecated|is not supported|not supported|does not support)`,
		"i",
	),
	new RegExp(
		`unrecognized request argument[^.]{0,40}(?:${SAMPLING_KEY_PATTERN})`,
		"i",
	),
	new RegExp(
		`(?:${SAMPLING_KEY_PATTERN})[^.]{0,40}extra inputs are not permitted`,
		"i",
	),
];

/**
 * True when the error text says the provider rejected one of the sampling
 * parameters we sent. `sentKeys` guards against false positives: a request
 * that sent no sampling params can't fail because of them.
 */
export function isUnsupportedSamplingParamError(
	errorText: string,
	sentKeys: readonly SamplingParamKey[],
): boolean {
	if (sentKeys.length === 0) return false;
	return UNSUPPORTED_SAMPLING_PATTERNS.some((pattern) =>
		pattern.test(errorText),
	);
}

/** "Temperature", "Temperature and Top P", "Temperature, Top P, and …". */
export function describeSamplingParams(
	keys: readonly SamplingParamKey[],
): string {
	const labels = keys.map((key) => PARAM_LABELS[key]);
	if (labels.length <= 1) return labels.join("");
	if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
	return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

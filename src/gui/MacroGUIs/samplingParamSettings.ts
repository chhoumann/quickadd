import { Setting } from "obsidian";
import {
	DEFAULT_FREQUENCY_PENALTY,
	DEFAULT_PRESENCE_PENALTY,
	DEFAULT_TEMPERATURE,
	DEFAULT_TOP_P,
	type OpenAIModelParameters,
} from "src/ai/OpenAIModelParameters";
import { resolveModel, type ModelInput } from "src/ai/aiHelpers";
import type { SamplingParamKey } from "src/ai/samplingParams";

interface SamplingSliderSpec {
	key: SamplingParamKey;
	name: string;
	desc: string;
	min: number;
	max: number;
	step: number;
	fallback: number;
}

const SLIDER_SPECS: SamplingSliderSpec[] = [
	{
		key: "temperature",
		name: "Temperature",
		// Deliberately capped at 1 even though OpenAI/Gemini accept up to 2:
		// Anthropic's range ends at 1, and a value above a provider's range is a
		// hard 400 that the unsupported-parameter recovery would answer by
		// dropping the setting entirely. 0-1 is the range that works everywhere.
		desc: "Sampling temperature (0-1, the range every provider accepts). Higher values like 0.8 make the output more random; lower values like 0.2 make it more focused and deterministic.",
		min: 0,
		max: 1,
		step: 0.1,
		fallback: DEFAULT_TEMPERATURE,
	},
	{
		key: "top_p",
		name: "Top P",
		desc: "Nucleus sampling - an alternative to temperature. The model considers only the tokens comprising the top P probability mass, so 0.1 means the top 10%.",
		min: 0,
		max: 1,
		step: 0.1,
		fallback: DEFAULT_TOP_P,
	},
	{
		key: "frequency_penalty",
		name: "Frequency Penalty",
		desc: "Positive values penalize tokens by how often they already appear, reducing verbatim repetition; negative values encourage it. Only sent to providers that support it.",
		min: -2,
		max: 2,
		step: 0.1,
		fallback: DEFAULT_FREQUENCY_PENALTY,
	},
	{
		key: "presence_penalty",
		name: "Presence Penalty",
		desc: "Positive values penalize tokens that have appeared at all, encouraging new topics; negative values do the opposite. Only sent to providers that support it.",
		min: -2,
		max: 2,
		step: 0.1,
		fallback: DEFAULT_PRESENCE_PENALTY,
	},
];

/**
 * The advanced sampling sliders shared by the AI Assistant command modals.
 *
 * A parameter is only ever sent when the user has actually set it — an
 * untouched slider means "use the provider's default". Each slider gets a
 * reset button that returns it to that unset state, and models whose metadata
 * says they reject sampling parameters get an upfront note instead of a
 * surprising retry at run time.
 */
export function addSamplingParamSettings(
	container: HTMLElement,
	modelParameters: Partial<OpenAIModelParameters>,
	selectedModel: ModelInput,
	reload: () => void,
): void {
	const model = resolveModel(selectedModel, { silent: true })?.model;
	if (model?.supportsTemperature === false) {
		container.createEl("div", {
			text: `${model.name} uses fixed sampling, so these settings are not sent to it.`,
			cls: "setting-item-description",
		});
	}

	for (const spec of SLIDER_SPECS) {
		const isSet = typeof modelParameters[spec.key] === "number";
		new Setting(container)
			.setName(spec.name)
			.setDesc(
				isSet
					? spec.desc
					: `${spec.desc} Currently using the provider's default.`,
			)
			.addSlider((slider) => {
				slider.setLimits(spec.min, spec.max, spec.step);
				slider.setDynamicTooltip();
				slider.setValue(modelParameters[spec.key] ?? spec.fallback);
				slider.onChange((value) => {
					modelParameters[spec.key] = value;
				});
			})
			.addExtraButton((button) => {
				button.setIcon("rotate-ccw");
				button.setTooltip("Reset to provider default");
				button.setDisabled(!isSet);
				button.onClick(() => {
					delete modelParameters[spec.key];
					reload();
				});
			});
	}
}

import {
	ensureProviderIds,
	type AIProvider,
	type ModelRef,
} from "src/ai/Provider";
import { pinAiCommandModelRefs } from "src/ai/modelRefPinning";
import type IChoice from "src/types/choices/IChoice";
import { settingsStore } from "src/settingsStore";
import { deepClone } from "src/utils/deepClone";
import { log } from "src/logger/logManager";
import type { Migration } from "./Migrations";

/**
 * The pre-#1495 resolution rule, applied verbatim: the FIRST provider (in
 * settings order) listing the model name. Local rather than resolveModel so
 * the migration operates on ITS drafts, not the live store.
 */
function firstMatchProvider(
	providers: AIProvider[],
	modelName: string,
): AIProvider | undefined {
	return providers.find((provider) =>
		provider.models.some((model) => model.name === modelName),
	);
}

/**
 * Pin every stored bare model name to the provider it resolves to TODAY
 * (#1495). Behavior-preserving by construction: each ref records exactly what
 * the first-match rule currently picks, so no command changes endpoint or key
 * during the upgrade — the ref only protects it from being rerouted later
 * when another provider gains the same model name.
 *
 * "Ask me" and names no provider serves are left unpinned; the latter keep
 * failing at run time with the same error as before, visible in the model
 * dropdown as "(missing)".
 */
const pinAiModelRefs: Migration = {
	description:
		"Pin AI commands' models to the provider they currently resolve to, and give every provider a stable id.",

	migrate: async (_) => {
		const state = settingsStore.getState();
		const providers = deepClone(state.ai.providers ?? []) as AIProvider[];
		const choices = deepClone(state.choices ?? []) as IChoice[];

		ensureProviderIds(providers);

		pinAiCommandModelRefs(choices, providers, (command, ref) => {
			log.logMessage(
				`Pinned AI command "${command.name}"'s model to ${ref.providerId}/${ref.name}.`,
			);
		});

		// Same rules for the default model: preserve a still-valid ref, re-pin
		// a stale one from the string, leave "Ask me"/unresolvable unpinned.
		let defaultModelRef: ModelRef | undefined;
		const defaultModel = state.ai.defaultModel;
		if (
			state.ai.defaultModelRef &&
			state.ai.defaultModelRef.name === defaultModel
		) {
			defaultModelRef = state.ai.defaultModelRef;
		} else if (defaultModel && defaultModel !== "Ask me") {
			const provider = firstMatchProvider(providers, defaultModel);
			if (provider?.id) {
				defaultModelRef = { providerId: provider.id, name: defaultModel };
				log.logMessage(
					`Pinned the default model to ${provider.id}/${defaultModel}.`,
				);
			}
		}

		settingsStore.setState({
			choices,
			ai: {
				...settingsStore.getState().ai,
				providers,
				...(defaultModelRef ? { defaultModelRef } : {}),
			},
		});
	},
};

export default pinAiModelRefs;

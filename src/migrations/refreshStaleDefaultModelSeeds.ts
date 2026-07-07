import {
	CURRENT_MODEL_SEEDS,
	RETIRED_SEED_MODELS,
	type AIProvider,
	type Model,
} from "src/ai/Provider";
import { CommandType } from "src/types/macros/CommandType";
import type { ICommand } from "src/types/macros/ICommand";
import type IChoice from "src/types/choices/IChoice";
import { settingsStore } from "src/settingsStore";
import { deepClone } from "src/utils/deepClone";
import { log } from "src/logger/logManager";
import type { Migration } from "./Migrations";
import { walkAllCommandsInSettings } from "./helpers/choice-traversal";

/** Lowercased hostname of an endpoint, or "" when unparsable (scheme optional). */
function endpointHost(endpoint: string): string {
	for (const candidate of [endpoint, `https://${endpoint}`]) {
		try {
			const host = new URL(candidate).hostname.toLowerCase();
			if (host) return host;
		} catch {
			/* try next form */
		}
	}
	return "";
}

/**
 * Only providers pointing at the OFFICIAL endpoints are touched. A custom or
 * proxy provider may legitimately serve models whose names collide with the
 * retired ids, so we never rewrite those.
 */
function seedKeyForProvider(
	provider: AIProvider,
): keyof typeof CURRENT_MODEL_SEEDS | null {
	const host = endpointHost(provider.endpoint ?? "");
	if (host === "api.openai.com") return "openai";
	if (host === "generativelanguage.googleapis.com") return "google";
	if (host === "api.anthropic.com") return "anthropic";
	return null;
}

function refreshProviderModels(
	provider: AIProvider,
	seedKey: keyof typeof CURRENT_MODEL_SEEDS,
	namesInOtherProviders: Set<string>,
): void {
	const retired = new Set(
		seedKey === "anthropic" ? [] : RETIRED_SEED_MODELS[seedKey],
	);
	provider.models = provider.models.filter(
		(model) => !retired.has(model.name),
	);

	const byName = new Map(provider.models.map((model) => [model.name, model]));
	for (const seed of CURRENT_MODEL_SEEDS[seedKey]) {
		const existing = byName.get(seed.name);
		if (existing) {
			// Refresh metadata in place: the seed values were verified against the
			// live provider/model directory at ship time and supersede whatever an
			// older release (or a manual add of the same id) recorded.
			existing.maxTokens = seed.maxTokens;
			existing.maxOutputTokens = seed.maxOutputTokens;
			existing.supportsTemperature = seed.supportsTemperature;
		} else if (!namesInOtherProviders.has(seed.name)) {
			// Model lookup resolves a bare model name to the FIRST provider that
			// lists it, so adding a seed whose name another provider already has
			// would silently reroute that user's existing commands. Skip those;
			// auto-sync and manual import remain available.
			provider.models.push({ ...seed });
		}
	}
}

// The pre-2026 AIAssistantCommand constructor baked these values into every
// command; they were never a user's choice. Sending an explicit default is
// wire-equivalent to omitting the parameter (verified live), so deleting them
// changes nothing today while sparing future models a pointless rejection.
const LEGACY_BAKED_PARAM_DEFAULTS: Record<string, number> = {
	temperature: 1,
	top_p: 1,
	frequency_penalty: 0,
	presence_penalty: 0,
};

type AICommandish = ICommand & {
	model?: string;
	modelParameters?: Record<string, unknown>;
};

function isAICommand(command: ICommand): command is AICommandish {
	return (
		command.type === CommandType.AIAssistant ||
		command.type === CommandType.InfiniteAIAssistant
	);
}

const refreshStaleDefaultModelSeeds: Migration = {
	description:
		"Refresh built-in AI provider model lists: drop retired models, add the current generation, and turn on auto-sync.",

	migrate: async (_) => {
		const state = settingsStore.getState();
		const providers = deepClone(state.ai.providers ?? []);
		const choices = deepClone(state.choices ?? []);

		const removedModelNames = new Set<string>();
		for (const provider of providers) {
			const seedKey = seedKeyForProvider(provider);
			if (!seedKey) continue;

			const namesInOtherProviders = new Set(
				providers
					.filter((other) => other !== provider)
					.flatMap((other) =>
						other.models.map((model: Model) => model.name),
					),
			);

			const before = provider.models.map((model: Model) => model.name);
			refreshProviderModels(provider, seedKey, namesInOtherProviders);
			const after = new Set(
				provider.models.map((model: Model) => model.name),
			);
			for (const name of before) {
				if (!after.has(name)) removedModelNames.add(name);
			}

			// The toggle shipped default-off and was never acted on by any code
			// path, so users could not have meaningfully chosen it. Turning it on
			// is what keeps these lists current without plugin releases; the
			// toggle in provider settings still opts out.
			provider.autoSyncModels = true;

			// The official OpenAI catalog mixes ~90 non-chat entries (audio,
			// image, embeddings) into /v1/models, so the curated models.dev
			// directory is the right sync source for it. "auto"/"providerApi"
			// on this provider came from an earlier field-backfill migration,
			// not a user decision.
			if (seedKey === "openai") {
				provider.modelSource = "modelsDev";
			}
		}

		// A model name is resolved to the FIRST provider that lists it, so a
		// name we removed from an official provider may still be served by a
		// custom/proxy provider the user configured. Only commands whose model
		// no longer exists ANYWHERE get re-pointed.
		const stillServedNames = new Set(
			providers.flatMap((provider) =>
				provider.models.map((model: Model) => model.name),
			),
		);
		const orphanedModelNames = new Set(
			[...removedModelNames].filter((name) => !stillServedNames.has(name)),
		);

		// A saved AI command pinned to a model that is retired upstream would
		// fail on every run. Fall back to asking at run time, and drop the
		// baked-in sampling "defaults" older commands carried (see above).
		// Legacy top-level macros are gone by now (removeMacroIndirection runs
		// earlier), so choices are the only command roots left.
		walkAllCommandsInSettings(
			{ choices: choices as IChoice[] },
			(command) => {
				if (!isAICommand(command)) return;

				if (command.model && orphanedModelNames.has(command.model)) {
					log.logMessage(
						`AI command "${command.name}" used ${command.model}, which its provider has retired. It now asks for a model when it runs.`,
					);
					command.model = "Ask me";
				}

				const params = command.modelParameters;
				if (params && typeof params === "object") {
					for (const [key, baked] of Object.entries(
						LEGACY_BAKED_PARAM_DEFAULTS,
					)) {
						if (params[key] === baked) delete params[key];
					}
				}
			},
		);

		const defaultModel = orphanedModelNames.has(state.ai.defaultModel)
			? "Ask me"
			: state.ai.defaultModel;

		settingsStore.setState({
			choices,
			ai: {
				...settingsStore.getState().ai,
				defaultModel,
				providers,
			},
		});
	},
};

export default refreshStaleDefaultModelSeeds;

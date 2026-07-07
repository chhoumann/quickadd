import { log } from "src/logger/logManager";
import { settingsStore } from "src/settingsStore";
import type { AIProvider, Model, ModelRef } from "./Provider";
import { estimateModelInputBudget } from "./tokenEstimator";

/** Conservative context-window fallback when no model is known or configured. */
const FALLBACK_MODEL_MAX_TOKENS = 4096;

/** A model together with the provider that will serve it. */
export interface ResolvedModel {
	provider: AIProvider;
	model: Model;
}

/**
 * Anything the plugin accepts as a model reference: a provider-scoped ref
 * (pinned commands, script object form) or a string — either a bare model
 * name (legacy) or the qualified `providerId/modelName` form.
 */
export type ModelInput = ModelRef | string;

export function getModelNames() {
	const aiSettings = settingsStore.getState().ai;

	return aiSettings.providers
		.flatMap((provider) => provider.models)
		.map((model) => model.name);
}

function providers(): AIProvider[] {
	return settingsStore.getState().ai.providers;
}

/** Legacy resolution: the FIRST provider (in settings order) listing the name. */
function findByBareName(
	providers: AIProvider[],
	name: string,
): ResolvedModel | undefined {
	for (const provider of providers) {
		const model = provider.models.find((m) => m.name === name);
		if (model) return { provider, model };
	}
	return undefined;
}

/**
 * Qualified `providerId/name` forms of every provider serving `name`, for
 * warnings and error hints. A qualified form can itself be SHADOWED — some
 * other provider serving a literal model whose id is that whole string
 * (OpenRouter's `openai/gpt-4o`) — in which case the string form wouldn't
 * reach the intended provider, so the hint appends the object-form escape.
 */
function qualifiedNamesFor(modelName: string): string[] {
	const all = providers();
	return all
		.filter((p) => p.models.some((m) => m.name === modelName))
		.map((p) => {
			const qualified = `${p.id ?? p.name}/${modelName}`;
			const shadowed = all.some((other) =>
				other.models.some((m) => m.name === qualified),
			);
			return shadowed
				? `{ name: "${modelName}", provider: "${p.id ?? p.name}" } (the string "${qualified}" is itself a model id on another provider)`
				: qualified;
		});
}

// One warning per subject per session — a script calling ai.prompt in a loop,
// or a settings modal re-rendering with a dangling ref, must not stack a
// Notice per iteration.
const warnedResolutions = new Set<string>();

function warnOnce(key: string, message: string): void {
	if (warnedResolutions.has(key)) return;
	warnedResolutions.add(key);
	log.logWarning(message);
}

/** Test seam: clears the warn-once memory between test cases. */
export function resetModelResolutionWarnings(): void {
	warnedResolutions.clear();
}

/**
 * Resolve a model reference to the model AND the provider that serves it.
 *
 * Object refs (pinned commands, script object form) resolve by stable provider
 * id. A dangling ref — its provider deleted, or the model removed from it —
 * falls back to legacy bare-name first-match, LOUDLY when that lands on a
 * different provider: rerouting to another endpoint and API key must never be
 * silent.
 *
 * Strings resolve bare-name-first: existing configs and scripts, including
 * models whose literal names contain slashes (OpenRouter's "openai/gpt-4o"),
 * keep resolving byte-identically to the pre-#1495 rule. Only when no model
 * matches the whole string is it read as qualified `provider/model`, split at
 * the FIRST slash; the prefix matches a provider id or display name
 * (case-insensitively). Provider ids never contain "/", so the split is
 * unambiguous. Scripts that need to override a literal slash-named model use
 * the object form `{ provider, name }`.
 */
export function resolveModel(
	input: ModelInput,
	options?: {
		/**
		 * Suppress resolution warnings. For settings-UI/metadata callers
		 * (dropdown preselection, slider bounds): a modal render must never
		 * consume the warn-once budget that belongs to an actual run.
		 */
		silent?: boolean;
	},
): ResolvedModel | undefined {
	const all = providers();
	const silent = options?.silent === true;

	// Tolerate malformed persisted data (a command whose model was never set):
	// the object branch below would throw on `input.providerId`, and settings-UI
	// callers rely on an undefined result to fall back instead of blanking.
	if (input == null) return undefined;
	if (typeof input !== "string") {
		const provider = all.find((p) => p.id === input.providerId);
		const model = provider?.models.find((m) => m.name === input.name);
		if (provider && model) return { provider, model };

		const fallback = findByBareName(all, input.name);
		if (fallback) {
			if (!silent) {
				// The fallback target is part of the key: if the fallback later
				// lands on a DIFFERENT provider, that is a new reroute and warns
				// again.
				warnOnce(
					`pin:${input.providerId}/${input.name}→${fallback.provider.id ?? fallback.provider.name}`,
					`Model "${input.name}" is pinned to provider "${input.providerId}", which no longer serves it. ` +
						`Using "${fallback.provider.name}" instead — re-select the model in the command's settings to pin it again.`,
				);
			}
			return fallback;
		}
		return undefined;
	}

	const bare = findByBareName(all, input);
	if (bare) {
		const candidates = qualifiedNamesFor(input);
		if (candidates.length > 1 && !silent) {
			warnOnce(
				`ambiguous:${input}→${bare.provider.id ?? bare.provider.name}`,
				`Model "${input}" is served by ${candidates.length} providers; using "${bare.provider.name}". ` +
					`Qualify it to choose explicitly: ${candidates.join(", ")}.`,
			);
		}
		return bare;
	}

	const slash = input.indexOf("/");
	if (slash <= 0 || slash === input.length - 1) return undefined;

	return resolveModelScoped(input.slice(0, slash), input.slice(slash + 1));
}

/**
 * Resolve a model within one provider, addressed by stable id or display name
 * (case-insensitively). The precise form: unlike bare strings it can never be
 * shadowed by a literal slash-named model on another provider.
 */
export function resolveModelScoped(
	providerKey: string,
	modelName: string,
): ResolvedModel | undefined {
	const all = providers();
	const key = providerKey.trim().toLowerCase();

	const provider =
		all.find((p) => p.id?.toLowerCase() === key) ??
		all.find((p) => p.name.trim().toLowerCase() === key);
	const model = provider?.models.find((m) => m.name === modelName);
	if (provider && model) return { provider, model };

	return undefined;
}


/**
 * Model parameter accepted by the script API (ai.prompt / ai.agent /
 * ai.getMaxTokens): a bare name, a qualified "providerId/modelName" string, or
 * an object form whose optional `provider` (stable id or display name) scopes
 * the lookup exactly — the escape hatch when a literal slash-named model on
 * one provider shadows the qualified string form.
 */
export type ScriptModelInput = string | { name: string; provider?: string };

/** resolveModel for script inputs, throwing actionable errors instead of returning undefined. */
export function resolveModelInputOrThrow(
	input: ScriptModelInput,
): ResolvedModel {
	const name = typeof input === "string" ? input : input?.name;
	if (!name) {
		throw new Error(
			`Invalid model parameter. Expected a string (e.g., "gpt-4o" or "openai/gpt-4o") or an object with a name property (e.g., {name: "gpt-4o", provider: "openai"})`,
		);
	}

	const resolved =
		typeof input !== "string" && input.provider
			? resolveModelScoped(input.provider, name)
			: resolveModel(name);

	if (!resolved) {
		// When the model exists but the addressed provider doesn't serve it,
		// point at the forms that WOULD resolve.
		const bareName = name.includes("/")
			? name.slice(name.indexOf("/") + 1)
			: name;
		const candidates = [
			...qualifiedNamesFor(name),
			...(bareName !== name ? qualifiedNamesFor(bareName) : []),
		];
		const hint = candidates.length
			? ` Did you mean ${candidates.join(" or ")}?`
			: " Add it in Settings → QuickAdd → AI → Providers, or enable auto-sync for your provider.";
		throw new Error(
			`Model '${typeof input === "string" ? input : `${input.provider ?? ""}/${name}`}' not found in configured providers.${hint}`,
		);
	}

	return resolved;
}

export function getModelMaxTokens(model: ModelInput) {
	const resolved = resolveModel(model);

	if (resolved) {
		return resolved.model.maxTokens;
	}

	throw new Error(
		`Model ${typeof model === "string" ? model : model.name} not found with any provider.`,
	);
}

/**
 * Largest context window among all configured models, or a conservative
 * fallback when none are configured. Used when the selected model is unknown at
 * config time (see getMaxChunkTokensUpperBound).
 */
export function getLargestModelMaxTokens(): number {
	const aiSettings = settingsStore.getState().ai;

	const tokens = aiSettings.providers
		.flatMap((provider) => provider.models)
		.map((model) => model.maxTokens)
		.filter((value) => Number.isFinite(value) && value > 0);

	return tokens.length ? Math.max(...tokens) : FALLBACK_MODEL_MAX_TOKENS;
}

/**
 * Upper bound for the "Max Chunk Tokens" slider: the model's estimated input
 * budget minus the system-prompt overhead, floored at 1.
 *
 * The selected model can be unknown at config time — the "Ask me" sentinel
 * (resolved at runtime) or a model that was removed from settings. In that case
 * we fall back to the most permissive configured model instead of throwing,
 * which would blank the settings modal. The runtime still caps each chunk to the
 * actual model's budget, so a generous UI bound never lets a request exceed the
 * real limit.
 */
export function getMaxChunkTokensUpperBound(
	model: ModelInput,
	systemPromptTokens: number,
): number {
	// Silent: this feeds a settings-modal slider bound; rendering a modal must
	// not consume the warn-once budget that belongs to an actual run.
	const resolved = resolveModel(model, { silent: true });
	const maxTokens = resolved?.model.maxTokens ?? getLargestModelMaxTokens();

	return Math.max(1, estimateModelInputBudget(maxTokens) - systemPromptTokens);
}

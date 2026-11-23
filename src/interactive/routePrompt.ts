/**
 * Where a prompt opened by an engine goes: the connected client, a headless
 * abort, or the Obsidian modal, with one cancellation mapping. Each site keeps
 * its own modal construction and headless branch, since those vary (one engine
 * resolves a sole exported member without asking).
 */

import type { IChoiceExecutor } from "../IChoiceExecutor";
import { ChoiceAbortError } from "../errors/ChoiceAbortError";
import { UserCancelError } from "../errors/UserCancelError";
import { isCancellationError } from "../utils/errorUtils";
import type { PromptProvider } from "./promptProvider";

interface PromptRoute<T> {
	/** Ask the connected client. Only called when a provider is attached. */
	remote(provider: PromptProvider): Promise<T>;
	/**
	 * Nobody can answer (a non-interactive CLI run). Throws the site's own
	 * `ChoiceAbortError` with the text that says how to configure the choice so it
	 * stops needing to ask — or resolves, where the site has one unambiguous answer.
	 */
	headless(): Promise<T>;
	app(): Promise<T>;
}

/**
 * The executor is required, not optional: an engine that cannot supply one is a compile
 * error rather than a prompt that silently opens on the desktop.
 */
export type PromptRoutingContext = Pick<
	IChoiceExecutor,
	"promptProvider" | "interactive"
>;

export async function routePrompt<T>(
	executor: PromptRoutingContext,
	route: PromptRoute<T>,
): Promise<T> {
	try {
		if (executor.promptProvider) return await route.remote(executor.promptProvider);
		if (executor.interactive === false) return await route.headless();
		return await route.app();
	} catch (error) {
		// One mapping, so a dismissal reads the same from Escape on a modal or
		// `{"cancelled":true}` on the wire.
		if (isCancellationError(error)) {
			throw new UserCancelError("Input cancelled by user");
		}
		throw error;
	}
}

/**
 * The headless branch for a script-facing prompt (`quickAddApi.suggester`,
 * `inputPrompt`, `requestInputs`, ...). These have no headless answer: in a
 * non-interactive run the modal would open on a desktop nobody is watching and
 * the CLI call would never return. Abort instead, naming the prompt so the
 * caller knows which value to preset.
 */
export function scriptPromptHeadless(
	prompt: string,
	label?: string,
	remedy = "Re-run with the ui flag.",
): () => Promise<never> {
	return async () => {
		const named = label ? `${prompt} "${label}"` : prompt;
		throw new ChoiceAbortError(
			`A script opened ${named}, but this run is non-interactive. ${remedy}`,
		);
	};
}

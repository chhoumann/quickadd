/**
 * Where a prompt opened by an ENGINE goes.
 *
 * `quickadd:interactive` promises to forward a run's prompts to the connected client,
 * and it kept that promise for every prompt a *script* or the *formatter* opens, because
 * each of those hand-wrote an `if (choiceExecutor.promptProvider)` branch at its call
 * site. The engines never got one. So a Template whose target note already existed
 * opened its "file already exists" chooser on the desktop while the client's `/poll`
 * returned nothing, and the run sat there until someone walked past the machine — on a
 * headless or Raycast setup, the entire premise of the seam, until the watchdog gave up
 * (#1614).
 *
 * The fix is a seam rather than six more hand-written branches, because "remember to add
 * the branch" had already been missed six times. But the seam deliberately owns only the
 * part that is genuinely uniform:
 *
 * - the ORDER of the three destinations, and
 * - the `isCancellationError` → {@link UserCancelError} mapping every site repeated.
 *
 * Everything else stays at the call site. A wrapper that *built* the modal would have to
 * model every per-site difference as an option it understands — and the variance here is
 * entirely in modal construction (`renderItem`, `searchItems`, `valueExists`,
 * `customValueLabel`, `allowCustomValue`) and in the headless branch, which is not
 * uniform either: most sites abort, but `MacroChoiceEngine` legitimately RESOLVES a sole
 * exported member without asking. A fixed three-step ladder would have regressed that.
 * So each site passes three closures and keeps its own modal call verbatim.
 */

import type { IChoiceExecutor } from "../IChoiceExecutor";
import { UserCancelError } from "../errors/UserCancelError";
import { isCancellationError } from "../utils/errorUtils";
import type { PromptProvider } from "./promptProvider";

export interface PromptRoute<T> {
	/** Ask the connected client. Only called when a provider is attached. */
	remote(provider: PromptProvider): Promise<T>;
	/**
	 * Nobody can answer (a non-interactive CLI run). Throws the site's own
	 * `ChoiceAbortError` with the text that says how to configure the choice so it
	 * stops needing to ask — or resolves, where the site has one unambiguous answer.
	 */
	headless(): Promise<T>;
	/** Open the Obsidian modal. */
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
		// One mapping for all three destinations, so a dismissal reads the same to the
		// engine whether it came from Escape on a modal or `{"cancelled":true}` on the
		// wire. Every converted site used to repeat this catch verbatim.
		if (isCancellationError(error)) {
			throw new UserCancelError("Input cancelled by user");
		}
		throw error;
	}
}

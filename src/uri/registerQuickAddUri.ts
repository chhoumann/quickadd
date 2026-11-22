import type { Plugin, TFile } from "obsidian";
import type { ChoiceRuntimePlugin } from "../types/pluginContext";
import { ChoiceExecutor } from "../choiceExecutor";
import type IChoice from "../types/choices/IChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type { ChoiceEffect } from "../types/ChoiceOutcome";
import { log } from "../logger/logManager";
import { reportError, reportUnlessCancelled, withErrorHandling } from "../utils/errorUtils";
import { isReservedVariableKey } from "../utils/reservedVariableKeys";
import { applyInvocationDate } from "../utils/resolveDateOrigin";
import { valueParameterName } from "../cli/params";
import { buildCallbackUrl, buildObsidianOpenUrl, callbackUrls, isCallbackUrlAllowed, parseCallbackTargets, type CallbackTargets } from "./uriCallback";

type UriParameters = { choice?: string; date?: string } &
{ [key in `value-${string}`]?: string } &
{ "x-success"?: string; "x-error"?: string; "x-cancel"?: string; "x-callback-url"?: string };

export function registerQuickAddUri(
	plugin: ChoiceRuntimePlugin & Pick<Plugin, "registerObsidianProtocolHandler">,
	getChoice: (name: string) => IChoice | null,
	warnIfChoiceNameAmbiguous: (name: string) => void,
) {
	plugin.registerObsidianProtocolHandler("quickadd", async (e) => {
		const parameters = e as unknown as UriParameters;

		// Resolve callback targets only when the feature is enabled. With it off (or
		// no x-* params) we run the exact legacy path - zero behavioural change.
		const targets: CallbackTargets = plugin.settings.enableUriCallbacks
			? parseCallbackTargets(parameters)
			: { any: false };

		if (!targets.any) {
			await runUriChoiceLegacy(parameters);
			return;
		}

		// Validate every provided callback URL BEFORE running anything, so a bad URL
		// can't half-execute and make an external caller retry (and duplicate work).
		const disallowed = callbackUrls(targets).filter(
			(url) => !isCallbackUrlAllowed(url),
		);
		if (disallowed.length > 0) {
			log.logWarning(
				`QuickAdd URI: ignoring disallowed callback URL(s): ${disallowed.join(", ")}`,
			);
			// Notify via x-error only if it is itself allowed; never open a disallowed
			// URL. Nothing was executed, so the caller can safely retry.
			if (targets.error && isCallbackUrlAllowed(targets.error)) {
				openUriCallback(targets.error, {
					status: "error",
					errorCode: "bad-callback-url",
				});
			}
			return;
		}

		const found = findUriChoice(parameters);
		if ("missing" in found) {
			log.logWarning(found.missing);
			fireUriError(targets, "choice-not-found");
			return;
		}
		const { choice } = found;

		if (choice.type !== "Template" && choice.type !== "Capture") {
			log.logWarning(
				`QuickAdd URI x-callback supports Template and Capture choices only ('${choice.name}' is ${choice.type}). ` +
				`A URI with x-* callback params cannot run a ${choice.type} choice while "Enable URI callbacks" is on; remove the x-* params to run it on the legacy path.`,
			);
			fireUriError(targets, "unsupported-choice-type");
			return;
		}

		const choiceExecutor = uriExecutor(parameters);
		if (!choiceExecutor) {
			log.logWarning(
				`QuickAdd URI: could not parse date origin '${parameters.date}'.`,
			);
			fireUriError(targets, "execution-failed");
			return;
		}

		const outcome = await choiceExecutor.executeWithOutcome(
			choice as ITemplateChoice | ICaptureChoice,
		);

		switch (outcome.status) {
			case "success":
				fireUriSuccess(targets, outcome.file, outcome.effect);
				break;
			case "cancelled":
				if (outcome.cancelKind === "user") {
					fireUriCancel(targets);
				} else {
					fireUriError(targets, "execution-aborted");
				}
				break;
			case "error":
				fireUriError(targets, "execution-failed");
				break;
		}
	});

	async function runUriChoiceLegacy(parameters: UriParameters): Promise<void> {
		const found = findUriChoice(parameters);
		if ("missing" in found) {
			reportError(new Error(found.missing), "URI handler error");
			return;
		}
		const { choice } = found;
		const choiceExecutor = uriExecutor(parameters);
		if (!choiceExecutor) {
			reportError(
				new Error(`Could not parse date origin '${parameters.date}'`),
				"URI handler error",
			);
			return;
		}
		try {
			await choiceExecutor.execute(choice);
		} catch (err) {
			// Silent for a dismissal: a URI run that opens a prompt the user escapes is
			// not a failure, and plugin legacy path has no x-cancel target to tell.
			reportUnlessCancelled(err, `Could not run "${choice.name}"`);
		}
	}

	/** The choice a URI names, or why it names none. */
	function findUriChoice(
		parameters: UriParameters,
	): { choice: IChoice } | { missing: string } {
		if (!parameters.choice) {
			return { missing: "URI was executed without a `choice` parameter." };
		}
		const choice = getChoice(parameters.choice);
		if (!choice) {
			return { missing: `URI could not find any choice named '${parameters.choice}'` };
		}
		// Names are not unique; getChoice returns the FIRST match. Warn (via Notice)
		// so an automation that silently ran the wrong choice is at least diagnosable.
		warnIfChoiceNameAmbiguous(parameters.choice);
		return { choice };
	}

	/**
	 * An executor holding the URI's `value-*` variables and `date`, or null when
	 * the date doesn't parse.
	 */
	function uriExecutor(parameters: UriParameters): ChoiceExecutor | null {
		const choiceExecutor = new ChoiceExecutor(plugin.app, plugin);
		for (const [key, value] of Object.entries(parameters)) {
			const variableName = valueParameterName(key);
			// Never let an incoming URI populate a reserved internal variable
			// (e.g. the capture-target file path): obsidian:// links are reachable
			// by any webpage/app, so honouring `value-__qa.…` would let an external
			// caller drive internal plumbing. There is no legitimate URI use for
			// these keys. (The local CLI does accept them; see onePageInputs docs.)
			if (
				variableName &&
				typeof value === "string" &&
				!isReservedVariableKey(variableName)
			) {
				choiceExecutor.variables.set(variableName, value);
			}
		}
		return applyInvocationDate(choiceExecutor, parameters.date) ? choiceExecutor : null;
	}

	function fireUriSuccess(
		targets: CallbackTargets,
		file: TFile | undefined,
		effect: ChoiceEffect,
	): void {
		const params: Record<string, string> = { status: "success", effect };
		if (file) {
			params.path = file.path;
			params.url = buildObsidianOpenUrl(plugin.app.vault.getName(), file.path);
		}
		if (targets.success) openUriCallback(targets.success, params);
	}

	function fireUriError(targets: CallbackTargets, errorCode: string): void {
		if (targets.error) {
			openUriCallback(targets.error, { status: "error", errorCode });
		}
	}

	function fireUriCancel(targets: CallbackTargets): void {
		if (targets.cancel) {
			openUriCallback(targets.cancel, { status: "cancel" });
		}
	}

	function openUriCallback(url: string, params: Record<string, string>): void {
		withErrorHandling(() => {
			window.open(buildCallbackUrl(url, params));
		}, "QuickAdd URI: failed to open callback URL");
	}
}

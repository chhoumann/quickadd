import type { App } from "obsidian";
import type { IChoiceExecutor } from "src/IChoiceExecutor";
import { FormatDisplayFormatter } from "src/formatters/formatDisplayFormatter";
import type QuickAdd from "src/main";
import type IChoice from "src/types/choices/IChoice";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";
import { VALUE_SYNTAX } from "src/constants";
import { MacroAbortError } from "src/errors/MacroAbortError";
import { log } from "src/logger/logManager";
import { OnePageInputModal } from "./OnePageInputModal";
import {
	canonicalizeOnePageFileValue,
	FILE_VARIABLE_PREFIX,
} from "src/utils/fileSyntax";
import { toWikiLink } from "src/utils/linkWrap";
import {
	collectChoiceRequirements,
	getUnresolvedRequirements,
} from "./collectChoiceRequirements";
import { shouldLeaveTemplateTitleForDiscovery } from "src/utils/templateNoteDiscoveryEligibility";

/**
 * Reconstruct the picked labels from the ", "-joined suggester string.
 *
 * A naive split on "," loses options whose value/label itself contains a comma
 * (from a quoted-comma option list, #239): "a, b, c, d" must round-trip to
 * ["a, b", "c, d"], not ["a","b","c","d"]. We greedily consume the longest known
 * display label at each position so comma-bearing options survive; anything that
 * doesn't match a known label (typed custom text) falls back to a "," split of
 * the remainder so custom-allowed tokens keep working.
 */
export function splitMultiSelectLabels(
	joined: string,
	displayToValue: Map<string, string>,
): string[] {
	const text = joined.trim();
	if (!text) return [];

	// Longest-first so "a, b" wins over a hypothetical shorter "a" prefix.
	const knownLabels = Array.from(displayToValue.keys()).sort(
		(a, b) => b.length - a.length,
	);

	const out: string[] = [];
	let rest = text;
	while (rest.length > 0) {
		const matched = knownLabels.find(
			(label) => rest === label || rest.startsWith(`${label}, `),
		);
		if (!matched) break;
		out.push(matched);
		rest = rest === matched ? "" : rest.slice(matched.length + 2);
	}

	// Remainder is unrecognized (typed custom text or unmatched labels): fall back
	// to a plain comma split so custom-allowed tokens still capture it.
	if (rest.length > 0) {
		for (const piece of rest.split(",")) {
			const trimmed = piece.trim();
			if (trimmed) out.push(trimmed);
		}
	}

	return out;
}

function shouldPromptAtRuntimeForDiscovery(
	choice: IChoice,
	requirementId: string,
): boolean {
	if (choice.type !== "Template" || requirementId !== "value") return false;

	const templateChoice = choice as ITemplateChoice;
	const format = templateChoice.fileNameFormat?.enabled
		? templateChoice.fileNameFormat.format
		: VALUE_SYNTAX;
	return shouldLeaveTemplateTitleForDiscovery(templateChoice, format);
}

export async function runOnePagePreflight(
	app: App,
	plugin: QuickAdd,
	choiceExecutor: IChoiceExecutor,
	choice: IChoice,
): Promise<boolean> {
	try {
		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			choice,
			{
				seedCaptureSelectionAsValue: true,
				// Hand loaded user-script modules to the executor so the runtime
				// engine consumes THIS load instead of executing each script's
				// top-level code a second time.
				preloadedUserScripts: choiceExecutor.preloadedUserScripts,
			},
		);
		if (requirements.length === 0) return false; // Nothing to collect

		// Only prompt for unresolved inputs (variables missing or null). Empty string is intentional.
		const unresolved = getUnresolvedRequirements(
			requirements,
			choiceExecutor.variables,
		);

		if (unresolved.length === 0) return false; // Everything prefilled, skip modal

		const modalRequirements = unresolved.filter(
			(requirement) =>
				!requirement.runtimeOnly &&
				!shouldPromptAtRuntimeForDiscovery(choice, requirement.id),
		);
		if (modalRequirements.length === 0) return false;

		// Show modal
		// Optional live preview of a couple of key outputs (best-effort)
		const computePreview = async (values: Record<string, string>) => {
			try {
				const formatter = new FormatDisplayFormatter(app, plugin);
				const out: Record<string, string> = {};
				// File name preview for Template
				if (choice.type === "Template") {
					const tmpl = choice as ITemplateChoice;
					if (tmpl.fileNameFormat?.enabled) {
						// Seed variables map-like into formatter
						for (const [k, v] of Object.entries(values)) {
							formatter["variables"].set(k, v);
						}
						out.fileName = await formatter.format(tmpl.fileNameFormat.format);
					}
				}
				return out;
			} catch {
				return {};
			}
		};

		// A remote interactive session (Raycast) collects the batch form through the
		// provider instead of the Obsidian modal; the values come back in the same
		// id -> string shape, so the post-processing below is unchanged (the modal's
		// per-pick multi-select map is simply absent, falling back to string parsing).
		const provider = choiceExecutor.promptProvider;
		let modal: OnePageInputModal | null = null;
		let values: Record<string, string>;
		if (provider) {
			values = await provider.requestInputs(modalRequirements);
		} else {
			modal = new OnePageInputModal(
				app,
				modalRequirements,
				choiceExecutor.variables,
				computePreview,
			);
			values = await modal.waitForClose;
		}

		// Date inputs already store @date:ISO. FILE inputs need canonicalizing: the
		// generic suggester stores raw typed text, so a value that isn't one of the
		// requirement's encoded `@file:` picks is treated as typed custom text (and
		// can't spoof a pick by typing the internal `@file:` sentinel).
		const fileOptionsByKey = new Map<string, string[]>();
		// |multi requirements: the suggester stores a ", "-joined string of the
		// DISPLAY labels; split it, map each label back to its option value (so
		// |text: mappings round-trip), and store a real array so the formatter
		// writes a YAML list — matching the runtime |multi path, with linklist
		// wrapping when requested.
		const multiInfoByKey = new Map<
			string,
			{
				emit: "text" | "linklist";
				allowCustom: boolean;
				displayToValue: Map<string, string>;
			}
		>();
		for (const req of modalRequirements) {
			if (req.id.startsWith(FILE_VARIABLE_PREFIX)) {
				fileOptionsByKey.set(req.id, req.options ?? []);
			}
			if (req.suggesterConfig?.multiSelect) {
				const options = req.options ?? [];
				const displayOptions = req.displayOptions ?? options;
				const displayToValue = new Map<string, string>();
				options.forEach((value, i) => {
					displayToValue.set((displayOptions[i] ?? value).trim(), value);
				});
				multiInfoByKey.set(req.id, {
					emit: req.multiEmit ?? "text",
					allowCustom: req.suggesterConfig.allowCustomInput ?? false,
					displayToValue,
				});
			}
		}

		// Store results into executor variables
		Object.entries(values).forEach(([k, v]) => {
			const multiInfo = multiInfoByKey.get(k);
			if (multiInfo !== undefined) {
				// Prefer the modal's unambiguous per-pick selection (survives the
				// "a"+"b" vs literal "a, b" collision); fall back to parsing the
				// ", "-joined text when the user manually edited the field.
				const pickedLabels = modal?.multiSelections.get(k);
				const items = (
					pickedLabels ??
					splitMultiSelectLabels(String(v), multiInfo.displayToValue)
				)
					// Drop typed entries that aren't options unless the token opted
					// into custom input, matching the runtime MultiSuggester.
					.filter(
						(label) =>
							multiInfo.allowCustom || multiInfo.displayToValue.has(label),
					)
					// Map the display label back to its value; a typed custom value
					// (no mapping) passes through unchanged.
					.map((label) => multiInfo.displayToValue.get(label) ?? label);
				choiceExecutor.variables.set(
					k,
					multiInfo.emit === "linklist" ? items.map(toWikiLink) : items,
				);
				return;
			}
			const fileOptions = fileOptionsByKey.get(k);
			const normalized = fileOptions
				? canonicalizeOnePageFileValue(v, fileOptions)
				: v;
			choiceExecutor.variables.set(k, normalized);
		});

		return true;
	} catch (error) {
		// Propagate an explicit cancellation/abort so the run stops instead of
		// continuing with the inputs missing. The native modal throws the string
		// "cancelled"; a remote provider rejects with UserCancelError (a
		// MacroAbortError subclass).
		if (error === "cancelled" || error instanceof MacroAbortError) {
			throw error;
		}
		// Any other error degrades to the sequential runtime prompts. That
		// fallback is safe, but it must not be silent: a regression here would
		// otherwise disable the one-page form for a choice shape with no trace
		// (and if the form was already submitted, the user gets re-asked).
		// Remote runs are exempt: session teardown rejects the pending form with
		// a plain Error, and "falling back to step-by-step prompts" would mislead
		// there - the session error already surfaces to the remote client.
		if (!choiceExecutor.promptProvider) {
			log.logWarning(
				`One-page input failed for choice "${choice.name}"; falling back to step-by-step prompts: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
		return false;
	}
}

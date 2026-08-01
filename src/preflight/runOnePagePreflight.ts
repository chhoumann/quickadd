import type { App } from "obsidian";
import type { IChoiceExecutor } from "src/IChoiceExecutor";
import { FileNameDisplayFormatter } from "src/formatters/fileNameDisplayFormatter";
import type QuickAdd from "src/main";
import type IChoice from "src/types/choices/IChoice";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";
import { VALUE_SYNTAX } from "src/constants";
import { MacroAbortError } from "src/errors/MacroAbortError";
import { log } from "src/logger/logManager";
import { OnePageInputModal, type PreviewRow } from "./OnePageInputModal";
import { likelyTargetFolderPath } from "src/utils/previewTargetFolder";
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
import type { FormAnswer } from "src/interactive/promptProvider";

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

/**
 * Match MultiSuggester's output contract for structured FILE replies: known
 * options follow source order, then unique custom entries follow reply order.
 */
export function orderOnePageFilePicks(
	rawPicks: string[],
	options: string[],
	allowCustom: boolean,
): string[] {
	const validPicks = rawPicks.filter(
		(value) => allowCustom || options.includes(value),
	);
	const selected = new Set(validPicks);
	return [
		...options.filter((value) => selected.has(value)),
		...validPicks.filter(
			(value, index) =>
				!options.includes(value) && validPicks.indexOf(value) === index,
		),
	];
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
		const computePreview = async (
			values: Record<string, unknown>,
		): Promise<PreviewRow[]> => {
			try {
				// FileNameDisplayFormatter, not FormatDisplayFormatter: this previews
				// a FILE NAME. The content formatter expands `\n` escapes (not
				// linebreaks in a path) and resolves {{LINKCURRENT}}/{{LINKSECTION}},
				// both of which the run-time `formatFileName` deliberately leaves
				// literal. It is also the class the builder's own file-name preview
				// uses.
				//
				// It resolves {{TEMPLATE:}} the way the run does (#1563) - which
				// matters most here, because the requirement scan behind this very
				// modal already walks INTO the include (collectChoiceRequirements,
				// scope "noteTitle"), so the form asks for variables it found inside
				// the template. What stays literal in the preview is what the
				// formatter has no inert stand-in for: inline `js quickadd` fences and
				// macros, which the run really does execute inside an included body.
				const formatter = new FileNameDisplayFormatter(app, plugin);
				const out: PreviewRow[] = [];
				// File name preview for Template
				if (choice.type === "Template") {
					const tmpl = choice as ITemplateChoice;
					if (tmpl.fileNameFormat?.enabled) {
						// {{FOLDER}} previewed nothing at all here: nobody called
						// setTargetFolderPath, so `Notes/{{FOLDER}}/x` rendered `Notes//x`
						// plus an empty-segment error that the modal then discarded
						// (#1590). The builder's own neutral placeholder is the fallback
						// when the run has not decided the folder yet.
						formatter.setTargetFolderPath(
							likelyTargetFolderPath(tmpl.folder) ?? "Folder/Name",
						);
						// Seed variables map-like into formatter
						for (const [k, v] of Object.entries(values)) {
							formatter["variables"].set(k, v);
						}
						out.push({
							label: "File name",
							text: await formatter.format(tmpl.fileNameFormat.format),
							// The channel #1558 added and #1563/#1578/#1588 fill with
							// "this name would abort the run". This is the surface where
							// it is worth the most: the user's REAL answers are seeded
							// above, so the row shows the exact name about to fail.
							diagnostics: formatter.diagnostics.list(),
						});
					}
				}
				return out;
			} catch {
				return [];
			}
		};

		// A remote interactive session (Raycast) collects the batch form through the
		// provider instead of the Obsidian modal. Multi-select FILE answers stay as
		// arrays across this internal boundary so display labels are never parsed.
		const provider = choiceExecutor.promptProvider;
		let modal: OnePageInputModal | null = null;
		let values: Record<string, FormAnswer>;
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
		const fileInfoByKey = new Map<
			string,
			{
				options: string[];
				displayToValue: Map<string, string>;
				allowCustom: boolean;
				multiSelect: boolean;
			}
		>();
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
				const options = req.options ?? [];
				const displayOptions = req.displayOptions ?? options;
				fileInfoByKey.set(req.id, {
					options,
					displayToValue: new Map(
						options.map((value, index) => [
							(displayOptions[index] ?? value).trim(),
							value,
						]),
					),
					allowCustom: req.suggesterConfig?.allowCustomInput ?? false,
					multiSelect: req.suggesterConfig?.multiSelect ?? false,
				});
			}
			if (
				req.suggesterConfig?.multiSelect &&
				!req.id.startsWith(FILE_VARIABLE_PREFIX)
			) {
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
			const fileInfo = fileInfoByKey.get(k);
			if (fileInfo !== undefined) {
				const structuredPicks = modal?.fileSelections.get(k) ??
					(Array.isArray(v) ? v.map(String) : undefined);
				const rawPicks = structuredPicks ??
					(fileInfo.multiSelect
						? splitMultiSelectLabels(String(v), fileInfo.displayToValue).map(
								(label) => fileInfo.displayToValue.get(label) ?? label,
							)
						: [String(v)]);
				const orderedPicks = orderOnePageFilePicks(
					rawPicks,
					fileInfo.options,
					fileInfo.allowCustom,
				);
				const normalized = orderedPicks.map((value) =>
					canonicalizeOnePageFileValue(value, fileInfo.options),
				);
				choiceExecutor.variables.set(
					k,
					fileInfo.multiSelect ? normalized : (normalized[0] ?? ""),
				);
				return;
			}
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
			choiceExecutor.variables.set(k, v);
		});

		return true;
	} catch (error) {
		// Propagate an explicit cancellation/abort so the run stops instead of
		// continuing with the inputs missing. Both the native modal and a remote
		// provider signal a dismissal with UserCancelError, a MacroAbortError
		// subclass (#1577), so one check covers both.
		if (error instanceof MacroAbortError) {
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

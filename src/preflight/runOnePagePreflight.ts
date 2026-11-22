import type { App } from "obsidian";
import type { IChoiceExecutor } from "src/IChoiceExecutor";
import { FileNameDisplayFormatter } from "src/formatters/fileNameDisplayFormatter";
import type { PreflightPlugin } from "./collectChoiceRequirements";
import type IChoice from "src/types/choices/IChoice";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";
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
import type { FormAnswer } from "src/interactive/promptProvider";
import { QA_INTERNAL_DATE_ORIGIN } from "src/constants";
import type { RunClocks } from "src/types/dateOrigin";
import { dateOriginInput, planDateOrigin } from "src/utils/resolveDateOrigin";
import { buildDiscoveryFormPlan, storeDiscoveryFormAnswers } from "./discoveryFormPlan";
import { hasActivePreparedChoiceInputs } from "./preparedChoiceInputs";
import { optionValuesByLabel } from "./suggesterValueMapping";

/**
 * The clocks the run will format `{{DATE}}` with, resolved from the choice's
 * Which day setting and the form's own date field, so the file-name preview
 * shows the day about to be written rather than today (mirrors
 * `ChoiceExecutor.applyDateOrigin`).
 */
function previewRunClocks(
	choice: IChoice,
	choiceExecutor: IChoiceExecutor,
	values: Record<string, unknown>,
): RunClocks | undefined {
	const { setting, clocks } = dateOriginInput(choice, choiceExecutor);
	const plan = planDateOrigin({
		setting,
		clocks,
		variables: new Map<string, unknown>([
			...choiceExecutor.variables,
			...Object.entries(values),
		]),
		reservedSeed:
			setting?.kind === "ask" ? values[QA_INTERNAL_DATE_ORIGIN] : undefined,
	});
	if (plan.status !== "set") return clocks;
	return { now: choiceExecutor.clocks?.now ?? new Date(), date: plan.date };
}

/**
 * Reconstructs the picked labels from the ", "-joined suggester string. A split
 * on "," would break quoted-comma options ("a, b, c, d" must give
 * ["a, b", "c, d"]), so the longest known label is consumed at each position and
 * unmatched custom text falls back to a "," split.
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

export async function runOnePagePreflight(
	app: App,
	plugin: PreflightPlugin,
	choiceExecutor: IChoiceExecutor,
	choice: IChoice,
): Promise<boolean> {
	try {
		if (hasActivePreparedChoiceInputs(choiceExecutor, choice.id)) return false;
		const discoveryPlan = choiceExecutor.promptProvider
			? null
			: await buildDiscoveryFormPlan(app, plugin, choiceExecutor, choice);
		const requirements = discoveryPlan?.requirements ?? await collectChoiceRequirements(
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
		if (requirements.length === 0) return false;

		// Only prompt for unresolved inputs (variables missing or null). Empty string is intentional.
		const unresolved = getUnresolvedRequirements(
			requirements,
			choiceExecutor.variables,
		);

		if (unresolved.length === 0) return false; // Everything prefilled, skip modal

		const modalRequirements = unresolved.filter(
			(requirement) => !requirement.runtimeOnly || discoveryPlan?.config.fieldUsages.has(requirement.id),
		);
		if (modalRequirements.length === 0) return false;

		// Optional live preview of a couple of key outputs (best-effort)
		const computePreview = async (
			values: Record<string, unknown>,
		): Promise<PreviewRow[]> => {
			try {
				// FileNameDisplayFormatter, since this previews a file name: the
				// content formatter expands `\n` and resolves link tokens that
				// formatFileName leaves literal. {{TEMPLATE:}} resolves as at run
				// time; inline scripts and macros stay literal.
				const formatter = new FileNameDisplayFormatter(app, plugin);
				formatter.setRunClocks(
					previewRunClocks(choice, choiceExecutor, values),
				);
				const out: PreviewRow[] = [];
				if (choice.type === "Template") {
					const tmpl = choice as ITemplateChoice;
					if (tmpl.fileNameFormat?.enabled) {
						// Without a target folder `Notes/{{FOLDER}}/x` would preview
						// `Notes//x`; use the builder's neutral placeholder until the run
						// decides the folder.
						formatter.setTargetFolderPath(
							likelyTargetFolderPath(tmpl.folder) ?? "Folder/Name",
						);
						formatter.seedAnswers(values);
						out.push({
							label: "File name",
							text: await formatter.format(tmpl.fileNameFormat.format),
							// The user's real answers are seeded above, so this shows the
							// exact name about to fail.
							diagnostics: formatter.diagnostics.list(),
						});
					}
				}
				return out;
			} catch {
				return [];
			}
		};

		// A remote interactive session collects the batch form through the
		// provider instead of the Obsidian modal. Multi-select FILE answers stay as
		// arrays across this internal boundary so display labels are never parsed.
		const provider = choiceExecutor.promptProvider;
		// Nobody is at the window in a non-interactive run. Each prompt then
		// aborts and names the input to pass.
		if (!provider && choiceExecutor.interactive === false) return false;
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
				discoveryPlan?.config,
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
		for (const req of modal?.activeRequirements ?? modalRequirements) {
			if (req.id.startsWith(FILE_VARIABLE_PREFIX)) {
				const options = req.options ?? [];
				fileInfoByKey.set(req.id, {
					options,
					displayToValue: optionValuesByLabel(options, req.displayOptions, { trimLabels: true }),
					allowCustom: req.suggesterConfig?.allowCustomInput ?? false,
					multiSelect: req.suggesterConfig?.multiSelect ?? false,
				});
			}
			if (
				req.suggesterConfig?.multiSelect &&
				!req.id.startsWith(FILE_VARIABLE_PREFIX)
			) {
				multiInfoByKey.set(req.id, {
					emit: req.multiEmit ?? "text",
					allowCustom: req.suggesterConfig.allowCustomInput ?? false,
					displayToValue: optionValuesByLabel(req.options ?? [], req.displayOptions, { trimLabels: true }),
				});
			}
		}

		const answerVariables = discoveryPlan ? new Map<string, unknown>() : choiceExecutor.variables;
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
				answerVariables.set(
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
				answerVariables.set(
					k,
					multiInfo.emit === "linklist" ? items.map(toWikiLink) : items,
				);
				return;
			}
			answerVariables.set(k, v);
		});
		if (discoveryPlan && modal) {
			storeDiscoveryFormAnswers(choiceExecutor, discoveryPlan, answerVariables, modal.discoverySelections);
		}

		return true;
	} catch (error) {
		// Propagate a cancellation or abort so the run stops instead of continuing
		// with the inputs missing. Both the native modal and a remote provider
		// signal dismissal with UserCancelError, a MacroAbortError subclass.
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

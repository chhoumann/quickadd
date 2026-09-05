import type { App } from "obsidian";
import type { IChoiceExecutor } from "src/IChoiceExecutor";
import type QuickAdd from "src/main";
import type IChoice from "src/types/choices/IChoice";
import type IMacroChoice from "src/types/choices/IMacroChoice";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";
import { VALUE_SYNTAX } from "src/constants";
import type { TemplateNoteSelection } from "src/utils/templateNoteDiscovery";
import { shouldRunTemplateNoteDiscovery } from "src/utils/templateNoteDiscoveryEligibility";
import { commandListOf, isCommandLike } from "src/utils/macroUtils";
import { getActiveEditorSelection } from "src/utils/activeMarkdownEditor";
import { classifyStep, isCaptureChoice, isTemplateChoice } from "./macroCommandRole";
import { buildFormRoster, type FormRosterEntry } from "./macroFormRoster";
import { collectChoiceRequirements, getUnresolvedRequirements } from "./collectChoiceRequirements";
import type { FieldGroup, FieldRequirement } from "./RequirementCollector";
import { isDiscoveryMacro, markDiscoveryMacro, setPreparedChoiceInputs } from "./preparedChoiceInputs";

export interface DiscoveryNoteField {
	id: string;
	choice: ITemplateChoice;
	group: FieldGroup;
}

export interface DiscoveryFormConfig {
	notes: DiscoveryNoteField[];
	visibleWhenCreating: Map<string, string[]>;
}

interface DiscoveryFormStep {
	occurrenceId: string;
	choiceId: string;
	noteId: string | null;
	bindings: Map<string, string>;
}

export interface DiscoveryFormPlan {
	requirements: FieldRequirement[];
	config: DiscoveryFormConfig;
	steps: DiscoveryFormStep[];
}

function isMacroChoice(choice: IChoice): choice is IMacroChoice {
	return choice.type === "Macro";
}

function needsDiscovery(choice: IChoice, executor: IChoiceExecutor): choice is ITemplateChoice {
	return isTemplateChoice(choice) && shouldRunTemplateNoteDiscovery(
		choice,
		choice.fileNameFormat.enabled ? choice.fileNameFormat.format : VALUE_SYNTAX,
		executor.variables.get("value"),
	);
}

export async function buildDiscoveryFormPlan(
	app: App,
	plugin: QuickAdd,
	executor: IChoiceExecutor,
	choice: IChoice,
): Promise<DiscoveryFormPlan | null> {
	const resolveChoice = (id: string): IChoice | null => {
		try { return plugin.getChoiceById(id); }
		catch { return null; }
	};
	let entries: FormRosterEntry[];
	if (isMacroChoice(choice)) {
		for (const command of commandListOf(choice.macro?.commands)) {
			if (!isCommandLike(command)) continue;
			const role = classifyStep(command, resolveChoice);
			if (role.collect.kind === "scanChoice" && needsDiscovery(role.collect.choice, executor)) {
				markDiscoveryMacro(executor, choice.id);
			}
		}
		if (!isDiscoveryMacro(executor, choice.id)) return null;
		entries = buildFormRoster(resolveChoice, choice, executor.variables.get("value")).members;
	} else if (needsDiscovery(choice, executor)) {
		entries = [{ kind: "choice", choice, occurrenceId: choice.id, group: { id: choice.id, label: choice.name } }];
	} else {
		return null;
	}

	const requirements = new Map<string, FieldRequirement>();
	const consumers = new Map<string, Array<string | null>>();
	const config: DiscoveryFormConfig = { notes: [], visibleWhenCreating: new Map() };
	const steps: DiscoveryFormStep[] = [];
	if (isMacroChoice(choice)) {
		const macroWithoutCommands: IMacroChoice = { ...choice, macro: { ...choice.macro, commands: [] } };
		const macroRequirements = getUnresolvedRequirements(await collectChoiceRequirements(
			app, plugin, executor, macroWithoutCommands,
		), executor.variables);
		if (macroRequirements.length > 0) {
			const bindings = new Map<string, string>();
			for (const requirement of macroRequirements) {
				requirements.set(requirement.id, requirement);
				bindings.set(requirement.id, requirement.id);
				consumers.set(requirement.id, [null]);
			}
			steps.push({ occurrenceId: choice.id, choiceId: choice.id, noteId: null, bindings });
		}
	}
	for (const entry of entries) {
		const group = { ...entry.group, id: entry.occurrenceId };
		const child = entry.kind === "choice" ? entry.choice : null;
		const discovery = child !== null && needsDiscovery(child, executor) ? child : null;
		const noteId = discovery ? `__qa.note.${entry.occurrenceId}` : null;
		const step: DiscoveryFormStep = {
			occurrenceId: entry.occurrenceId,
			choiceId: child?.id ?? entry.occurrenceId,
			noteId,
			bindings: new Map(),
		};
		steps.push(step);
		if (discovery && noteId) {
			config.notes.push({ id: noteId, choice: discovery, group });
			requirements.set(noteId, { id: noteId, label: "Note", type: "text", pathContext: true, group });
		}
		const collectable = child ?? (isMacroChoice(choice) && entry.kind === "script"
			? { ...choice, macro: { ...choice.macro, commands: [entry.command] } }
			: null);
		if (!collectable) continue;
		const collected = getUnresolvedRequirements(await collectChoiceRequirements(
			app, plugin, executor, collectable,
			{ preloadedUserScripts: executor.preloadedUserScripts },
		), executor.variables);
		const captureSelection = child && isCaptureChoice(child) &&
			(child.useSelectionAsCaptureValue ?? plugin.settings.useSelectionAsCaptureValue ?? true)
			? getActiveEditorSelection(app)
			: "";
		for (const requirement of collected) {
			if (discovery && requirement.id === "value") continue;
			const id = requirement.id === "value" ? `__qa.value.${entry.occurrenceId}` : requirement.id;
			step.bindings.set(id, requirement.id);
			const existing = requirements.get(id);
			if (existing) {
				existing.optional = Boolean(existing.optional && requirement.optional);
				if (requirement.pathContext) existing.pathContext = true;
				if (requirement.runtimeOnly) existing.runtimeOnly = true;
			} else {
				requirements.set(id, {
					...requirement, id, group,
					...(requirement.id === "value" && captureSelection.trim()
						? { defaultValue: captureSelection }
						: {}),
				});
			}
			const owners = consumers.get(id) ?? [];
			owners.push(noteId);
			consumers.set(id, owners);
		}
	}
	for (const [id, owners] of consumers) {
		if (!owners.includes(null)) {
			config.visibleWhenCreating.set(id, owners.filter((owner): owner is string => owner !== null));
		}
	}
	return { requirements: [...requirements.values()], config, steps };
}

export function storeDiscoveryFormAnswers(
	executor: IChoiceExecutor,
	plan: DiscoveryFormPlan,
	answers: ReadonlyMap<string, unknown>,
	selections: ReadonlyMap<string, TemplateNoteSelection>,
): void {
	for (const step of plan.steps) {
		const discovery = step.noteId ? selections.get(step.noteId) ?? null : null;
		const values = new Map<string, unknown>();
		if (discovery?.kind !== "existing") {
			for (const [fieldId, variable] of step.bindings) {
				if (answers.has(fieldId)) values.set(variable, answers.get(fieldId));
			}
		}
		setPreparedChoiceInputs(executor, step.occurrenceId, { choiceId: step.choiceId, values, discovery });
	}
}

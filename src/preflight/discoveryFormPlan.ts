import { resolveChoiceFromPlugin } from "src/utils/resolveChoiceFromPlugin";
import type { App } from "obsidian";
import type { IChoiceExecutor } from "src/IChoiceExecutor";
import type QuickAdd from "src/main";
import type IChoice from "src/types/choices/IChoice";
import type IMacroChoice from "src/types/choices/IMacroChoice";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";
import { VALUE_SYNTAX } from "src/constants";
import type { TemplateNoteSelection } from "src/utils/templateNoteDiscovery";
import { shouldRunTemplateNoteDiscovery } from "src/utils/templateNoteDiscoveryEligibility";
import { getExistingNoteAction } from "src/template/fileExistsPolicy";
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
	visibleForNotes: Map<string, DiscoveryInputCondition[]>;
	fieldUsages: Map<string, DiscoveryFieldUsage[]>;
}

type DiscoveryFieldMetadata = FieldRequirement;

export type DiscoveryFieldUsage =
	| { kind: "always"; metadata: DiscoveryFieldMetadata }
	| {
		kind: "note";
		noteId: string;
		create: DiscoveryFieldMetadata;
		existing: DiscoveryFieldMetadata | null;
	};

export function resolveDiscoveryFieldRequirement(
	usages: readonly DiscoveryFieldUsage[],
	selections: ReadonlyMap<string, TemplateNoteSelection>,
): FieldRequirement | null {
	const active = usages.flatMap((usage) => {
		if (usage.kind === "always") return [usage.metadata];
		const selection = selections.get(usage.noteId);
		if (selection?.kind === "create") return [usage.create];
		return selection?.kind === "existing" && usage.existing ? [usage.existing] : [];
	});
	if (active.length === 0) return null;
	return {
		...active[0],
		optional: active.length > 0 && active.every((metadata) => metadata.optional),
		pathContext: active.some((metadata) => metadata.pathContext),
		runtimeOnly: active.some((metadata) => metadata.runtimeOnly),
	};
}

function fieldMetadata(requirement: FieldRequirement): DiscoveryFieldMetadata {
	return { ...requirement };
}

export interface DiscoveryInputCondition {
	noteId: string;
	includeExisting: boolean;
}

export function acceptsDiscoverySelection(
	condition: DiscoveryInputCondition,
	selections: ReadonlyMap<string, TemplateNoteSelection>,
): boolean {
	const selection = selections.get(condition.noteId);
	return selection?.kind === "create" || (condition.includeExisting && selection?.kind === "existing");
}

interface DiscoveryFormStep {
	occurrenceId: string;
	choiceId: string;
	noteId: string | null;
	bindings: Map<string, { variable: string; condition: DiscoveryInputCondition | null }>;
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
	const resolveChoice = (id: string) => resolveChoiceFromPlugin(plugin, id);
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
	const consumers = new Map<string, Array<DiscoveryInputCondition | null>>();
	const config: DiscoveryFormConfig = { notes: [], visibleForNotes: new Map(), fieldUsages: new Map() };
	const steps: DiscoveryFormStep[] = [];
	if (isMacroChoice(choice)) {
		const macroWithoutCommands: IMacroChoice = { ...choice, macro: { ...choice.macro, commands: [] } };
		const macroRequirements = getUnresolvedRequirements(await collectChoiceRequirements(
			app, plugin, executor, macroWithoutCommands,
		), executor.variables);
		if (macroRequirements.length > 0) {
			const bindings: DiscoveryFormStep["bindings"] = new Map();
			for (const requirement of macroRequirements) {
				requirements.set(requirement.id, requirement);
				bindings.set(requirement.id, { variable: requirement.id, condition: null });
				consumers.set(requirement.id, [null]);
				config.fieldUsages.set(requirement.id, [{ kind: "always", metadata: fieldMetadata(requirement) }]);
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
		const existingNoteInputs = new Map<string, FieldRequirement>();
		if (discovery && getExistingNoteAction(discovery.existingNoteAction) !== "open") {
			const existingTarget: ITemplateChoice = {
				...discovery,
				fileNameFormat: { enabled: false, format: "" },
				folder: { ...discovery.folder, enabled: false },
			};
			for (const requirement of await collectChoiceRequirements(app, plugin, executor, existingTarget)) {
				existingNoteInputs.set(requirement.id, requirement);
			}
		}
		const captureSelection = child && isCaptureChoice(child) &&
			(child.useSelectionAsCaptureValue ?? plugin.settings.useSelectionAsCaptureValue ?? true)
			? getActiveEditorSelection(app)
			: "";
		for (const requirement of collected) {
			if (discovery && requirement.id === "value") continue;
			const id = requirement.id === "value" ? `__qa.value.${entry.occurrenceId}` : requirement.id;
			const condition = noteId ? { noteId, includeExisting: existingNoteInputs.has(requirement.id) } : null;
			step.bindings.set(id, { variable: requirement.id, condition });
			const usages = config.fieldUsages.get(id) ?? [];
			const existingNoteRequirement = existingNoteInputs.get(requirement.id);
			const field: FieldRequirement = {
				...requirement, id, group,
				...(requirement.id === "value" && captureSelection.trim()
					? { defaultValue: captureSelection } : {}),
			};
			usages.push(noteId ? {
				kind: "note", noteId, create: fieldMetadata(field),
				existing: existingNoteRequirement ? fieldMetadata(existingNoteRequirement) : null,
			} : { kind: "always", metadata: fieldMetadata(field) });
			config.fieldUsages.set(id, usages);
			const existing = requirements.get(id);
			if (existing) {
				existing.optional = Boolean(existing.optional && requirement.optional);
				if (requirement.pathContext) existing.pathContext = true;
				if (requirement.runtimeOnly) existing.runtimeOnly = true;
			} else {
				requirements.set(id, field);
			}
			const owners = consumers.get(id) ?? [];
			owners.push(condition);
			consumers.set(id, owners);
		}
	}
	for (const [id, owners] of consumers) {
		if (!owners.includes(null)) {
			config.visibleForNotes.set(id, owners.filter((owner): owner is DiscoveryInputCondition => owner !== null));
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
		for (const [fieldId, { variable, condition }] of step.bindings) {
			if ((!condition || acceptsDiscoverySelection(condition, selections)) && answers.has(fieldId)) {
				values.set(variable, answers.get(fieldId));
			}
		}
		setPreparedChoiceInputs(executor, step.occurrenceId, { choiceId: step.choiceId, values, discovery });
	}
}

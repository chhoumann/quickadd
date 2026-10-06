import { FIELD_VARIABLE_PREFIX, VALUE_SYNTAX } from "../constants";
import { classifyCaptureTargetScope } from "../engine/helpers/captureTargetScope";
import type { PromptScopeKind } from "../formatters/promptScope";
import { captureTargetKeyFor, isCaptureTargetKey } from "../preflight/captureTargetKey";
import {
	type ReadTemplate,
	scanContentWithTemplateIncludes,
	scanTemplateBody,
} from "../preflight/collectChoiceRequirements";
import { type FieldRequirement, RequirementCollector } from "../preflight/RequirementCollector";
import type QuickAdd from "../main";
import type { QuickAddSettings } from "../settings";
import type { Action, AddToNoteStep, CreateNoteStep } from "./model";
import { templaterPrompts } from "./templater";

export type InputKind = "value" | "date" | "field" | "file" | "math" | "pick";

export type InputLocation = "format" | "fileName" | "folder" | "target" | "templatePath" | "template file";

/** Something a run of an action asks for, as its placeholders say before any override. */
export interface ActionInput {
	/** The variable the answer is stored under, which also keys the action's override. */
	name: string;
	kind: InputKind;
	label?: string;
	type?: string;
	optional: boolean;
	/** Where it first appears; `step` is the index in the action's steps. */
	definedIn: { step: number; where: InputLocation; path?: string };
	/** The index of an earlier step that may set it, so the run need not ask. */
	providedBy?: number;
	/** Set when Templater asks it, after QuickAdd's own inputs; its name is its label. */
	askedBy?: "templater";
}

/**
 * The inputs a run of `action` asks for, in the order they first appear: step
 * by step, as the run asks (the template path, folder and file name of a new
 * note; the target and format of an addition; then the template file). Only
 * steps' own text is read, never a script.
 *
 * A Run script step may set any variable, so an input that first appears
 * after one is marked as provided by it, and so is an input named like the
 * output variable of an earlier AI step. An input that first appears before
 * either is asked for, as a script cannot answer what was already asked.
 *
 * A template file's Templater prompts follow that file's own inputs, as
 * Templater asks them once the note exists.
 */
export async function listInputs(
	action: Action,
	readTemplate: ReadTemplate,
	isFolder: (path: string) => boolean = () => false,
	settings?: Pick<QuickAddSettings, "globalVariables" | "inputPrompt">,
): Promise<ActionInput[]> {
	// The settings are what a global variable expands from.
	const collector = new RequirementCollector(undefined, settings && { settings: settings as QuickAdd["settings"] });
	const inputs: ActionInput[] = [];
	let lastScript: number | undefined;
	const aiOutputs = new Map<string, number>();

	const record = (step: number, where: InputLocation, path?: string) => {
		const known = new Set(inputs.filter((input) => !input.askedBy).map((input) => input.name));
		for (const requirement of collector.requirements.values()) {
			if (known.has(requirement.id)) continue;
			const providers = [aiOutputs.get(requirement.id), lastScript].filter((step) => step !== undefined);
			inputs.push({
				name: requirement.id,
				...describe(requirement),
				optional: requirement.optional ?? false,
				definedIn: { step, where, ...(path === undefined ? {} : { path }) },
				...(providers.length === 0 ? {} : { providedBy: Math.max(...providers) }),
			});
		}
	};
	const scan = async (step: number, where: InputLocation, text: string, scope: PromptScopeKind) => {
		await scanContentWithTemplateIncludes(readTemplate, collector, text, scope);
		record(step, where);
	};

	for (const [index, step] of action.steps.entries()) {
		if (step.type === "createNote") await scanCreateNote(index, step);
		else if (step.type === "addToNote") await scanAddToNote(index, step);
		else if (step.type === "runScript") lastScript = index;
		else if (step.type === "ai" && step.outputVariableName) aiOutputs.set(step.outputVariableName, index);
	}
	return inputs;

	async function scanCreateNote(index: number, step: CreateNoteStep) {
		await scanTemplatePath(index, step.templatePath);
		if (step.location.mode === "folders") {
			for (const folder of step.location.folders) await scan(index, "folder", folder, "folder");
		}
		await scan(index, "fileName", step.fileNameFormat.enabled ? step.fileNameFormat.format : VALUE_SYNTAX, "noteTitle");
		await scanTemplateFile(index, step.templatePath);
	}

	async function scanAddToNote(index: number, step: AddToNoteStep) {
		await scan(index, "target", step.captureTo, "captureTarget");
		const property = step.propertyCapture?.property;
		if (property?.kind === "named") await scan(index, "target", property.format, "propertyName");
		if (step.position === "after" && !step.insertAfter.promptHeading) {
			await scan(index, "target", step.insertAfter.after, "lineTarget");
		}
		if (step.position === "before" && step.insertBefore) {
			await scan(index, "target", step.insertBefore.before, "lineTarget");
		}
		const scope = step.captureToActiveFile
			? null
			: classifyCaptureTargetScope({ isFolder, markdownFileExists: () => false }, step.captureTo, false);
		if (scope) {
			const name = captureTargetKeyFor(action.id);
			collector.requirements.set(name, { id: name, label: "Select capture target file", type: "file-picker" });
			record(index, "target");
		}
		await scan(
			index,
			"format",
			step.format.enabled ? step.format.format : VALUE_SYNTAX,
			step.propertyCapture ? "propertyValue" : "captureText",
		);
		const create = step.createFileIfItDoesntExist;
		if (create.enabled && create.createWithTemplate && create.template) {
			await scanTemplatePath(index, create.template);
			await scanTemplateFile(index, create.template);
		}
	}

	/** The path itself is asked for first, as the run formats it before anything else. */
	async function scanTemplatePath(index: number, path: string) {
		if (!path) return;
		await collector.scanString(path, true, "templatePath");
		record(index, "templatePath");
	}

	async function scanTemplateFile(index: number, path: string) {
		if (!path) return;
		await scanTemplateBody(readTemplate, collector, path);
		record(index, "template file", path);
		for (const { label } of templaterPrompts((await readTemplate(path)) ?? "")) {
			if (inputs.some((input) => input.askedBy === "templater" && input.name === label)) continue;
			inputs.push({
				name: label,
				kind: "value",
				label,
				optional: false,
				definedIn: { step: index, where: "template file", path },
				askedBy: "templater",
			});
		}
	}
}

function describe(requirement: FieldRequirement): Pick<ActionInput, "kind" | "label" | "type"> {
	const { id, label } = requirement;
	if (isCaptureTargetKey(id)) return { kind: "pick", label };
	if (id === "mvalue") return { kind: "math", label };
	if (id.startsWith(FIELD_VARIABLE_PREFIX) && requirement.type === "field-suggest") return { kind: "field", label };
	if (requirement.type === "date") return { kind: "date", label };
	if (requirement.type === "file-picker") return { kind: "file", label };
	return { kind: "value", label, type: requirement.type };
}

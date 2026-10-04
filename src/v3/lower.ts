import type { FolderMode } from "../gui/ChoiceBuilder/folderMode";
import { applyFolderMode } from "../gui/ChoiceBuilder/folderMode";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type { ChoiceType } from "../types/choices/choiceType";
import { CommandType } from "../types/macros/CommandType";
import type { ICommand } from "../types/macros/ICommand";
import { normalizeFileOpening } from "../utils/fileOpeningDefaults";
import type {
	Action,
	ActionNode,
	LinkStep,
	NoteLocation,
	OpenStep,
	Step,
	TemplaterStep,
	WriteStep,
} from "./model";
import { RUN_NOTE } from "./model";

/**
 * A write step with the steps that v2 stores as settings on the same choice:
 * Templater over the whole note (Capture only), the link and the open, each
 * on the run note and in the order the v2 engines run them.
 */
export interface WriteGroup {
	write: WriteStep;
	templater?: TemplaterStep;
	link?: LinkStep;
	open?: OpenStep;
	/** Index of the first step after the group. */
	next: number;
}

/**
 * Reads the write at `start` with the follow-ups migration derived from the
 * same v2 choice, which carry the write's id with a suffix. A step on the run
 * note under any other id is the user's own and stays a step of its own.
 */
export function readWriteGroup(steps: Step[], start: number): WriteGroup | null {
	const write = steps[start];
	if (write?.type !== "createNote" && write?.type !== "addToNote") return null;
	const group: WriteGroup = { write, next: start + 1 };
	const at = () => steps[group.next];
	const step = at();
	if (write.type === "addToNote" && step?.type === "templater" && step.note === RUN_NOTE && step.id === `${write.id}:templater`) {
		group.templater = step;
		group.next++;
	}
	const link = at();
	if (link?.type === "link" && link.link === RUN_NOTE && link.id === `${write.id}:link`) {
		group.link = link;
		group.next++;
	}
	const open = at();
	if (open?.type === "open" && open.note === RUN_NOTE && open.id === `${write.id}:open`) {
		group.open = open;
		group.next++;
	}
	return group;
}

/** The write group an action consists of, when it is nothing else. */
export function compactGroup(action: Action): WriteGroup | null {
	const group = readWriteGroup(action.steps, 0);
	return group && group.next === action.steps.length ? group : null;
}

/** The v2 type a node lowers to, and the type `quickadd:list` and {{MACRO:}} see. */
export function legacyTypeOf(node: ActionNode): ChoiceType {
	if (node.kind === "folder") return "Multi";
	if (node.provenance?.migratedFrom === "Macro") return "Macro";
	const group = compactGroup(node);
	if (!group) return "Macro";
	return group.write.type === "createNote" ? "Template" : "Capture";
}

/** The v2 choice the existing engines run for `node`. */
export function lowerNode(node: ActionNode): IChoice {
	if (node.kind === "folder") {
		const multi: IMultiChoice = {
			id: node.id,
			name: node.name,
			type: "Multi",
			command: node.command,
			icon: node.icon,
			collapsed: node.collapsed as boolean,
			placeholder: node.placeholder,
			choices: node.items.map(lowerNode),
		};
		return multi;
	}
	const shell = {
		id: node.id,
		name: node.name,
		command: node.show.command,
		icon: node.icon,
		dateOrigin: node.dateOrigin,
		onePageInput: node.onePageInput,
		pickDayCommand: node.show.pickDayCommand,
	};
	const type = legacyTypeOf(node);
	if (type !== "Macro") return lowerGroup(compactGroup(node) as WriteGroup, shell);
	const macro: IMacroChoice = {
		...shell,
		type: "Macro",
		runOnStartup: node.show.runOnStartup as boolean,
		macro: { id: node.id, name: node.name, commands: lowerSteps(node.steps) },
	};
	return macro;
}

type Shell = Pick<IChoice, "id" | "name" | "command"> & Partial<IChoice>;

function lowerGroup(group: WriteGroup, shell: Shell): ITemplateChoice | ICaptureChoice {
	const { write, link, open } = group;
	const shared = {
		...shell,
		appendLink: link?.insert ? { enabled: true, ...link.insert } : false,
		copyLinkToClipboard: !!link?.copyToClipboard,
		openFile: !!open,
		fileOpening: open
			? { location: open.location, direction: open.direction, mode: open.mode, focus: open.focus }
			: normalizeFileOpening(),
	};
	if (write.type === "createNote") {
		const template: ITemplateChoice = {
			...shared,
			type: "Template",
			templatePath: write.templatePath,
			folder: applyFolderMode(
				{
					enabled: false,
					folders: write.location.folders,
					chooseWhenCreatingNote: false,
					createInSameFolderAsActiveFile: false,
					chooseFromSubfolders: write.location.includeSubfolders,
				},
				V2_FOLDER_MODE[write.location.mode],
			),
			fileNameFormat: write.fileNameFormat,
			discoverExistingNotesBeforeCreate: write.discoverExistingNotesBeforeCreate,
			existingNoteAction: write.existingNoteAction,
			fileExistsBehavior: write.fileExistsBehavior,
		};
		return template;
	}

	const { position, captureToActiveFile: active } = write;
	if (!active && (position === "cursor" || position === "newLineAbove" || position === "newLineBelow")) {
		throw new Error(`Step ${write.id} writes '${position}', which needs the active note.`);
	}
	const capture: ICaptureChoice = {
		...shared,
		type: "Capture",
		captureTo: write.captureTo,
		captureToActiveFile: active,
		captureToCanvasNodeId: write.captureToCanvasNodeId,
		activeFileWritePosition:
			active && position === "top" ? "top" : active && position === "bottom" ? "bottom" : "cursor",
		prepend: !active && position === "bottom",
		insertAfter: { ...write.insertAfter, enabled: position === "after" },
		insertBefore: write.insertBefore && { ...write.insertBefore, enabled: position === "before" },
		newLineCapture: {
			enabled: position === "newLineAbove" || position === "newLineBelow",
			direction: position === "newLineAbove" ? "above" : "below",
		},
		propertyCapture: write.propertyCapture,
		format: write.format,
		createFileIfItDoesntExist: write.createFileIfItDoesntExist,
		useSelectionAsCaptureValue: write.useSelectionAsCaptureValue,
		task: write.task,
		eachLine: write.eachLine,
		templater: { afterCapture: group.templater ? "wholeFile" : "none" },
	};
	return capture;
}

const V2_FOLDER_MODE: Record<NoteLocation["mode"], FolderMode> = {
	default: "obsidian-default",
	folders: "specified",
	activeFolder: "active-file",
	ask: "prompt",
};

function lowerSteps(steps: Step[]): ICommand[] {
	const commands: ICommand[] = [];
	for (let index = 0; index < steps.length; ) {
		const group = readWriteGroup(steps, index);
		if (group) {
			const choice = lowerGroup(group, { id: group.write.id, name: group.write.name ?? "", command: false });
			commands.push({ id: `${choice.id}:nested`, name: choice.name, type: CommandType.NestedChoice, choice } as ICommand);
			index = group.next;
			continue;
		}
		commands.push(lowerStep(steps[index]));
		index++;
	}
	return commands;
}

function lowerStep(step: Step): ICommand {
	const base = { id: step.id, name: step.name as string };
	switch (step.type) {
		case "runCommand":
			return step.command.kind === "obsidian"
				? { ...base, type: CommandType.Obsidian, commandId: step.command.commandId } as ICommand
				: { ...base, type: CommandType.EditorCommand, editorCommandType: step.command.editorCommandType } as ICommand;
		case "runScript":
			return { ...base, type: CommandType.UserScript, path: step.path, settings: step.settings } as ICommand;
		case "runAction":
			return { ...base, type: CommandType.Choice, choiceId: step.actionId } as ICommand;
		case "wait":
			return { ...base, type: CommandType.Wait, time: step.time } as ICommand;
		case "ai":
			return { ...step, type: CommandType.AIAssistant } as ICommand;
		case "open":
			// The v2 command formats its path, so {{NOTE}} opens the run note.
			if (step.mode !== "default") break;
			return {
				...base,
				type: CommandType.OpenFile,
				filePath: step.note,
				location: step.location,
				...(step.location === "split" ? { direction: step.direction } : {}),
				focus: step.focus,
			} as ICommand;
		case "if":
			return {
				...base,
				type: CommandType.Conditional,
				condition: step.condition,
				thenCommands: lowerSteps(step.thenSteps),
				elseCommands: lowerSteps(step.elseSteps),
			} as ICommand;
		case "inlineAction":
			return { ...base, type: CommandType.NestedChoice, choice: lowerNode(step.node) } as ICommand;
		case "unknown":
			return step.raw as ICommand;
		default:
			break;
	}
	throw new Error(`Step ${step.id} (${step.type}) has no v2 encoding here.`);
}

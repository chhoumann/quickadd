import { getWritePosition } from "../engine/captureAction";
import { buildOpenFileOptions } from "../engine/helpers/openFileOptions";
import { deriveFolderMode } from "../gui/ChoiceBuilder/folderMode";
import { walkAllCommandsInSettings, walkChoiceTree } from "../migrations/helpers/choice-traversal";
import { normalizeImportedChoice } from "../services/packageChoiceImport";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import { normalizeAppendLinkOptions } from "../types/linkPlacement";
import { CommandType } from "../types/macros/CommandType";
import type { IConditionalCommand } from "../types/macros/Conditional/IConditionalCommand";
import type { IEditorCommand } from "../types/macros/EditorCommands/IEditorCommand";
import type { IChoiceCommand } from "../types/macros/IChoiceCommand";
import type { ICommand } from "../types/macros/ICommand";
import type { IObsidianCommand } from "../types/macros/IObsidianCommand";
import type { IUserScript } from "../types/macros/IUserScript";
import type { IAIAssistantCommand } from "../types/macros/QuickCommands/IAIAssistantCommand";
import type { INestedChoiceCommand } from "../types/macros/QuickCommands/INestedChoiceCommand";
import type { IOpenFileCommand } from "../types/macros/QuickCommands/IOpenFileCommand";
import type { IWaitCommand } from "../types/macros/QuickCommands/IWaitCommand";
import { normalizeFileOpening } from "../utils/fileOpeningDefaults";
import { isUnreadableList } from "../utils/persistedContainers";
import { macroCommandsValueOf } from "../utils/macroUtils";
import { templaterRerunAfter } from "../utils/templaterRerunDeprecation";
import type {
	Action,
	ActionNode,
	AddToNoteStep,
	CreateNoteStep,
	Folder,
	NoteLocation,
	Step,
	WritePosition,
} from "./model";
import { RUN_NOTE } from "./model";
import { summarize } from "./summary";

/** Something the migration decided for one choice that a person should be able to see. */
export interface MigrationNote {
	/** The action or folder whose row the note belongs under. */
	nodeId?: string;
	choiceId: string;
	choiceName: string;
	kind:
		| "inlined"
		| "keptNested"
		| "writePositionConflict"
		| "folderModeConflict"
		| "dropped"
		| "templaterRerun"
		| "wholeFileTemplater"
		| "unknownCommand"
		| "unknownKey"
		| "danglingRunAction";
	detail: string;
}

type Notes = MigrationNote[];

/**
 * Converts one v2 choice, with everything below it, into a v3 node. Pure: no
 * I/O, no clock, no new ids, and the input is not modified. The input is first
 * brought to the shape the engines read (the same normalization package import
 * applies), so data.json from any 2.x version migrates the same way.
 */
export function migrateChoice(choice: IChoice): { node: ActionNode; notes: Notes } {
	// A copy of what data.json would hold. Choices the builder made are class
	// instances, and some hold functions that structuredClone cannot copy.
	const copy = JSON.parse(JSON.stringify(choice)) as IChoice;
	identifyNestedChoices(copy);
	walkChoiceTree(copy, normalizeImportedChoice);
	const notes: Notes = [];
	const node = migrateNode(copy, notes);
	// A folder's children stamped theirs already.
	for (const entry of notes) entry.nodeId ??= node.id;
	return { node, notes };
}

/**
 * Old versions saved some nested choices without an id. Normalizing would give
 * them a random one, so name them after their step instead: migration must
 * give the same result on every device.
 */
export function identifyNestedChoices(choice: IChoice): void {
	walkAllCommandsInSettings({ choices: [choice] }, (command) => {
		const nested = (command as INestedChoiceCommand).choice;
		if (command.type === CommandType.NestedChoice && isObject(nested) && typeof nested.id !== "string") {
			nested.id = `${command.id}:choice`;
		}
	});
}

const CHOICE_KEYS = ["id", "name", "type", "command", "dateOrigin", "pickDayCommand", "onePageInput", "icon"];
// openFileInNewTab and openFileInMode are the pre-fileOpening settings, which
// normalizing converts; they are dropped, not unknown.
const WRITE_KEYS = [...CHOICE_KEYS, "appendLink", "copyLinkToClipboard", "openFile", "fileOpening", "openFileInNewTab", "openFileInMode"];
const COMMAND_KEYS = ["id", "name", "type"];

/**
 * The keys a v2 choice of each type holds. Migration drops any other key, such
 * as a setting an older QuickAdd wrote and no longer reads, and lists it in the
 * report; the data.v2.json snapshot keeps it.
 */
export const V2_CHOICE_KEYS: Record<string, ReadonlySet<string>> = {
	Template: new Set([...WRITE_KEYS, "templatePath", "folder", "fileNameFormat", "discoverExistingNotesBeforeCreate", "existingNoteAction", "fileExistsBehavior"]),
	Capture: new Set([
		...WRITE_KEYS, "propertyCapture", "captureTo", "captureToActiveFile", "captureToCanvasNodeId", "activeFileWritePosition",
		"createFileIfItDoesntExist", "format", "useSelectionAsCaptureValue", "prepend", "task", "eachLine", "insertAfter",
		"insertBefore", "newLineCapture", "templater",
	]),
	Macro: new Set([...CHOICE_KEYS, "macro", "runOnStartup"]),
	Multi: new Set([...CHOICE_KEYS, "choices", "collapsed", "placeholder"]),
};

/** The same for macro commands. An AI step keeps every key, so it is not listed. */
export const V2_COMMAND_KEYS: Record<string, ReadonlySet<string>> = {
	[CommandType.Obsidian]: new Set([...COMMAND_KEYS, "commandId"]),
	[CommandType.EditorCommand]: new Set([...COMMAND_KEYS, "editorCommandType"]),
	[CommandType.UserScript]: new Set([...COMMAND_KEYS, "path", "settings"]),
	[CommandType.Choice]: new Set([...COMMAND_KEYS, "choiceId"]),
	[CommandType.Wait]: new Set([...COMMAND_KEYS, "time"]),
	[CommandType.OpenFile]: new Set([...COMMAND_KEYS, "filePath", "openInNewTab", "direction", "location", "focus"]),
	[CommandType.Conditional]: new Set([...COMMAND_KEYS, "condition", "thenCommands", "elseCommands"]),
	[CommandType.NestedChoice]: new Set([...COMMAND_KEYS, "choice"]),
};

function noteUnknownKeys(value: object, known: ReadonlySet<string> | undefined, host: IChoice, where: string, notes: Notes) {
	if (!known) return;
	const unknown = Object.keys(value).filter((key) => !known.has(key));
	if (unknown.length > 0) note(notes, host, "unknownKey", `${where}${unknown.map((key) => `'${key}'`).join(", ")}`);
}

/**
 * Replaces `choices` with `actions`. Settings that already hold `actions` and
 * no `choices` come back unchanged, so running it twice is a no-op.
 */
export function migrateSettingsV2<S extends object>(
	settings: S,
): Omit<S, "choices"> & { actions: ActionNode[] } {
	if (!("choices" in settings) && "actions" in settings) {
		return settings as unknown as Omit<S, "choices"> & { actions: ActionNode[] };
	}
	const { choices, ...rest } = settings as S & { choices?: unknown };
	return { ...rest, actions: migrateChoiceList(choices).nodes };
}

function migrateChoiceList(value: unknown): { nodes: ActionNode[]; notes: Notes } {
	const nodes: ActionNode[] = [];
	const notes: Notes = [];
	for (const choice of readList(value, "choice list")) {
		if (!isObject(choice)) continue;
		const result = migrateChoice(choice as IChoice);
		nodes.push(result.node);
		notes.push(...result.notes);
	}
	return { nodes, notes };
}

export interface MigrationReport {
	rows: {
		path: string;
		id: string;
		name: string;
		kind: "action" | "folder";
		migratedFrom?: string;
		summary?: string;
		steps?: number;
	}[];
	/** Names used by more than one action or folder; `choice=` URIs, the CLI and {{MACRO:}} pick the first. */
	duplicateNames: string[];
	notes: MigrationNote[];
}

/** The migration report, recomputed from v2 settings. Templater detection in template files is not included. */
export function buildReport(settings: { choices?: unknown }): MigrationReport {
	const { nodes, notes } = migrateChoiceList(settings.choices);
	const rows: MigrationReport["rows"] = [];
	const counts = new Map<string, number>();
	const names = new Map<string, string>();
	const index = (node: ActionNode) => {
		names.set(node.id, node.name);
		if (node.kind === "folder") node.items.forEach(index);
	};
	nodes.forEach(index);
	const visit = (node: ActionNode, parents: string[]) => {
		const path = [...parents, node.name].join(" / ");
		counts.set(node.name, (counts.get(node.name) ?? 0) + 1);
		if (node.kind === "folder") {
			rows.push({ path, id: node.id, name: node.name, kind: "folder" });
			for (const item of node.items) visit(item, [...parents, node.name]);
			return;
		}
		rows.push({
			path,
			id: node.id,
			name: node.name,
			kind: "action",
			migratedFrom: node.provenance?.migratedFrom,
			summary: summarize(node, (id) => names.get(id)),
			steps: node.steps.length,
		});
	};
	for (const node of nodes) visit(node, []);
	const dangling = (steps: Step[], host: ActionNode) => {
		for (const step of steps) {
			if (step.type === "runAction" && !names.has(step.actionId)) {
				notes.push({ nodeId: host.id, choiceId: host.id, choiceName: host.name, kind: "danglingRunAction", detail: `step ${step.id} runs missing ${step.actionId}` });
			}
			if (step.type === "if") {
				dangling(step.thenSteps, host);
				dangling(step.elseSteps, host);
			}
			if (step.type === "inlineAction" && step.node.kind === "action") dangling(step.node.steps, host);
		}
	};
	const walk = (node: ActionNode) => {
		if (node.kind === "folder") node.items.forEach(walk);
		else dangling(node.steps, node);
	};
	nodes.forEach(walk);
	const duplicateNames = [...counts].filter(([, count]) => count > 1).map(([name]) => name);
	return { rows, duplicateNames, notes };
}

function migrateNode(choice: IChoice, notes: Notes): ActionNode {
	noteUnknownKeys(choice, V2_CHOICE_KEYS[choice.type], choice, "", notes);
	switch (choice.type) {
		case "Multi":
			return migrateFolder(choice as IMultiChoice, notes);
		case "Template":
		case "Capture":
			return {
				...actionShell(choice),
				steps: writeGroup(choice as ITemplateChoice | ICaptureChoice, choice.id, undefined, notes),
			};
		case "Macro": {
			const macro = choice as IMacroChoice;
			const action = actionShell(choice);
			if (macro.runOnStartup !== undefined) action.show.runOnStartup = macro.runOnStartup;
			return {
				...action,
				steps: migrateCommands(macroCommandsValueOf(macro.macro), choice, notes),
			};
		}
		default:
			throw new Error(`Cannot migrate choice '${choice.name}': unknown type '${String(choice.type)}'.`);
	}
}

function migrateFolder(multi: IMultiChoice, notes: Notes): Folder {
	const dropped = (["dateOrigin", "pickDayCommand", "onePageInput"] as const).filter(
		(key) => multi[key] !== undefined,
	);
	if (dropped.length > 0) note(notes, multi, "dropped", `folder ${dropped.join(", ")}`);
	const children = migrateChoiceList(multi.choices);
	notes.push(...children.notes);
	return withoutUndefined({
		kind: "folder",
		id: multi.id,
		name: multi.name,
		icon: multi.icon,
		command: multi.command,
		collapsed: multi.collapsed,
		placeholder: multi.placeholder,
		items: children.nodes,
	});
}

function actionShell(choice: IChoice): Action {
	return withoutUndefined({
		kind: "action",
		id: choice.id,
		name: choice.name,
		icon: choice.icon,
		steps: [],
		show: withoutUndefined({ command: choice.command, pickDayCommand: choice.pickDayCommand }),
		dateOrigin: choice.dateOrigin,
		onePageInput: choice.onePageInput,
		provenance: { migratedFrom: choice.type as "Template" | "Capture" | "Macro" },
	});
}

/**
 * A Template or Capture as its compact step list: the write, then the
 * Templater pass, the link and the open, in the order the v2 engines run them.
 */
function writeGroup(
	choice: ITemplateChoice | ICaptureChoice,
	stepId: string,
	stepName: string | undefined,
	notes: Notes,
): Step[] {
	const steps: Step[] = [
		choice.type === "Template"
			? createNoteStep(choice as ITemplateChoice, stepId, stepName, notes)
			: addToNoteStep(choice as ICaptureChoice, stepId, stepName, notes),
	];
	if (choice.type === "Capture" && (choice as ICaptureChoice).templater?.afterCapture === "wholeFile") {
		note(notes, choice, "wholeFileTemplater", "Templater over the whole note became a Templater step");
		steps.push({ id: `${stepId}:templater`, type: "templater", note: RUN_NOTE });
	}

	const link = normalizeAppendLinkOptions(choice.appendLink);
	if (!link.enabled && typeof choice.appendLink === "object") {
		note(notes, choice, "dropped", "link options behind a switched-off link setting");
	}
	if (link.enabled || choice.copyLinkToClipboard) {
		steps.push(withoutUndefined({
			id: `${stepId}:link`,
			type: "link",
			link: RUN_NOTE,
			insert: link.enabled ? withoutUndefined(withoutEnabled(link)) : undefined,
			copyToClipboard: choice.copyLinkToClipboard || undefined,
		}));
	}

	const opening = normalizeFileOpening(choice.fileOpening);
	if (choice.openFile) {
		steps.push({ id: `${stepId}:open`, type: "open", note: RUN_NOTE, ...opening });
	} else if (JSON.stringify(opening) !== JSON.stringify(normalizeFileOpening())) {
		note(notes, choice, "dropped", "open settings behind a switched-off open setting");
	}
	return steps;
}

const FOLDER_MODE = {
	"obsidian-default": "default",
	specified: "folders",
	"active-file": "activeFolder",
	prompt: "ask",
} as const;

function createNoteStep(
	choice: ITemplateChoice,
	id: string,
	name: string | undefined,
	notes: Notes,
): CreateNoteStep {
	const folder = choice.folder;
	const modeFlags = [folder.chooseWhenCreatingNote, folder.createInSameFolderAsActiveFile].filter(Boolean).length;
	if (folder.enabled ? modeFlags > 1 : modeFlags > 0) {
		note(notes, choice, "folderModeConflict", `folder settings resolve to '${deriveFolderMode(folder)}'`);
	}
	const location: NoteLocation = {
		mode: FOLDER_MODE[deriveFolderMode(folder)],
		folders: folder.folders,
		includeSubfolders: folder.chooseFromSubfolders,
	};
	return withoutUndefined({
		id,
		name,
		type: "createNote",
		templatePath: choice.templatePath,
		fileNameFormat: choice.fileNameFormat,
		location,
		fileExistsBehavior: choice.fileExistsBehavior,
		discoverExistingNotesBeforeCreate: choice.discoverExistingNotesBeforeCreate,
		existingNoteAction: choice.existingNoteAction,
	});
}

function addToNoteStep(
	choice: ICaptureChoice,
	id: string,
	name: string | undefined,
	notes: Notes,
): AddToNoteStep {
	const active = choice.captureToActiveFile;
	const v2Position = getWritePosition(choice);
	const position: WritePosition =
		v2Position === "activeTop" ? "top" : active && v2Position === "top" ? "cursor" : v2Position;

	const switches = [
		choice.prepend,
		choice.insertAfter.enabled,
		choice.insertBefore?.enabled,
		active && choice.newLineCapture?.enabled,
		choice.propertyCapture !== undefined,
		active && choice.activeFileWritePosition !== "cursor",
	].filter(Boolean).length;
	if (switches > 1) note(notes, choice, "writePositionConflict", `write settings resolve to '${position}'`);
	if (!active && choice.activeFileWritePosition !== "cursor") {
		note(notes, choice, "dropped", `active-note write position '${choice.activeFileWritePosition}' on a note target`);
	}
	if (!choice.newLineCapture?.enabled && choice.newLineCapture?.direction === "above") {
		note(notes, choice, "dropped", "new-line direction behind a switched-off new-line setting");
	}

	return withoutUndefined({
		id,
		name,
		type: "addToNote",
		captureTo: choice.captureTo,
		captureToActiveFile: active,
		captureToCanvasNodeId: choice.captureToCanvasNodeId,
		position,
		format: choice.format,
		insertAfter: withoutEnabled(choice.insertAfter),
		insertBefore: choice.insertBefore && withoutEnabled(choice.insertBefore),
		propertyCapture: position === "property" ? choice.propertyCapture : undefined,
		createFileIfItDoesntExist: choice.createFileIfItDoesntExist,
		useSelectionAsCaptureValue: choice.useSelectionAsCaptureValue,
		task: choice.task,
		eachLine: choice.eachLine,
	});
}

function migrateCommands(value: unknown, host: IChoice, notes: Notes): Step[] {
	const steps: Step[] = [];
	let previous: ICommand | undefined;
	for (const entry of readList(value, `command list of '${host.name}'`)) {
		if (!entry) continue;
		const command = entry as ICommand;
		// The v2 run-time warning's rule. A Choice step's target is not known
		// here, so only a nested choice counts as the write before it.
		if (templaterRerunAfter(previous, command, () => null)) {
			note(notes, host, "templaterRerun", `step ${command.id} runs Templater again after a write`);
		}
		if (command.type !== CommandType.Wait && command.type !== CommandType.Conditional) previous = command;
		steps.push(...migrateCommand(command, host, notes));
	}
	return steps;
}

function migrateCommand(command: ICommand, host: IChoice, notes: Notes): Step[] {
	if (!isObject(command) || Array.isArray(command)) {
		note(notes, host, "unknownCommand", "unreadable command kept as is");
		return [{ id: "", type: "unknown", raw: command }];
	}
	const base = withoutUndefined({ id: command.id, name: command.name });
	noteUnknownKeys(command, V2_COMMAND_KEYS[command.type], host, `step ${String(command.id)}: `, notes);
	switch (command.type) {
		case CommandType.Obsidian:
			return [{ ...base, type: "runCommand", command: { kind: "obsidian", commandId: (command as IObsidianCommand).commandId } }];
		case CommandType.EditorCommand:
			return [{ ...base, type: "runCommand", command: { kind: "editor", editorCommandType: (command as IEditorCommand).editorCommandType } }];
		case CommandType.UserScript: {
			const script = command as IUserScript;
			return [{ ...base, type: "runScript", path: script.path, settings: script.settings }];
		}
		case CommandType.Choice:
			return [{ ...base, type: "runAction", actionId: (command as IChoiceCommand).choiceId }];
		case CommandType.Wait:
			return [{ ...base, type: "wait", time: (command as IWaitCommand).time }];
		case CommandType.AIAssistant:
			return [{ ...(command as IAIAssistantCommand), type: "ai" }];
		case CommandType.OpenFile: {
			const open = command as IOpenFileCommand;
			const options = buildOpenFileOptions(open);
			return [{
				...base,
				type: "open",
				note: isRunNote(open.filePath) ? RUN_NOTE : open.filePath,
				location: options.location ?? "tab",
				direction: options.direction ?? "vertical",
				mode: "default",
				focus: options.focus ?? true,
			}];
		}
		case CommandType.Conditional: {
			const conditional = command as IConditionalCommand;
			return [{
				...base,
				type: "if",
				condition: conditional.condition,
				thenSteps: migrateCommands(conditional.thenCommands, host, notes),
				elseSteps: migrateCommands(conditional.elseCommands, host, notes),
			}];
		}
		case CommandType.NestedChoice:
			return migrateNested(command as INestedChoiceCommand, host, notes);
		default:
			note(notes, host, "unknownCommand", `step ${String(command.id)} has unknown type '${String(command.type)}'`);
			return [{ id: typeof command.id === "string" ? command.id : "", type: "unknown", raw: command }];
	}
}

/**
 * A nested Template or Capture becomes the host's own steps when nothing about
 * it would be lost: it has no settings of its own that only a choice can hold,
 * and its wrapper shows the same name. Anything else stays a nested node.
 */
function migrateNested(command: INestedChoiceCommand, host: IChoice, notes: Notes): Step[] {
	const nested = command.choice;
	if (!isObject(nested)) {
		note(notes, host, "unknownCommand", `nested step ${command.id} has no readable choice`);
		return [{ id: command.id, type: "unknown", raw: command }];
	}
	const own = (["dateOrigin", "onePageInput", "pickDayCommand", "icon"] as const).filter(
		(key) => nested[key] !== undefined,
	);
	const inlinable =
		(nested.type === "Template" || nested.type === "Capture") &&
		own.length === 0 &&
		!nested.command &&
		command.name === nested.name;
	if (inlinable) {
		note(notes, host, "inlined", `'${nested.name}'`);
		noteUnknownKeys(nested, V2_CHOICE_KEYS[nested.type], nested, "", notes);
		// A Template or Capture that became a sequence: its write is the host's own (see lowerSteps).
		const stepId = nested.id === `${host.id}:choice` ? host.id : nested.id;
		return writeGroup(nested as ITemplateChoice | ICaptureChoice, stepId, nested.name, notes);
	}
	const reason =
		nested.type === "Multi" || nested.type === "Macro" ? `a nested ${nested.type}` :
		own.length > 0 ? `its own ${own.join(", ")}` :
		nested.command ? "its own command setting" :
		"a step name that differs from the choice name";
	note(notes, host, "keptNested", `${nested.name ? `'${nested.name}'` : "an unnamed choice"} because of ${reason}`);
	return [withoutUndefined({
		id: command.id,
		name: command.name,
		type: "inlineAction" as const,
		node: migrateNode(nested, notes),
	})];
}

function note(notes: Notes, choice: IChoice, kind: MigrationNote["kind"], detail: string) {
	notes.push({ choiceId: choice.id, choiceName: choice.name, kind, detail });
}

function readList(value: unknown, what: string): unknown[] {
	if (Array.isArray(value)) {
		if (value.some(Array.isArray)) throw new Error(`Cannot migrate a nested list inside a ${what}.`);
		return value;
	}
	if (isUnreadableList(value)) throw new Error(`Cannot migrate an unreadable ${what}.`);
	return [];
}

/** An Open file path that is the run note, written in any case. */
function isRunNote(path: unknown): boolean {
	return typeof path === "string" && path.trim().toUpperCase() === RUN_NOTE;
}

function isObject(value: unknown): boolean {
	return typeof value === "object" && value !== null;
}

/** A switch that becomes the step's position or presence. */
function withoutEnabled<T extends { enabled: boolean }>(value: T): Omit<T, "enabled"> {
	const copy: Partial<T> = { ...value };
	delete copy.enabled;
	return copy as Omit<T, "enabled">;
}

/** Drops keys whose value is undefined, so stored JSON and deep equality agree. */
function withoutUndefined<T extends object>(value: T): T {
	return Object.fromEntries(
		Object.entries(value).filter(([, entry]) => entry !== undefined),
	) as T;
}

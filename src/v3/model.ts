import type { DateOrigin } from "../types/dateOrigin";
import type { FileViewMode2, OpenLocation } from "../types/fileOpening";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type { PropertyCapture } from "../types/choices/ICaptureChoice";
import type { AppendLinkOptions } from "../types/linkPlacement";
import type { ConditionalCondition } from "../types/macros/Conditional/types";
import type { EditorCommandType } from "../types/macros/EditorCommands/EditorCommandType";
import type { IAIAssistantCommand } from "../types/macros/QuickCommands/IAIAssistantCommand";
import type {
	TemplateExistingNoteAction,
	TemplateFileExistsBehavior,
} from "../template/fileExistsPolicy";

/**
 * QuickAdd v3 storage model: a tree of folders and actions, where an action is
 * an ordered list of steps. Only shapes that v2 data migrates into are here;
 * every one of them lowers back to a v2 choice (see lower.ts), which is what
 * the existing engines run.
 */
export type ActionNode = Action | Folder;

/** v2 Multi. Running it opens a launcher over `items`. */
export interface Folder {
	kind: "folder";
	id: string;
	name: string;
	icon?: string;
	command: boolean;
	collapsed?: boolean;
	placeholder?: string;
	items: ActionNode[];
}

export type LegacyChoiceType = "Template" | "Capture" | "Macro";

export interface Action {
	kind: "action";
	id: string;
	name: string;
	icon?: string;
	steps: Step[];
	show: {
		command: boolean;
		pickDayCommand?: boolean;
		runOnStartup?: boolean;
		/** A ribbon icon that runs the action. No v2 choice holds it. */
		ribbon?: boolean;
	};
	dateOrigin?: DateOrigin;
	onePageInput?: "always" | "never";
	provenance?: { migratedFrom: LegacyChoiceType };
}

interface StepBase {
	id: string;
	name?: string;
}

export type Step =
	| CreateNoteStep
	| AddToNoteStep
	| LinkStep
	| OpenStep
	| RunCommandStep
	| RunScriptStep
	| TemplaterStep
	| AIStep
	| IfStep
	| WaitStep
	| RunActionStep
	| InlineActionStep
	| UnknownStep;

export type WriteStep = CreateNoteStep | AddToNoteStep;

export interface NoteLocation {
	mode: "default" | "folders" | "activeFolder" | "ask";
	folders: string[];
	includeSubfolders: boolean;
}

export interface CreateNoteStep extends StepBase {
	type: "createNote";
	templatePath: string;
	/** Disabled means: ask for the title. */
	fileNameFormat: { enabled: boolean; format: string };
	location: NoteLocation;
	fileExistsBehavior: TemplateFileExistsBehavior;
	discoverExistingNotesBeforeCreate?: boolean;
	existingNoteAction?: TemplateExistingNoteAction;
}

/**
 * Where an Add to note step writes. "top" is the top of the note body;
 * "cursor", "newLineAbove" and "newLineBelow" exist only for the active note.
 */
export type WritePosition =
	| "top"
	| "cursor"
	| "bottom"
	| "after"
	| "before"
	| "property"
	| "newLineAbove"
	| "newLineBelow";

export interface AddToNoteStep extends StepBase {
	type: "addToNote";
	/** The v2 target mini-language: empty, #tag, property:, folder/, {{DAILY}}, a path. */
	captureTo: string;
	captureToActiveFile: boolean;
	captureToCanvasNodeId?: string;
	position: WritePosition;
	/** Disabled means: write {{VALUE}}. */
	format: { enabled: boolean; format: string };
	/** Read when position is "after". */
	insertAfter: Omit<ICaptureChoice["insertAfter"], "enabled">;
	/** Read when position is "before". */
	insertBefore?: Omit<NonNullable<ICaptureChoice["insertBefore"]>, "enabled">;
	/** Present exactly when position is "property". */
	propertyCapture?: PropertyCapture;
	createFileIfItDoesntExist: { enabled: boolean; createWithTemplate: boolean; template: string };
	useSelectionAsCaptureValue?: boolean;
	task: boolean;
	eachLine?: boolean;
}

/** The note a step works on. Migration only ever writes the run note. */
export const RUN_NOTE = "{{NOTE}}";

export interface LinkStep extends StepBase {
	type: "link";
	link: string;
	/** Absent when the step only copies the link. */
	insert?: Omit<AppendLinkOptions, "enabled">;
	copyToClipboard?: boolean;
}

export interface OpenStep extends StepBase {
	type: "open";
	note: string;
	location: OpenLocation;
	direction: "vertical" | "horizontal";
	mode: FileViewMode2;
	focus: boolean;
}

export interface RunCommandStep extends StepBase {
	type: "runCommand";
	command:
		| { kind: "obsidian"; commandId: string }
		| { kind: "editor"; editorCommandType: EditorCommandType };
}

export interface RunScriptStep extends StepBase {
	type: "runScript";
	/** May carry "::member". */
	path: string;
	settings: Record<string, unknown>;
}

/** Templater's "replace templates" over a whole note. */
export interface TemplaterStep extends StepBase {
	type: "templater";
	note: string;
}

export interface AIStep
	extends StepBase,
		Omit<IAIAssistantCommand, "id" | "name" | "type"> {
	type: "ai";
}

export interface IfStep extends StepBase {
	type: "if";
	condition: ConditionalCondition;
	thenSteps: Step[];
	elseSteps: Step[];
}

export interface WaitStep extends StepBase {
	type: "wait";
	/** Milliseconds. */
	time: number;
}

/** Runs another action or opens a folder's launcher, by id. */
export interface RunActionStep extends StepBase {
	type: "runAction";
	actionId: string;
}

/**
 * Runs an action or folder that lives only inside this step. Migration uses it
 * for a v2 nested choice whose own settings would be lost by flattening it
 * into the host: a nested Multi or Macro, or a nested choice with its own
 * date or one-page setting.
 */
export interface InlineActionStep extends StepBase {
	type: "inlineAction";
	node: ActionNode;
}

/** A command this build cannot read, kept verbatim. v2 skips it with a notice. */
export interface UnknownStep extends StepBase {
	type: "unknown";
	raw: unknown;
}

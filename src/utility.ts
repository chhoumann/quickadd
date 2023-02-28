import type { App, TAbstractFile, ViewState } from "obsidian";
import { MarkdownView, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { log } from "./logger/logManager";
import type { NewTabDirection } from "./types/newTabDirection";
import type { IUserScript } from "./types/macros/IUserScript";
import type { FileViewMode } from "./types/fileViewMode";
import { TemplateChoice } from "./types/choices/TemplateChoice";
import { MultiChoice } from "./types/choices/MultiChoice";
import { CaptureChoice } from "./types/choices/CaptureChoice";
import { MacroChoice } from "./types/choices/MacroChoice";
import IChoice from "./types/choices/IChoice";
import { ChoiceType } from "./types/choices/choiceType";
import QuickAdd from "./main";

export function getTemplater(app: App) {
	return app.plugins.plugins["templater-obsidian"];
}

export async function replaceTemplaterTemplatesInCreatedFile(
	app: App,
	file: TFile,
	force = false
) {
	const templater = getTemplater(app);

	if (
		templater &&
		(force || !templater?.settings["trigger_on_file_creation"])
	) {
		const active_file = app.workspace.getActiveFile();

		if (templater?.templater?.overwrite_file_commands) {
			await templater.templater.overwrite_file_commands(file);
		}
	}
}

export async function templaterParseTemplate(
	app: App,
	templateContent: string,
	targetFile: TFile
) {
	const templater = getTemplater(app);
	if (!templater) return templateContent;

	return await templater.templater.parse_template(
		{ target_file: targetFile, run_mode: 4 },
		templateContent
	);
}

export function getNaturalLanguageDates(app: App) {
	// @ts-ignore
	return app.plugins.plugins["nldates-obsidian"];
}

export function getDate(input?: { format?: string; offset?: number }) {
	let duration;

	if (
		input?.offset !== null &&
		input?.offset !== undefined &&
		typeof input.offset === "number"
	) {
		duration = window.moment.duration(input.offset, "days");
	}

	return input?.format
		? window.moment().add(duration).format(input.format)
		: window.moment().add(duration).format("YYYY-MM-DD");
}

export function appendToCurrentLine(toAppend: string, app: App) {
	try {
		const activeView = app.workspace.getActiveViewOfType(MarkdownView);

		if (!activeView) {
			log.logError(`unable to append '${toAppend}' to current line.`);
			return;
		}

		activeView.editor.replaceSelection(toAppend);
	} catch {
		log.logError(`unable to append '${toAppend}' to current line.`);
	}
}

export function findObsidianCommand(app: App, commandId: string) {
	// @ts-ignore
	return app.commands.findCommand(commandId);
}

export function deleteObsidianCommand(app: App, commandId: string) {
	if (findObsidianCommand(app, commandId)) {
		// @ts-ignore
		delete app.commands.commands[commandId];
		// @ts-ignore
		delete app.commands.editorCommands[commandId];
	}
}

export function getAllFolderPathsInVault(app: App): string[] {
	return app.vault
		.getAllLoadedFiles()
		.filter((f) => f instanceof TFolder)
		.map((folder) => folder.path);
}

export function getUserScriptMemberAccess(fullMemberPath: string): {
	basename: string | undefined;
	memberAccess: string[] | undefined;
} {
	const fullMemberArray: string[] = fullMemberPath.split("::");
	return {
		basename: fullMemberArray[0],
		memberAccess: fullMemberArray.slice(1),
	};
}

export function waitFor(ms: number): Promise<unknown> {
	return new Promise((res) => setTimeout(res, ms));
}

export function getLinesInString(input: string) {
	const lines: string[] = [];
	let tempString = input;

	while (tempString.contains("\n")) {
		const lineEndIndex = tempString.indexOf("\n");
		lines.push(tempString.slice(0, lineEndIndex));
		tempString = tempString.slice(lineEndIndex + 1);
	}

	lines.push(tempString);

	return lines;
}

// https://stackoverflow.com/questions/3115150/how-to-escape-regular-expression-special-characters-using-javascript
export function escapeRegExp(text: string) {
	return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

export async function openFile(
	app: App,
	file: TFile,
	optional: {
		openInNewTab?: boolean;
		direction?: NewTabDirection;
		mode?: FileViewMode;
		focus?: boolean;
	}
) {
	let leaf: WorkspaceLeaf;

	if (optional.openInNewTab && optional.direction) {
		leaf = app.workspace.getLeaf("split", optional.direction);
	} else {
		leaf = app.workspace.getLeaf("tab");
	}

	await leaf.openFile(file);

	if (optional?.focus) {
		app.workspace.setActiveLeaf(leaf, { focus: optional.focus });
	}

	if (optional?.mode) {
		const leafViewState = leaf.getViewState();

		leaf.setViewState({
			...leafViewState,
			state: {
				...leafViewState.state,
				mode: optional.mode,
			},
		});
	}
}

// Slightly modified version of Templater's user script import implementation
// Source: https://github.com/SilentVoid13/Templater
export async function getUserScript(command: IUserScript, app: App) {
	// @ts-ignore
	const file: TAbstractFile = app.vault.getAbstractFileByPath(command.path);
	if (!file) {
		log.logError(`failed to load file ${command.path}.`);
		return;
	}

	if (file instanceof TFile) {
		const req = (s: string) => window.require && window.require(s);
		const exp: Record<string, unknown> = {};
		const mod = { exports: exp };

		const fileContent = await app.vault.read(file);
		const fn = window.eval(
			`(function(require, module, exports) { ${fileContent} \n})`
		);
		fn(req, mod, exp);

		// @ts-ignore
		const userScript = exp["default"] || mod.exports;
		if (!userScript) return;

		let script = userScript;

		const { memberAccess } = getUserScriptMemberAccess(command.name);
		if (memberAccess && memberAccess.length > 0) {
			let member: string;
			while ((member = memberAccess.shift() as string)) {
				//@ts-ignore
				script = script[member];
			}
		}

		return script;
	}
}

export function excludeKeys<T extends object, K extends keyof T>(
	sourceObj: T,
	except: K[]
): Omit<T, K> {
	const obj = structuredClone(sourceObj);

	for (const key of except) {
		delete obj[key];
	}

	return obj;
}

export function getChoiceType<
	T extends TemplateChoice | MultiChoice | CaptureChoice | MacroChoice
>(choice: IChoice): choice is T {
	const isTemplate = (choice: IChoice): choice is TemplateChoice =>
		choice.type === ChoiceType.Template;
	const isMacro = (choice: IChoice): choice is MacroChoice =>
		choice.type === ChoiceType.Macro;
	const isCapture = (choice: IChoice): choice is CaptureChoice =>
		choice.type === ChoiceType.Capture;
	const isMulti = (choice: IChoice): choice is MultiChoice =>
		choice.type === ChoiceType.Multi;

	return (
		isTemplate(choice) ||
		isMacro(choice) ||
		isCapture(choice) ||
		isMulti(choice)
	);
}

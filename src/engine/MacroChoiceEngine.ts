import type { App, WorkspaceLeaf } from "obsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type QuickAdd from "../main";
import type IMacroChoice from "../types/choices/IMacroChoice";
import { MacroCommandRunner } from "./MacroCommandRunner";

export class MacroChoiceEngine extends MacroCommandRunner {
	constructor(
		app: App,
		plugin: QuickAdd,
		choice: IMacroChoice,
		choiceExecutor: IChoiceExecutor,
		variables: Map<string, unknown>,
		preloadedUserScripts?: Map<string, unknown>,
		promptLabel?: string,
		originLeaf: WorkspaceLeaf | null = null,
	) {
		super(
			app,
			plugin,
			choice,
			choiceExecutor,
			variables,
			preloadedUserScripts,
			promptLabel,
			originLeaf,
		);
	}
}

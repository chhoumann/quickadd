import type { App } from "obsidian";
import { MarkdownView, Menu } from "obsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { log } from "../logger/logManager";
import type IChoice from "../types/choices/IChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import { resolveChoiceIcon } from "../utils/choiceUtils";

type MenuChoice = {
	choice: IChoice;
	title: string;
};

export function collectChoicesForMenu(
	choices: IChoice[],
	prefix: string[] = [],
): MenuChoice[] {
	const items: MenuChoice[] = [];

	for (const choice of choices) {
		if (choice.type === "Multi") {
			const multi = choice as IMultiChoice;
			items.push(...collectChoicesForMenu(multi.choices ?? [], [...prefix, choice.name]));
			continue;
		}

		items.push({
			choice,
			title: [...prefix, choice.name].join(" / "),
		});
	}

	return items;
}

export function showChoiceMenu(
	app: App,
	choices: IChoice[],
	choiceExecutor: IChoiceExecutor,
): void {
	const menu = new Menu();
	const menuChoices = collectChoicesForMenu(choices);

	if (menuChoices.length === 0) {
		menu.addItem((item) => item.setTitle("No choices").setDisabled(true));
	} else {
		for (const { choice, title } of menuChoices) {
			menu.addItem((item) =>
				item
					.setTitle(title)
					.setIcon(resolveChoiceIcon(choice))
					.onClick(() => {
						void choiceExecutor.execute(choice).catch((error) => {
							log.logError(`Failed to execute menu choice: ${error}`);
						});
					}),
			);
		}
	}

	menu.showAtPosition(getEditorMenuPosition(app));
}

export function getEditorMenuPosition(app: App): { x: number; y: number } {
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	const editorEl = view?.containerEl.querySelector(".cm-editor, .markdown-source-view");
	const rect = editorEl?.getBoundingClientRect();

	if (rect && rect.width > 0 && rect.height > 0) {
		return {
			x: rect.left + Math.min(rect.width * 0.35, 240),
			y: rect.top + Math.min(rect.height * 0.35, 180),
		};
	}

	return {
		x: window.innerWidth / 2,
		y: window.innerHeight / 2,
	};
}

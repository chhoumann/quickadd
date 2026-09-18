import { TFile } from "obsidian";
import type QuickAdd from "../main";
import { ChoiceExecutor } from "../choiceExecutor";
import { QUICK_ADD_COMMAND_LABELS } from "../commandLabels";
import { runTemplateFromFolder } from "../engine/runTemplateFromFolder";
import { applyTemplateToNote } from "../engine/applyTemplateToActiveNote";
import { openChoiceLauncher } from "../gui/suggesters/openChoiceLauncher";
import { PromptPeekSession } from "../gui/promptPeek/PromptPeekSession";

export function registerCoreCommands(plugin: QuickAdd) {
	plugin.addCommand({
		id: "runQuickAdd",
		name: QUICK_ADD_COMMAND_LABELS.run,
		callback: () => {
			openChoiceLauncher(plugin);
		},
	});

	plugin.addCommand({
		id: "resumePrompt",
		name: QUICK_ADD_COMMAND_LABELS.resumePrompt,
		checkCallback: (checking) => {
			if (!PromptPeekSession.isPeeking()) return false;
			if (!checking) PromptPeekSession.getActive()?.resume();
			return true;
		},
	});

	plugin.addCommand({
		id: "runTemplateFromFolder",
		name: QUICK_ADD_COMMAND_LABELS.runTemplateFromFolder,
		callback: () => {
			void runTemplateFromFolder(plugin.app, plugin, {
				choiceExecutor: new ChoiceExecutor(plugin.app, plugin),
			});
		},
	});

	plugin.addCommand({
		id: "applyTemplateToActiveFile",
		name: QUICK_ADD_COMMAND_LABELS.applyTemplate,
		checkCallback: (checking) => {
			const file = plugin.app.workspace.getActiveFile();
			const available = file?.extension === "md";
			if (checking) return available;
			if (!available) return;

			void applyTemplateToNote(plugin.app, plugin, {
				file,
				choiceExecutor: new ChoiceExecutor(plugin.app, plugin),
			});
		},
	});

	plugin.registerEvent(
		plugin.app.workspace.on("file-menu", (menu, abstractFile) => {
			if (!(abstractFile instanceof TFile)) return;
			if (abstractFile.extension !== "md") return;

			menu.addItem((item) =>
				item
					// Aligns with the command-palette label
					// (QUICK_ADD_COMMAND_LABELS.applyTemplate) so the same action reads
					// consistently across both surfaces. Obsidian prefixes commands with
					// "QuickAdd:"; the file menu is unprefixed, so add it here.
					.setTitle(`QuickAdd: ${QUICK_ADD_COMMAND_LABELS.applyTemplate}`)
					.setIcon("file-plus")
					.onClick(() => {
						void applyTemplateToNote(plugin.app, plugin, {
							file: abstractFile,
							choiceExecutor: new ChoiceExecutor(plugin.app, plugin),
						});
					}),
			);
		}),
	);

	plugin.addCommand({
		id: "reloadQuickAdd",
		name: QUICK_ADD_COMMAND_LABELS.reloadDev,
		checkCallback: (checking) => {
			if (checking) {
				return plugin.settings.devMode;
			}

			const id: string = plugin.manifest.id;
			const plugins = plugin.app.plugins;
			void plugins.disablePlugin(id).then(() => plugins.enablePlugin(id));
		},
	});

}

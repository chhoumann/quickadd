import type { App } from "obsidian";

export function findObsidianCommand(app: App, commandId: string) {
	return app.commands.findCommand(commandId);
}

export function deleteObsidianCommand(app: App, commandId: string) {
	if (findObsidianCommand(app, commandId)) {
		delete app.commands.commands[commandId];
		delete app.commands.editorCommands[commandId];
	}
}

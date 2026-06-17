/**
 * Built-in `workspace` tools (#714): read-only views of the active note + selection.
 */
import { type App, MarkdownView, TFile } from "obsidian";
import { applyGroupOptions, defineTool, type BuiltinGroupOptions, type ToolSetMap } from "./shared";

const MAX_ACTIVE_CHARS = 16_000;

export function createWorkspaceTools(
	app: App,
	options: BuiltinGroupOptions = {},
): ToolSetMap {
	const tools: ToolSetMap = {
		get_active_note: defineTool({
			description:
				"Get the currently active note (path, basename, and content). Returns active:null if there is none.",
			inputSchema: { type: "object", properties: {} },
			readOnly: true,
			execute: async () => {
				const file = app.workspace.getActiveFile();
				if (!(file instanceof TFile)) return { active: null };
				const content = await app.vault.cachedRead(file);
				return {
					active: {
						path: file.path,
						basename: file.basename,
						content:
							content.length > MAX_ACTIVE_CHARS
								? content.slice(0, MAX_ACTIVE_CHARS) + "\n…[truncated]"
								: content,
					},
				};
			},
		}),

		get_selection: defineTool({
			description: "Get the text currently selected in the active editor (empty string if none).",
			inputSchema: { type: "object", properties: {} },
			readOnly: true,
			execute: async () => {
				const view = app.workspace.getActiveViewOfType(MarkdownView);
				const selection = view?.editor?.getSelection() ?? "";
				return { selection };
			},
		}),
	};

	return applyGroupOptions(tools, options);
}

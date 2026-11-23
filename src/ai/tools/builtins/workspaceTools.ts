/**
 * Built-in `workspace` tools: read-only views of the active note and selection.
 */
import { type App, MarkdownView, TFile } from "obsidian";
import { isWithinAllowedRoots } from "../allowedRoots";
import { applyGroupOptions, defineTool, truncateNoteText, type BuiltinGroupOptions, type ToolSetMap } from "./shared";

export function createWorkspaceTools(
	app: App,
	options: BuiltinGroupOptions = {},
): ToolSetMap {
	const roots = options.allowedRoots;

	// These tools take no path, but a script that confined the group with
	// allowedRoots expects out-of-root notes to stay invisible, or injected
	// instructions could pull the open note into the transcript sent to the
	// provider. Every ambient read goes through the two confining accessors below.

	/** The active markdown note, but only when it is inside the configured fence. */
	const confinedActiveMarkdownFile = (): TFile | null => {
		const file = app.workspace.getActiveFile();
		// Only markdown notes count as the "active note": getActiveFile() returns a
		// TFile for ANY active file (PDF, image, canvas, …), and cachedRead-ing those
		// would feed raw/binary bytes into the transcript.
		if (!(file instanceof TFile) || file.extension !== "md") return null;
		// Out-of-fence ⇒ treat as no active note. Silent on purpose: signalling
		// out-of-scope would itself leak the fenced file's existence/location.
		return isWithinAllowedRoots(file.path, roots) ? file : null;
	};

	/** The active markdown view, but only when its file is inside the fence. */
	const confinedActiveMarkdownView = (): MarkdownView | null => {
		const view = app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return null;
		// Keyed on the active view's own file. NOTE: in rare split/hover-editor
		// layouts the highlighted text's true source could differ, so this is
		// best-effort confinement, not an airtight provenance guarantee.
		return isWithinAllowedRoots(view.file?.path, roots) ? view : null;
	};

	const tools: ToolSetMap = {
		get_active_note: defineTool({
			description:
				"Get the currently active note (path, basename, and content). Returns active:null if there is none.",
			inputSchema: { type: "object", properties: {} },
			readOnly: true,
			execute: async () => {
				const file = confinedActiveMarkdownFile();
				if (!file) return { active: null };
				const content = await app.vault.cachedRead(file);
				return {
					active: {
						path: file.path,
						basename: file.basename,
						content: truncateNoteText(content),
					},
				};
			},
		}),

		get_selection: defineTool({
			description: "Get the text currently selected in the active editor (empty string if none).",
			inputSchema: { type: "object", properties: {} },
			readOnly: true,
			execute: async () => {
				const view = confinedActiveMarkdownView();
				return { selection: view?.editor?.getSelection() ?? "" };
			},
		}),
	};

	return applyGroupOptions(tools, options);
}

import type IChoice from "../../src/types/choices/IChoice";

/**
 * Hand-built v2 choices covering every row of the v3 mapping: each write
 * position (with contradictory switches), each folder mode (with
 * contradictory flags), boolean and object appendLink, legacy Open file
 * commands, nested Template/Capture/Macro/Multi, nested choices with their
 * own date, unknown command types and an array-valued macro. Missing settings
 * are filled the way package import fills them.
 */
const capture = (id: string, name: string, settings: Record<string, unknown>) =>
	({ id, name, type: "Capture", command: true, captureTo: "Inbox.md", format: { enabled: true, format: "- {{VALUE}}" }, ...settings }) as unknown as IChoice;

const template = (id: string, name: string, settings: Record<string, unknown>) =>
	({ id, name, type: "Template", command: true, templatePath: "Templates/Note.md", fileNameFormat: { enabled: true, format: "{{DATE:YYYY-MM-DD}} {{VALUE:Topic}}" }, ...settings }) as unknown as IChoice;

const nested = (id: string, choice: IChoice, name = choice.name) =>
	({ id, name, type: "NestedChoice", choice });

const after = (heading: string) => ({
	enabled: true, after: heading, insertAtEnd: true, considerSubsections: false,
	createIfNotFound: true, createIfNotFoundLocation: "bottom",
});

export const FIXTURE: IChoice[] = [
	capture("fx-top", "Top of note", { activeFileWritePosition: "bottom" }),
	capture("fx-bottom", "Bottom of note", { prepend: true }),
	capture("fx-after", "After heading", { insertAfter: after("## Log") }),
	capture("fx-after-pick", "After a chosen heading", { insertAfter: { ...after(""), promptHeading: true } }),
	capture("fx-before", "Before line", { insertBefore: { enabled: true, before: "## End", createIfNotFound: false, createIfNotFoundLocation: "top" } }),
	capture("fx-bottom-and-after", "Bottom beats after", { prepend: true, insertAfter: after("## Log") }),
	capture("fx-all-switches", "Every switch on", {
		prepend: true,
		insertBefore: { enabled: true, before: "## End", createIfNotFound: false, createIfNotFoundLocation: "top" },
		newLineCapture: { enabled: true, direction: "above" },
	}),
	capture("fx-cursor", "At cursor", { captureToActiveFile: true, captureTo: "" }),
	capture("fx-active-top", "Top of active note", { captureToActiveFile: true, activeFileWritePosition: "top" }),
	capture("fx-active-bottom-legacy", "Bottom of active note (legacy prepend)", { captureToActiveFile: true, prepend: true }),
	capture("fx-active-top-and-prepend", "Active top beats prepend", { captureToActiveFile: true, activeFileWritePosition: "top", prepend: true }),
	capture("fx-line-above", "New line above", { captureToActiveFile: true, newLineCapture: { enabled: true, direction: "above" } }),
	capture("fx-line-below", "New line below", { captureToActiveFile: true, newLineCapture: { enabled: true, direction: "below" } }),
	capture("fx-active-after", "After heading in active note", { captureToActiveFile: true, activeFileWritePosition: "bottom", insertAfter: after("## Notes") }),
	capture("fx-property", "Property, leftover after-line switch", {
		captureTo: "{{DAILY}}",
		insertAfter: after("## Log"),
		propertyCapture: { property: { kind: "named", format: "mood" }, action: "set", createIfMissing: true },
	}),
	capture("fx-property-list", "Add to a list property", {
		captureTo: "#project",
		propertyCapture: { property: { kind: "prompt" }, action: "addToList", createIfMissing: false },
	}),
	capture("fx-stashes", "Stashed settings", {
		newLineCapture: { enabled: false, direction: "above" },
		appendLink: { enabled: false, placement: "newLine", requireActiveFile: false, linkType: "embed" },
		openFile: false,
		fileOpening: { location: "split", direction: "horizontal", mode: "source", focus: false },
	}),
	capture("fx-capture-everything", "Capture with every follow-up", {
		captureTo: "Projects/",
		task: true,
		eachLine: true,
		templater: { afterCapture: "wholeFile" },
		appendLink: true,
		copyLinkToClipboard: true,
		openFile: true,
		fileOpening: { location: "window", direction: "vertical", mode: "preview", focus: true },
		createFileIfItDoesntExist: { enabled: true, createWithTemplate: true, template: "Templates/Project.md" },
		useSelectionAsCaptureValue: false,
	}),
	capture("fx-canvas", "Canvas card", { captureTo: "Board.canvas", captureToCanvasNodeId: "abc123", insertAfter: after("## Ideas") }),
	capture("fx-copy-only", "Copy link only", { copyLinkToClipboard: true }),

	template("fx-folder-default", "Default folder", {}),
	template("fx-folder-specified", "Specified folders", { folder: { enabled: true, folders: ["Notes", "Archive"], chooseWhenCreatingNote: false, createInSameFolderAsActiveFile: false, chooseFromSubfolders: true } }),
	template("fx-folder-active", "Active file folder", { folder: { enabled: true, folders: ["Kept"], chooseWhenCreatingNote: false, createInSameFolderAsActiveFile: true, chooseFromSubfolders: true } }),
	template("fx-folder-ask", "Ask for folder", { folder: { enabled: true, folders: [], chooseWhenCreatingNote: true, createInSameFolderAsActiveFile: false, chooseFromSubfolders: false } }),
	template("fx-folder-conflict", "Ask and active folder both on", { folder: { enabled: true, folders: ["X"], chooseWhenCreatingNote: true, createInSameFolderAsActiveFile: true, chooseFromSubfolders: false } }),
	template("fx-folder-disabled-flags", "Folder off with flags on", { folder: { enabled: false, folders: ["Y"], chooseWhenCreatingNote: true, createInSameFolderAsActiveFile: false, chooseFromSubfolders: false } }),
	template("fx-link-frontmatter", "Link into a property of a note", {
		fileNameFormat: { enabled: false, format: "" },
		appendLink: { enabled: true, placement: "inFrontmatter", requireActiveFile: false, destination: { type: "specifiedFile", path: "Index.md" }, frontmatterProperty: "related" },
		openFile: true,
		fileOpening: { location: "tab", direction: "vertical", mode: "live", focus: false },
	}),
	template("fx-link-boolean", "Legacy boolean link", { appendLink: true, discoverExistingNotesBeforeCreate: true, existingNoteAction: "appendBottom" }),
	template("fx-legacy-template", "Legacy file-exists and open settings", { incrementFileName: true, openFileInNewTab: { enabled: true, direction: "horizontal", focus: true }, openFile: true }),
	template("fx-template-dated", "Template with its own date", {
		dateOrigin: { kind: "relative", offset: 1, unit: "days" },
		onePageInput: "always",
		pickDayCommand: true,
		icon: "calendar",
		fileExistsBehavior: { kind: "apply", mode: "increment" },
	}),

	{
		id: "fx-macro",
		name: "Macro with every step",
		type: "Macro",
		command: true,
		runOnStartup: false,
		onePageInput: "never",
		macro: {
			id: "fx-macro-macro",
			name: "Old macro name",
			commands: [
				{ id: "c-obsidian", name: "Toggle", type: "Obsidian", commandId: "editor:toggle-bold" },
				{ id: "c-editor", name: "Paste", type: "EditorCommand", editorCommandType: "Paste" },
				{ id: "c-script", name: "lib::build", type: "UserScript", path: "scripts/lib.js::build", settings: { key: "value" } },
				{ id: "c-choice", name: "Top of note", type: "Choice", choiceId: "fx-top" },
				{ id: "c-dangling", name: "Gone", type: "Choice", choiceId: "fx-missing" },
				{ id: "c-wait", name: "Wait", type: "Wait", time: 250 },
				{
					id: "c-ai", name: "AI", type: "AIAssistant", model: "Ask me", systemPrompt: "Be brief",
					outputVariableName: "summary", promptTemplate: { enable: true, name: "Prompts/Summarize.md" }, modelParameters: { temperature: 0.2 },
				},
				{ id: "c-open-legacy-split", name: "Open log", type: "OpenFile", filePath: "{{DATE}} log.md", openInNewTab: true, direction: "horizontal" },
				{ id: "c-open-legacy-reuse", name: "Open inbox", type: "OpenFile", filePath: "Inbox.md", openInNewTab: false, focus: false },
				{ id: "c-open-location", name: "Open board", type: "OpenFile", filePath: "Board.md", location: "tab", direction: "horizontal" },
				nested("c-nested-template", template("fx-nested-template", "Nested note", { command: false, openFile: true })),
				{ id: "c-rerun", name: "Templater: Replace templates in the active file", type: "Obsidian", commandId: "templater-obsidian:replace-in-file-templater" },
				nested("c-nested-capture", capture("fx-nested-capture", "Nested capture", { command: false, templater: { afterCapture: "wholeFile" }, appendLink: true })),
				{
					id: "c-if", name: "If", type: "Conditional",
					condition: { mode: "variable", variableName: "kind", operator: "equals", valueType: "string", expectedValue: "task" },
					thenCommands: [nested("c-then-capture", capture("fx-then-capture", "Then capture", { command: false, task: true }))],
					elseCommands: [{ id: "c-else-wait", name: "Wait", type: "Wait", time: 10 }],
				},
				nested("c-nested-macro", {
					id: "fx-nested-macro", name: "Nested macro", type: "Macro", command: false, runOnStartup: false,
					macro: { id: "fx-nested-macro-macro", name: "Nested macro", commands: [{ id: "c-inner-script", name: "inner", type: "UserScript", path: "scripts/inner.js", settings: {} }] },
				} as unknown as IChoice),
				nested("c-nested-multi", {
					id: "fx-nested-multi", name: "Pick one", type: "Multi", command: false, collapsed: false,
					choices: [capture("fx-nested-multi-a", "Option A", { command: false })],
				} as unknown as IChoice),
				nested("c-nested-dated", template("fx-nested-dated", "Tomorrow's note", { command: false, dateOrigin: { kind: "ask" } })),
				nested("c-nested-renamed", template("fx-nested-renamed", "Inner name", { command: false }), "Outer step name"),
				{ id: "c-future", name: "From a newer QuickAdd", type: "FutureStep", payload: { a: 1 } },
				null,
			],
		},
	} as unknown as IChoice,

	{
		id: "fx-array-macro",
		name: "Array-valued macro",
		type: "Macro",
		command: false,
		runOnStartup: true,
		macro: [{ id: "c-array-script", name: "script", type: "UserScript", path: "scripts/a.js", settings: {} }],
	} as unknown as IChoice,

	// Shapes found in a real multi-year data.json: settings an older version
	// wrote, and a nested choice saved without an id or a name.
	capture("fx-old-keys", "Old keys", { focusExistingFileTab: true, insertion: { enabled: false } }),
	{
		id: "fx-old-macro",
		name: "Old nested choice",
		type: "Macro",
		command: true,
		runOnStartup: false,
		macro: {
			id: "fx-old-macro-macro",
			name: "x",
			commands: [
				{ id: "c-old-nested", type: "NestedChoice", choice: { type: "Capture", command: true, captureTo: "", captureToActiveFile: true, format: { enabled: true, format: "{{VALUE}}" } } },
				{ id: "c-old-wait", name: "Wait", type: "Wait", time: 10, delay: 5 },
			],
		},
	} as unknown as IChoice,

	{
		id: "fx-macro-only-nested",
		name: "Macro holding one template",
		type: "Macro",
		command: true,
		runOnStartup: false,
		macro: { id: "fx-macro-only-nested-macro", name: "x", commands: [nested("c-only", template("fx-only-template", "Only template", { command: false }))] },
	} as unknown as IChoice,

	{
		id: "fx-folder",
		name: "Folder",
		type: "Multi",
		command: true,
		collapsed: true,
		placeholder: "Pick a capture",
		dateOrigin: { kind: "now" },
		onePageInput: "always",
		choices: [
			capture("fx-folder-child", "Child capture", {}),
			{ id: "fx-folder-inner", name: "Inner folder", type: "Multi", command: false, collapsed: false, choices: [template("fx-folder-inner-child", "Inner template", {})] },
		],
	} as unknown as IChoice,
];

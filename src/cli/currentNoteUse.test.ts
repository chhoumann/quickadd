import { describe, expect, it, vi } from "vitest";
import type QuickAdd from "../main";
import { TFile } from "obsidian";
import { CaptureChoice } from "../types/choices/CaptureChoice";
import { TemplateChoice } from "../types/choices/TemplateChoice";
import { MacroChoice } from "../types/choices/MacroChoice";
import { MultiChoice } from "../types/choices/MultiChoice";
import type IChoice from "../types/choices/IChoice";
import { currentNoteUse, describeCurrentNoteUse, type CurrentNoteUseContext } from "./currentNoteUse";

const base: CurrentNoteUseContext = { templates: [], selectionAsCaptureValue: false, newNotesInCurrentFolder: false };
/** `templates` are the texts of the templates the run formats as note content. */
const use = (choice: IChoice, ...templates: string[]) =>
	currentNoteUse(choice, { ...base, templates: templates.map((text) => [text, "content"]) });

/** A plugin whose vault holds `files`, path to text, with selection as value off. */
function plugin(files: Record<string, string>, newFileLocation = "root"): QuickAdd {
	const byPath = new Map(Object.entries(files).map(([path, text]) => [path, Object.assign(new TFile(), { path, text })]));
	return {
		app: {
			vault: {
				getAbstractFileByPath: vi.fn((path: string) => byPath.get(path) ?? null),
				cachedRead: vi.fn(async (file: TFile & { text: string }) => file.text),
				getConfig: vi.fn((key: string) => (key === "newFileLocation" ? newFileLocation : undefined)),
			},
		},
		settings: { useSelectionAsCaptureValue: false },
	} as unknown as QuickAdd;
}

const optionalLink = { enabled: true, placement: "replaceSelection", requireActiveFile: false } as const;
const requiredLink = { enabled: true, placement: "replaceSelection", requireActiveFile: true } as const;

function capture(configure: (choice: CaptureChoice) => void = () => {}): IChoice {
	const choice = new CaptureChoice("Capture");
	choice.captureTo = "Inbox.md";
	configure(choice);
	return choice;
}

function template(configure: (choice: TemplateChoice) => void = () => {}): IChoice {
	const choice = new TemplateChoice("Template");
	choice.templatePath = "Templates/Note.md";
	// Named without {{VALUE}}, which reads the selection (see the {{VALUE}} test).
	choice.fileNameFormat = { enabled: true, format: "{{DATE}}" };
	configure(choice);
	return choice;
}

describe("currentNoteUse", () => {
	it("is none for a capture that writes to a named note with a plain format", () => {
		expect(use(capture())).toBe("none");
	});

	it("requires the current note to capture to the active file", () => {
		expect(use(capture((c) => { c.captureToActiveFile = true; }))).toBe("required");
	});

	it("follows the append link: legacy true and requireActiveFile are required, otherwise optional", () => {
		expect(use(capture((c) => { c.appendLink = true; }))).toBe("required");
		expect(use(capture((c) => { c.appendLink = { ...requiredLink }; }))).toBe("required");
		expect(use(capture((c) => { c.appendLink = { ...optionalLink }; }))).toBe("optional");
		expect(use(template((t) => { t.appendLink = { ...optionalLink }; }))).toBe("optional");
	});

	it("ignores an append link into a specified file, which never reads the current note", () => {
		expect(use(capture((c) => {
			c.appendLink = { ...requiredLink, destination: { type: "specifiedFile", path: "Log.md" } };
		}))).toBe("none");
	});

	it.each(["{{LINKCURRENT}}", "{{linksection}}", "{{FILENAMECURRENT}}", "{{FOLDERCURRENT}}", "{{FOLDERCURRENT|name}}"])(
		"requires the current note for %s in a capture format, unless the append link makes it optional",
		(token) => {
			expect(use(capture((c) => { c.format = { enabled: true, format: `- ${token}` }; }))).toBe("required");
			expect(use(capture((c) => {
				c.format = { enabled: true, format: `- ${token}` };
				c.appendLink = { ...optionalLink };
			}))).toBe("optional");
		},
	);

	it("ignores a disabled capture format", () => {
		expect(use(capture((c) => { c.format = { enabled: false, format: "{{LINKCURRENT}}" }; }))).toBe("none");
	});

	it("reads the capture target path, where an empty token would retarget the write", () => {
		expect(use(capture((c) => {
			c.captureTo = "{{FOLDERCURRENT}}/Log.md";
			c.appendLink = { ...optionalLink };
		}))).toBe("required");
		expect(use(capture((c) => {
			c.captureTo = "Logs/{{FILENAMECURRENT}}.md";
			c.appendLink = { ...optionalLink };
		}))).toBe("required");
	});

	it("reads the line targets, where a folder token stays literal", () => {
		expect(use(capture((c) => {
			c.insertAfter = { ...c.insertAfter, enabled: true, after: "## {{FILENAMECURRENT}}" };
		}))).toBe("required");
		expect(use(capture((c) => {
			c.insertAfter = { ...c.insertAfter, enabled: true, after: "## {{FOLDERCURRENT}}" };
		}))).toBe("none");
		expect(use(capture((c) => {
			c.insertAfter = { ...c.insertAfter, enabled: false, after: "## {{FILENAMECURRENT}}" };
		}))).toBe("none");
		expect(use(capture((c) => {
			c.insertAfter = { ...c.insertAfter, enabled: true, promptHeading: true, after: "## {{FILENAMECURRENT}}" };
		}))).toBe("none");
		// An empty line target aborts and a half-empty one matches nothing, so the optional link does not help.
		expect(use(capture((c) => {
			c.insertBefore = { enabled: true, before: "{{LINKCURRENT}}", createIfNotFound: false, createIfNotFoundLocation: "top" };
			c.appendLink = { ...optionalLink };
		}))).toBe("required");
	});

	it("reads a named property's name, which cannot be empty", () => {
		expect(use(capture((c) => {
			c.propertyCapture = { property: { kind: "named", format: "{{FILENAMECURRENT}}" }, action: "set", createIfMissing: true };
			c.appendLink = { ...optionalLink };
		}))).toBe("required");
		expect(use(capture((c) => {
			c.propertyCapture = { property: { kind: "prompt" }, action: "set", createIfMissing: true };
		}))).toBe("none");
	});

	it("treats {{SELECTED}} as optional", () => {
		expect(use(capture((c) => { c.format = { enabled: true, format: "{{SELECTED}}" }; }))).toBe("optional");
		expect(use(template(), "> {{selected}}")).toBe("optional");
	});

	it("treats {{VALUE}} as optional when the engine fills it from the selection", () => {
		const selection = (choice: IChoice, selectionAsCaptureValue: boolean) =>
			currentNoteUse(choice, { ...base, selectionAsCaptureValue });
		const plain = capture((c) => { c.format = { enabled: true, format: "- {{VALUE}}" }; });
		expect(selection(plain, true)).toBe("optional");
		expect(selection(plain, false)).toBe("none");
		expect(selection(capture((c) => { c.useSelectionAsCaptureValue = true; }), false)).toBe("optional");
		expect(selection(capture((c) => { c.useSelectionAsCaptureValue = false; }), true)).toBe("none");
		expect(selection(capture((c) => { c.format = { enabled: true, format: "- {{VALUE:topic}}" }; }), true)).toBe("none");
		// A template's own prompt reads the selection whatever the capture setting says.
		expect(selection(capture((c) => { c.useSelectionAsCaptureValue = false; }), false)).toBe("none");
		expect(currentNoteUse(capture((c) => { c.useSelectionAsCaptureValue = false; }), { ...base, templates: [["{{VALUE}}", "content"]] })).toBe("optional");
		expect(use(template((t) => { t.fileNameFormat = { enabled: false, format: "" }; }))).toBe("optional");
		expect(use(template(), "# {{VALUE}}")).toBe("optional");
		expect(use(template(), "# {{VALUE:topic}}")).toBe("none");
	});

	it("treats {{FIELD:…|default-from:active}} as optional wherever it is formatted", () => {
		expect(use(capture((c) => { c.format = { enabled: true, format: "- {{FIELD:project|default-from:active}}" }; }))).toBe("optional");
		expect(use(capture((c) => { c.format = { enabled: true, format: "- {{FIELD:project|default:Work}}" }; }))).toBe("none");
		expect(use(capture((c) => { c.captureTo = "{{FIELD:area|default-from:active}}/Log.md"; }))).toBe("optional");
		expect(use(template(), "project: {{FIELD:project|default-from:active}}")).toBe("optional");
		expect(use(template((t) => { t.fileNameFormat = { enabled: true, format: "{{FIELD:area|default-from:active}} notes" }; }))).toBe("optional");
	});

	it("requires the current note for a template without a folder setting when Obsidian creates new notes beside the current one", () => {
		const beside = (choice: IChoice) => currentNoteUse(choice, { ...base, newNotesInCurrentFolder: true });
		expect(beside(template((t) => { t.folder = { ...t.folder, enabled: false }; }))).toBe("required");
		expect(use(template((t) => { t.folder = { ...t.folder, enabled: false }; }))).toBe("none");
		expect(beside(template((t) => { t.folder = { ...t.folder, enabled: true, folders: ["Notes"] }; }))).toBe("none");
		expect(beside(capture())).toBe("none");
	});

	it("lets required beat optional", () => {
		expect(use(capture((c) => {
			c.captureToActiveFile = true;
			c.format = { enabled: true, format: "{{SELECTED}}" };
		}))).toBe("required");
	});

	it("requires the current note for a template created in its folder", () => {
		expect(use(template((t) => {
			t.folder = { ...t.folder, enabled: true, createInSameFolderAsActiveFile: true };
		}))).toBe("required");
		expect(use(template((t) => {
			t.folder = { ...t.folder, enabled: false, createInSameFolderAsActiveFile: true };
		}))).toBe("none");
	});

	it("reads the template's folders when it creates in a specified folder", () => {
		expect(use(template((t) => {
			t.folder = { ...t.folder, enabled: true, folders: ["Projects/{{FOLDERCURRENT|name}}"] };
			t.appendLink = { ...optionalLink };
		}))).toBe("required");
		expect(use(template((t) => {
			t.folder = { ...t.folder, enabled: true, chooseWhenCreatingNote: true, folders: ["Projects/{{FOLDERCURRENT|name}}"] };
		}))).toBe("none");
	});

	it("reads the template's file name and content", () => {
		expect(use(template((t) => {
			t.fileNameFormat = { enabled: true, format: "{{FILENAMECURRENT}} notes" };
		}))).toBe("required");
		expect(use(template((t) => {
			t.fileNameFormat = { enabled: true, format: "{{FOLDERCURRENT}} notes" };
			t.appendLink = { ...optionalLink };
		}))).toBe("required");
		expect(use(template(), "Back to {{LINKCURRENT}}")).toBe("required");
		expect(use(template((t) => { t.appendLink = { ...optionalLink }; }), "Back to {{LINKCURRENT}}")).toBe("optional");
		expect(use(template(), "# {{DATE}}")).toBe("none");
	});

	it("survives a hand-edited template missing its folder and file name settings", () => {
		const partial = { id: "p", name: "Partial", type: "Template", command: false, templatePath: "T.md" } as IChoice;
		expect(use(partial, "{{LINKCURRENT}}")).toBe("required");
	});

	it("is none for macros and multis, whatever their scripts read", () => {
		expect(use(new MacroChoice("Macro"))).toBe("none");
		expect(use(new MultiChoice("Group"))).toBe("none");
	});
});

describe("describeCurrentNoteUse", () => {
	it("reads the template file from the vault, tolerating an omitted .md", async () => {
		const app = plugin({ "Templates/Note.md": "See {{LINKCURRENT}}" });

		await expect(describeCurrentNoteUse(app, template((t) => { t.templatePath = "Templates/Note"; }))).resolves.toBe("required");
		expect(app.app.vault.cachedRead).toHaveBeenCalledWith(expect.objectContaining({ path: "Templates/Note.md" }));
		await expect(describeCurrentNoteUse(app, template((t) => { t.templatePath = "Missing.md"; }))).resolves.toBe("none");
		await expect(describeCurrentNoteUse(app, capture((c) => { c.captureToActiveFile = true; }))).resolves.toBe("required");
	});

	it("reads a Capture's create-with-template file and the templates it includes", async () => {
		const app = plugin({
			"Templates/Backlink.md": "# {{VALUE:topic}}\n{{TEMPLATE:Templates/Footer.md}}",
			"Templates/Footer.md": "Back to {{LINKCURRENT}}",
			"Templates/Loop.md": "{{TEMPLATE:Templates/Loop.md}} {{SELECTED}}",
		});
		const created = (template: string, enabled = true) => (c: CaptureChoice) => {
			c.captureTo = "Inbox.md";
			c.createFileIfItDoesntExist = { enabled, createWithTemplate: true, template };
		};

		await expect(describeCurrentNoteUse(app, capture(created("Templates/Backlink")))).resolves.toBe("required");
		await expect(describeCurrentNoteUse(app, capture((c) => {
			created("Templates/Backlink")(c);
			c.appendLink = { ...optionalLink };
		}))).resolves.toBe("optional");
		await expect(describeCurrentNoteUse(app, capture(created("Templates/Backlink", false)))).resolves.toBe("none");
		await expect(describeCurrentNoteUse(app, capture((c) => {
			c.format = { enabled: true, format: "- {{TEMPLATE:Templates/Footer.md}}" };
		}))).resolves.toBe("required");
		await expect(describeCurrentNoteUse(app, template((t) => { t.templatePath = "Templates/Backlink.md"; }))).resolves.toBe("required");
		await expect(describeCurrentNoteUse(app, template((t) => { t.templatePath = "Templates/Loop.md"; }))).resolves.toBe("optional");
	});

	it("classifies an included template by the setting that includes it", async () => {
		const app = plugin({
			"Templates/Where.md": "{{FOLDERCURRENT}}/Log.md",
			"Templates/Heading.md": "## {{FILENAMECURRENT}}",
			"Templates/Note.md": "# {{DATE}}",
		});
		const optional = (c: CaptureChoice) => { c.appendLink = { ...optionalLink }; };

		await expect(describeCurrentNoteUse(app, capture((c) => {
			c.captureTo = "{{TEMPLATE:Templates/Where.md}}";
			optional(c);
		}))).resolves.toBe("required");
		await expect(describeCurrentNoteUse(app, capture((c) => {
			c.insertAfter = { ...c.insertAfter, enabled: true, after: "{{TEMPLATE:Templates/Heading.md}}" };
			optional(c);
		}))).resolves.toBe("required");
		await expect(describeCurrentNoteUse(app, capture((c) => {
			c.format = { enabled: true, format: "{{TEMPLATE:Templates/Heading.md}}" };
			optional(c);
		}))).resolves.toBe("optional");
		await expect(describeCurrentNoteUse(app, template((t) => {
			t.fileNameFormat = { enabled: true, format: "{{TEMPLATE:Templates/Heading.md}}" };
			t.appendLink = { ...optionalLink };
		}))).resolves.toBe("required");
	});

	it("reads Obsidian's new-note location for a template without a folder setting", async () => {
		const beside = plugin({ "Templates/Note.md": "# {{DATE}}" }, "current");
		await expect(describeCurrentNoteUse(beside, template())).resolves.toBe("required");
		await expect(describeCurrentNoteUse(plugin({ "Templates/Note.md": "# {{DATE}}" }), template())).resolves.toBe("none");
	});
});

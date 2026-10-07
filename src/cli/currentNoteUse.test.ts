import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import { CaptureChoice } from "../types/choices/CaptureChoice";
import { TemplateChoice } from "../types/choices/TemplateChoice";
import { MacroChoice } from "../types/choices/MacroChoice";
import { MultiChoice } from "../types/choices/MultiChoice";
import type IChoice from "../types/choices/IChoice";
import { currentNoteUse, describeCurrentNoteUse } from "./currentNoteUse";

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
	configure(choice);
	return choice;
}

describe("currentNoteUse", () => {
	it("is none for a capture that writes to a named note with a plain format", () => {
		expect(currentNoteUse(capture())).toBe("none");
	});

	it("requires the current note to capture to the active file", () => {
		expect(currentNoteUse(capture((c) => { c.captureToActiveFile = true; }))).toBe("required");
	});

	it("follows the append link: legacy true and requireActiveFile are required, otherwise optional", () => {
		expect(currentNoteUse(capture((c) => { c.appendLink = true; }))).toBe("required");
		expect(currentNoteUse(capture((c) => { c.appendLink = { ...requiredLink }; }))).toBe("required");
		expect(currentNoteUse(capture((c) => { c.appendLink = { ...optionalLink }; }))).toBe("optional");
		expect(currentNoteUse(template((t) => { t.appendLink = { ...optionalLink }; }))).toBe("optional");
	});

	it("ignores an append link into a specified file, which never reads the current note", () => {
		expect(currentNoteUse(capture((c) => {
			c.appendLink = { ...requiredLink, destination: { type: "specifiedFile", path: "Log.md" } };
		}))).toBe("none");
	});

	it.each(["{{LINKCURRENT}}", "{{linksection}}", "{{FILENAMECURRENT}}", "{{FOLDERCURRENT}}", "{{FOLDERCURRENT|name}}"])(
		"requires the current note for %s in a capture format, unless the append link makes it optional",
		(token) => {
			expect(currentNoteUse(capture((c) => { c.format = { enabled: true, format: `- ${token}` }; }))).toBe("required");
			expect(currentNoteUse(capture((c) => {
				c.format = { enabled: true, format: `- ${token}` };
				c.appendLink = { ...optionalLink };
			}))).toBe("optional");
		},
	);

	it("ignores a disabled capture format", () => {
		expect(currentNoteUse(capture((c) => { c.format = { enabled: false, format: "{{LINKCURRENT}}" }; }))).toBe("none");
	});

	it("reads the capture target path, where an empty token would retarget the write", () => {
		expect(currentNoteUse(capture((c) => {
			c.captureTo = "{{FOLDERCURRENT}}/Log.md";
			c.appendLink = { ...optionalLink };
		}))).toBe("required");
		expect(currentNoteUse(capture((c) => {
			c.captureTo = "Logs/{{FILENAMECURRENT}}.md";
			c.appendLink = { ...optionalLink };
		}))).toBe("required");
	});

	it("reads the line targets, where a folder token stays literal", () => {
		expect(currentNoteUse(capture((c) => {
			c.insertAfter = { ...c.insertAfter, enabled: true, after: "## {{FILENAMECURRENT}}" };
		}))).toBe("required");
		expect(currentNoteUse(capture((c) => {
			c.insertAfter = { ...c.insertAfter, enabled: true, after: "## {{FOLDERCURRENT}}" };
		}))).toBe("none");
		expect(currentNoteUse(capture((c) => {
			c.insertAfter = { ...c.insertAfter, enabled: false, after: "## {{FILENAMECURRENT}}" };
		}))).toBe("none");
		expect(currentNoteUse(capture((c) => {
			c.insertAfter = { ...c.insertAfter, enabled: true, promptHeading: true, after: "## {{FILENAMECURRENT}}" };
		}))).toBe("none");
		// An empty line target aborts and a half-empty one matches nothing, so the optional link does not help.
		expect(currentNoteUse(capture((c) => {
			c.insertBefore = { enabled: true, before: "{{LINKCURRENT}}", createIfNotFound: false, createIfNotFoundLocation: "top" };
			c.appendLink = { ...optionalLink };
		}))).toBe("required");
	});

	it("reads a named property's name, which cannot be empty", () => {
		expect(currentNoteUse(capture((c) => {
			c.propertyCapture = { property: { kind: "named", format: "{{FILENAMECURRENT}}" }, action: "set", createIfMissing: true };
			c.appendLink = { ...optionalLink };
		}))).toBe("required");
		expect(currentNoteUse(capture((c) => {
			c.propertyCapture = { property: { kind: "prompt" }, action: "set", createIfMissing: true };
		}))).toBe("none");
	});

	it("treats {{SELECTED}} as optional", () => {
		expect(currentNoteUse(capture((c) => { c.format = { enabled: true, format: "{{SELECTED}}" }; }))).toBe("optional");
		expect(currentNoteUse(template(), "> {{selected}}")).toBe("optional");
	});

	it("lets required beat optional", () => {
		expect(currentNoteUse(capture((c) => {
			c.captureToActiveFile = true;
			c.format = { enabled: true, format: "{{SELECTED}}" };
		}))).toBe("required");
	});

	it("requires the current note for a template created in its folder", () => {
		expect(currentNoteUse(template((t) => {
			t.folder = { ...t.folder, enabled: true, createInSameFolderAsActiveFile: true };
		}))).toBe("required");
		expect(currentNoteUse(template((t) => {
			t.folder = { ...t.folder, enabled: false, createInSameFolderAsActiveFile: true };
		}))).toBe("none");
	});

	it("reads the template's folders when it creates in a specified folder", () => {
		expect(currentNoteUse(template((t) => {
			t.folder = { ...t.folder, enabled: true, folders: ["Projects/{{FOLDERCURRENT|name}}"] };
			t.appendLink = { ...optionalLink };
		}))).toBe("required");
		expect(currentNoteUse(template((t) => {
			t.folder = { ...t.folder, enabled: true, chooseWhenCreatingNote: true, folders: ["Projects/{{FOLDERCURRENT|name}}"] };
		}))).toBe("none");
	});

	it("reads the template's file name and content", () => {
		expect(currentNoteUse(template((t) => {
			t.fileNameFormat = { enabled: true, format: "{{FILENAMECURRENT}} notes" };
		}))).toBe("required");
		expect(currentNoteUse(template((t) => {
			t.fileNameFormat = { enabled: true, format: "{{FOLDERCURRENT}} notes" };
			t.appendLink = { ...optionalLink };
		}))).toBe("required");
		expect(currentNoteUse(template(), "Back to {{LINKCURRENT}}")).toBe("required");
		expect(currentNoteUse(template((t) => { t.appendLink = { ...optionalLink }; }), "Back to {{LINKCURRENT}}")).toBe("optional");
		expect(currentNoteUse(template(), "# {{VALUE}}")).toBe("none");
	});

	it("survives a hand-edited template missing its folder and file name settings", () => {
		const partial = { id: "p", name: "Partial", type: "Template", command: false, templatePath: "T.md" } as IChoice;
		expect(currentNoteUse(partial, "{{LINKCURRENT}}")).toBe("required");
	});

	it("is none for macros and multis, whatever their scripts read", () => {
		expect(currentNoteUse(new MacroChoice("Macro"))).toBe("none");
		expect(currentNoteUse(new MultiChoice("Group"))).toBe("none");
	});
});

describe("describeCurrentNoteUse", () => {
	it("reads the template file from the vault, tolerating an omitted .md", async () => {
		const file = new TFile();
		file.path = "Templates/Note.md";
		const app = {
			vault: {
				getAbstractFileByPath: vi.fn((path: string) => (path === "Templates/Note.md" ? file : null)),
				cachedRead: vi.fn(async () => "See {{LINKCURRENT}}"),
			},
		} as unknown as App;

		await expect(describeCurrentNoteUse(app, template((t) => { t.templatePath = "Templates/Note"; }))).resolves.toBe("required");
		expect(app.vault.cachedRead).toHaveBeenCalledWith(file);
		await expect(describeCurrentNoteUse(app, template((t) => { t.templatePath = "Missing.md"; }))).resolves.toBe("none");
		await expect(describeCurrentNoteUse(app, capture((c) => { c.captureToActiveFile = true; }))).resolves.toBe("required");
	});
});

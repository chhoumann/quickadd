import { describe, expect, it } from "vitest";
import { CaptureChoice } from "../../types/choices/CaptureChoice";
import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import type ITemplateChoice from "../../types/choices/ITemplateChoice";
import { TemplateChoice } from "../../types/choices/TemplateChoice";
import { MORE_SETTINGS_FIELDS, hasNonDefaultMoreSettings } from "./moreSettings";

const template = (change: (choice: ITemplateChoice) => void = () => {}): ITemplateChoice => {
	const choice: ITemplateChoice = { ...new TemplateChoice("Note") };
	change(choice);
	return choice;
};
const capture = (change: (choice: ICaptureChoice) => void = () => {}): ICaptureChoice => {
	const choice: ICaptureChoice = { ...new CaptureChoice("Log") };
	change(choice);
	return choice;
};

/** A value other than a new choice's, for each setting behind More settings. */
const SET: Record<string, unknown> = {
	fileExistsBehavior: { kind: "apply", mode: "increment" },
	discoverExistingNotesBeforeCreate: true,
	appendLink: true,
	copyLinkToClipboard: true,
	openFile: true,
	dateOrigin: { kind: "ask" },
	onePageInput: "never",
	command: true,
	pickDayCommand: true,
	createFileIfItDoesntExist: { enabled: true, createWithTemplate: false, template: "" },
	eachLine: true,
	useSelectionAsCaptureValue: false,
	templater: { afterCapture: "wholeFile" },
};

describe("hasNonDefaultMoreSettings", () => {
	it("is false for a new choice of each type", () => {
		expect(hasNonDefaultMoreSettings(template())).toBe(false);
		expect(hasNonDefaultMoreSettings(capture())).toBe(false);
	});

	it.each(MORE_SETTINGS_FIELDS.Template)("counts a Template's %s", (field) => {
		expect(SET).toHaveProperty(field);
		expect(hasNonDefaultMoreSettings(template((choice) => Object.assign(choice, { [field]: SET[field] })))).toBe(true);
	});

	it.each(MORE_SETTINGS_FIELDS.Capture)("counts a Capture's %s", (field) => {
		expect(SET).toHaveProperty(field);
		expect(hasNonDefaultMoreSettings(capture((choice) => Object.assign(choice, { [field]: SET[field] })))).toBe(true);
	});

	it("counts every location but one folder or none, and subfolders", () => {
		const folder = (change: Partial<ITemplateChoice["folder"]>) =>
			hasNonDefaultMoreSettings(template((choice) => (choice.folder = { ...choice.folder, ...change })));
		expect(folder({ enabled: true, folders: ["Notes"] })).toBe(false);
		expect(folder({ enabled: true, folders: [] })).toBe(true);
		expect(folder({ enabled: true, folders: ["Notes", "Work"] })).toBe(true);
		expect(folder({ enabled: true, folders: ["Notes"], chooseFromSubfolders: true })).toBe(true);
		expect(folder({ enabled: true, createInSameFolderAsActiveFile: true })).toBe(true);
		expect(folder({ enabled: true, chooseWhenCreatingNote: true })).toBe(true);
	});

	it("reads a setting turned on and off again, or one an older version did not save, as the default", () => {
		expect(hasNonDefaultMoreSettings(template((choice) => {
			choice.appendLink = { enabled: false, placement: "newLine", requireActiveFile: false };
			choice.dateOrigin = { kind: "now" };
			delete (choice as Partial<ITemplateChoice>).copyLinkToClipboard;
		}))).toBe(false);
		expect(hasNonDefaultMoreSettings(capture((choice) => {
			choice.eachLine = false;
			choice.templater = {};
			delete (choice as Partial<ICaptureChoice>).useSelectionAsCaptureValue;
		}))).toBe(false);
	});
});

import { describe, expect, it, vi } from "vitest";

// FormatPreviewField -> FileNameDisplayFormatter and the suggesters reach the
// formatter/engine graph, which pulls obsidian-dataview's CJS require('obsidian').
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

import { App } from "obsidian";
import { render } from "@testing-library/svelte";
import { flushSync } from "svelte";
import type QuickAdd from "../../main";
import type ITemplateChoice from "../../types/choices/ITemplateChoice";
import TemplateChoiceForm from "./TemplateChoiceForm.svelte";
import { createTemplateChoiceFormProps } from "./templateChoiceFormProps.svelte";

function templateChoice(): ITemplateChoice {
	return {
		id: "t1",
		name: "My Template",
		type: "Template",
		command: false,
		templatePath: "",
		folder: {
			enabled: false,
			folders: [],
			chooseWhenCreatingNote: false,
			createInSameFolderAsActiveFile: false,
			chooseFromSubfolders: false,
		},
		fileNameFormat: { enabled: false, format: "" },
		appendLink: false,
		openFile: false,
		fileOpening: {
			location: "tab",
			direction: "vertical",
			mode: "default",
			focus: true,
		},
		fileExistsBehavior: { kind: "prompt" },
	};
}

function settingNames(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll(".setting-item-name")).map(
		(el) => el.textContent ?? "",
	);
}

const plugin = {
	getTemplateFiles: () => [],
	settings: { choices: [] },
} as unknown as QuickAdd;

function mountForm() {
	const props = createTemplateChoiceFormProps({
		choice: templateChoice(),
		app: new App(),
		plugin,
	});
	const result = render(TemplateChoiceForm, {
		props: { choice: props.choice, app: props.app, plugin: props.plugin },
	});
	return { ...result, props };
}

describe("TemplateChoiceForm", () => {
	it("reveals folder sub-settings reactively without remounting (the #1130 fix)", () => {
		const { container, props } = mountForm();
		const headerBefore = container.querySelector(".choiceNameHeaderButton");

		expect(settingNames(container)).not.toContain(
			"Choose folder when creating a new note",
		);

		// Toggling the controlling field updates the {#if} in place — the former
		// reload() would have torn down and rebuilt the whole modal here.
		props.choice.folder.enabled = true;
		flushSync();

		expect(settingNames(container)).toContain(
			"Choose folder when creating a new note",
		);
		expect(settingNames(container)).toContain(
			"Create in same folder as active file",
		);
		// Same header node => no full remount (scroll/caret would survive in-app).
		expect(container.querySelector(".choiceNameHeaderButton")).toBe(
			headerBefore,
		);
	});

	it("reveals the file-opening settings only when openFile is enabled", () => {
		const { container, props } = mountForm();
		expect(settingNames(container)).not.toContain("File Opening Location");

		props.choice.openFile = true;
		flushSync();
		expect(settingNames(container)).toContain("File Opening Location");
	});

	it("shows the file-exists mode row only for update/create categories", () => {
		const { container, props } = mountForm();
		expect(settingNames(container)).not.toContain("New file naming");

		props.choice.fileExistsBehavior = { kind: "apply", mode: "increment" };
		flushSync();
		const names = settingNames(container);
		expect(
			names.includes("New file naming") || names.includes("Update action"),
		).toBe(true);
	});
});

import { describe, expect, it, vi } from "vitest";

// FormatPreviewField -> FileNameDisplayFormatter and the suggesters reach the
// formatter/engine graph, which pulls obsidian-dataview's CJS require('obsidian').
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

import { App } from "obsidian";
import { fireEvent, render } from "@testing-library/svelte";
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

function settingItem(container: HTMLElement, name: string): HTMLElement {
	const item = Array.from(container.querySelectorAll(".setting-item")).find(
		(el) =>
			el.querySelector(".setting-item-name")?.textContent?.trim() === name,
	);
	if (!item) throw new Error(`Setting item not found: ${name}`);
	return item as HTMLElement;
}

function locationDropdown(container: HTMLElement): HTMLSelectElement {
	const el = container.querySelector<HTMLSelectElement>(
		'select.dropdown[aria-label="New note location"]',
	);
	if (!el) throw new Error("Location dropdown not found");
	return el;
}

function choiceIconInput(container: HTMLElement): HTMLInputElement {
	const el = container.querySelector<HTMLInputElement>(
		'input[aria-label="Choice icon"]',
	);
	if (!el) throw new Error("Choice icon input not found");
	return el;
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
	it("reveals the specific-folder controls reactively without remounting (the #1130 fix)", () => {
		const { container, props } = mountForm();
		const headerBefore = container.querySelector(".choiceNameHeaderButton");

		// Default (obsidian-default) mode: no folder list / subfolder control.
		expect(settingNames(container)).not.toContain("Include subfolders");
		expect(container.querySelector(".qa-folder-path-input")).toBeNull();

		// Flipping the controlling field updates the {#if} in place — the former
		// reload() would have torn down and rebuilt the whole modal here. A bare
		// `enabled` with no other flag derives to "specified" mode.
		props.choice.folder.enabled = true;
		flushSync();

		expect(settingNames(container)).toContain("Include subfolders");
		expect(container.querySelector(".qa-folder-path-input")).not.toBeNull();
		// Same header node => no full remount (scroll/caret would survive in-app).
		expect(container.querySelector(".choiceNameHeaderButton")).toBe(
			headerBefore,
		);
	});

	it("consolidates the location modes into one dropdown with four options", () => {
		const { container } = mountForm();
		expect(settingNames(container)).toContain("New note location");
		const options = Array.from(locationDropdown(container).options).map(
			(o) => o.value,
		);
		expect(options).toEqual([
			"obsidian-default",
			"specified",
			"active-file",
			"prompt",
		]);
	});

	it("opens a legacy choice on its derived mode", () => {
		const props = createTemplateChoiceFormProps({
			choice: {
				...templateChoice(),
				folder: {
					enabled: true,
					folders: [],
					chooseWhenCreatingNote: true,
					createInSameFolderAsActiveFile: false,
					chooseFromSubfolders: false,
				},
			},
			app: new App(),
			plugin,
		});
		const { container } = render(TemplateChoiceForm, {
			props: { choice: props.choice, app: props.app, plugin: props.plugin },
		});
		expect(locationDropdown(container).value).toBe("prompt");
		// "prompt" mode hides the specific-folder list.
		expect(container.querySelector(".qa-folder-path-input")).toBeNull();
	});

	it("writes the canonical booleans when a mode is selected", async () => {
		const props = createTemplateChoiceFormProps({
			choice: {
				...templateChoice(),
				folder: {
					enabled: true,
					folders: ["Notes"],
					chooseWhenCreatingNote: false,
					createInSameFolderAsActiveFile: false,
					chooseFromSubfolders: true,
				},
			},
			app: new App(),
			plugin,
		});
		const { container } = render(TemplateChoiceForm, {
			props: { choice: props.choice, app: props.app, plugin: props.plugin },
		});
		expect(locationDropdown(container).value).toBe("specified");

		await fireEvent.change(locationDropdown(container), {
			target: { value: "active-file" },
		});
		flushSync();

		expect(props.choice.folder).toMatchObject({
			enabled: true,
			createInSameFolderAsActiveFile: true,
			chooseWhenCreatingNote: false,
			// preserved across the switch (matches the old form; restored on return
			// to "specified") — only the mode-discriminant flags change
			chooseFromSubfolders: true,
			folders: ["Notes"],
		});
		expect(container.querySelector(".qa-folder-path-input")).toBeNull();
	});

	it("warns when 'specific folder' mode has no folders configured", () => {
		const { container, props } = mountForm();
		props.choice.folder.enabled = true; // -> specified mode, empty list
		flushSync();
		expect(
			container.querySelector(".qa-folder-mode-warning"),
		).not.toBeNull();

		props.choice.folder.folders = ["Notes"];
		flushSync();
		expect(container.querySelector(".qa-folder-mode-warning")).toBeNull();
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

	it("persists the copy-link-to-clipboard toggle", async () => {
		const { container, props } = mountForm();
		expect(props.choice.copyLinkToClipboard).toBeUndefined();

		const toggle = settingItem(container, "Copy link to clipboard").querySelector(
			".checkbox-container",
		) as HTMLElement;
		await fireEvent.click(toggle);
		flushSync();

		expect(props.choice.copyLinkToClipboard).toBe(true);
		expect(toggle.classList.contains("is-enabled")).toBe(true);
	});

	it("edits the choice icon override and clears back to the default", async () => {
		const { container, props } = mountForm();
		const input = choiceIconInput(container);

		expect(input.placeholder).toBe("file-text");
		expect(
			container.querySelector(".qa-choice-icon-setting-preview svg"),
		).toHaveAttribute("data-icon", "file-text");

		await fireEvent.input(input, { target: { value: "star" } });
		flushSync();
		expect(props.choice.icon).toBe("star");
		expect(
			container.querySelector(".qa-choice-icon-setting-preview svg"),
		).toHaveAttribute("data-icon", "star");

		await fireEvent.input(input, { target: { value: "   " } });
		flushSync();
		expect(props.choice.icon).toBeUndefined();
		expect(
			container.querySelector(".qa-choice-icon-setting-preview svg"),
		).toHaveAttribute("data-icon", "file-text");
	});
});

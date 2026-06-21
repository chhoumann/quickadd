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

function templateChoice(overrides: Partial<ITemplateChoice> = {}): ITemplateChoice {
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
		discoverExistingNotesBeforeCreate: false,
		appendLink: false,
		openFile: false,
		fileOpening: {
			location: "tab",
			direction: "vertical",
			mode: "default",
			focus: true,
		},
		fileExistsBehavior: { kind: "prompt" },
		...overrides,
	};
}

const plugin = {
	getTemplateFiles: () => [],
	settings: { choices: [] },
} as unknown as QuickAdd;

function mountForm(overrides: Partial<ITemplateChoice> = {}) {
	const props = createTemplateChoiceFormProps({
		choice: templateChoice(overrides),
		app: new App(),
		plugin,
	});
	const result = render(TemplateChoiceForm, {
		props: { choice: props.choice, app: props.app, plugin: props.plugin },
	});
	return { ...result, props };
}

function settingItem(container: HTMLElement, name: string): HTMLElement {
	const item = Array.from(container.querySelectorAll(".setting-item")).find(
		(el) =>
			el.querySelector(".setting-item-name")?.textContent?.trim() === name,
	);
	if (!item) throw new Error(`Setting item not found: ${name}`);
	return item as HTMLElement;
}

describe("TemplateChoiceForm — empty folder Add is a no-op (audit)", () => {
	it("ignores a blank/whitespace Add and keeps the empty-folders warning visible", async () => {
		const { container, props } = mountForm();
		props.choice.folder.enabled = true; // -> specified mode, empty list
		flushSync();

		// Sanity: the "add at least one folder" warning is showing.
		expect(container.querySelector(".qa-folder-mode-warning")).not.toBeNull();

		const input = container.querySelector<HTMLInputElement>(
			".qa-folder-path-input",
		);
		const addButton = Array.from(
			container.querySelectorAll<HTMLButtonElement>("button"),
		).find((b) => b.textContent?.trim() === "Add");
		expect(input).not.toBeNull();
		expect(addButton).not.toBeNull();

		// Type only whitespace, then click Add.
		await fireEvent.input(input!, { target: { value: "   " } });
		await fireEvent.click(addButton!);
		flushSync();

		// No empty entry was pushed, and the warning still shows.
		expect(props.choice.folder.folders).toEqual([]);
		expect(container.querySelector(".qa-folder-mode-warning")).not.toBeNull();
	});

	it("still adds a real folder name", async () => {
		const { container, props } = mountForm();
		props.choice.folder.enabled = true;
		flushSync();

		const input = container.querySelector<HTMLInputElement>(
			".qa-folder-path-input",
		);
		const addButton = Array.from(
			container.querySelectorAll<HTMLButtonElement>("button"),
		).find((b) => b.textContent?.trim() === "Add");

		await fireEvent.input(input!, { target: { value: "Notes" } });
		await fireEvent.click(addButton!);
		flushSync();

		expect(props.choice.folder.folders).toEqual(["Notes"]);
		expect(container.querySelector(".qa-folder-mode-warning")).toBeNull();
	});
});

describe("TemplateChoiceForm — disabled discovery toggle shows unchecked (audit)", () => {
	it("renders the discovery toggle unchecked when a custom format disables it, despite a stored true", () => {
		// Stored value is true, but the custom file-name format makes discovery
		// unsupported. The engine ignores the flag, so the toggle must display as
		// off (not a misleading checked-but-greyed state).
		const { container } = mountForm({
			discoverExistingNotesBeforeCreate: true,
			fileNameFormat: { enabled: true, format: "Project {{VALUE}}" },
		});

		const item = settingItem(container, "Search existing notes before creating");
		const checkbox = item.querySelector<HTMLInputElement>(
			'input[type="checkbox"]',
		);
		const container_el = item.querySelector<HTMLElement>(".checkbox-container");

		expect(container_el?.classList.contains("is-disabled")).toBe(true);
		expect(checkbox?.checked).toBe(false);
	});

	it("renders the discovery toggle checked when supported and stored true", () => {
		const { container } = mountForm({
			discoverExistingNotesBeforeCreate: true,
			fileNameFormat: { enabled: false, format: "" },
		});

		const item = settingItem(container, "Search existing notes before creating");
		const checkbox = item.querySelector<HTMLInputElement>(
			'input[type="checkbox"]',
		);

		expect(checkbox?.checked).toBe(true);
	});
});

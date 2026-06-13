import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

import { App } from "obsidian";
import { fireEvent, render } from "@testing-library/svelte";
import { flushSync } from "svelte";
import type QuickAdd from "../../main";
import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import CaptureChoiceForm from "./CaptureChoiceForm.svelte";
import { createCaptureChoiceFormProps } from "./captureChoiceFormProps.svelte";

function captureChoice(): ICaptureChoice {
	return {
		id: "c1",
		name: "My Capture",
		type: "Capture",
		command: false,
		captureTo: "Inbox.md",
		captureToActiveFile: false,
		captureToCanvasNodeId: "",
		activeFileWritePosition: "cursor",
		createFileIfItDoesntExist: {
			enabled: false,
			createWithTemplate: false,
			template: "",
		},
		format: { enabled: false, format: "" },
		prepend: false,
		appendLink: false,
		task: false,
		insertAfter: {
			enabled: false,
			after: "",
			insertAtEnd: false,
			considerSubsections: false,
			createIfNotFound: false,
			createIfNotFoundLocation: "top",
		},
		insertBefore: {
			enabled: false,
			before: "",
			createIfNotFound: false,
			createIfNotFoundLocation: "top",
		},
		newLineCapture: { enabled: false, direction: "below" },
		openFile: false,
		fileOpening: {
			location: "tab",
			direction: "vertical",
			mode: "default",
			focus: true,
		},
	};
}

const plugin = {
	getTemplateFiles: () => [],
	settings: { choices: [] },
} as unknown as QuickAdd;

function settingNames(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll(".setting-item-name")).map(
		(el) => el.textContent ?? "",
	);
}

function selectUnderSetting(
	container: HTMLElement,
	name: string,
): HTMLSelectElement {
	const item = Array.from(container.querySelectorAll(".setting-item")).find(
		(el) => el.querySelector(".setting-item-name")?.textContent === name,
	);
	return item?.querySelector("select") as HTMLSelectElement;
}

function mountForm() {
	const props = createCaptureChoiceFormProps({
		choice: captureChoice(),
		app: new App(),
		plugin,
	});
	const result = render(CaptureChoiceForm, {
		props: { choice: props.choice, app: props.app, plugin: props.plugin },
	});
	return { ...result, props };
}

describe("CaptureChoiceForm", () => {
	it("reveals insert-after / insert-before fields by write position, mutually exclusive, without remounting", async () => {
		const { container } = mountForm();
		const headerBefore = container.querySelector(".choiceNameHeaderButton");
		expect(settingNames(container)).not.toContain("Insert after");

		const select = selectUnderSetting(container, "Write position");
		await fireEvent.change(select, { target: { value: "after" } });
		flushSync();
		expect(settingNames(container)).toContain("Insert after");
		expect(settingNames(container)).not.toContain("Insert before");

		await fireEvent.change(select, { target: { value: "before" } });
		flushSync();
		expect(settingNames(container)).toContain("Insert before");
		expect(settingNames(container)).not.toContain("Insert after");

		// No full remount across all those conditional changes (#1130).
		expect(container.querySelector(".choiceNameHeaderButton")).toBe(
			headerBefore,
		);
	});

	it("hides the create/open/file-opening sections when capturing to the active file", () => {
		const { container, props } = mountForm();
		expect(settingNames(container)).toContain("Create file if it doesn't exist");

		props.choice.captureToActiveFile = true;
		flushSync();
		const names = settingNames(container);
		expect(names).not.toContain("Create file if it doesn't exist");
		expect(names).not.toContain("Open");
	});

	it("persists write-position edits onto the form proxy (snapshot reflects them)", async () => {
		const { container, props } = mountForm();
		const select = selectUnderSetting(container, "Write position");
		await fireEvent.change(select, { target: { value: "before" } });
		flushSync();
		// Mutual-exclusivity zeroing held: only insertBefore is enabled.
		expect(props.choice.insertBefore?.enabled).toBe(true);
		expect(props.choice.insertAfter.enabled).toBe(false);
		expect(props.choice.prepend).toBe(false);
	});
});

import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

import { App } from "obsidian";
import { render } from "@testing-library/svelte";
import { tick } from "svelte";
import type QuickAdd from "../../../main";
import type ICaptureChoice from "../../../types/choices/ICaptureChoice";
import CaptureTargetSetting from "./CaptureTargetSetting.svelte";

const plugin = {
	getTemplateFiles: () => [],
	settings: { choices: [] },
} as unknown as QuickAdd;

function captureChoice(overrides: Partial<ICaptureChoice> = {}): ICaptureChoice {
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
		newLineCapture: { enabled: false, direction: "below" },
		openFile: false,
		fileOpening: {
			location: "tab",
			direction: "vertical",
			mode: "default",
			focus: true,
		},
		...overrides,
	};
}

function nodeIdInput(container: HTMLElement): HTMLInputElement | null {
	return container.querySelector('input[aria-label="Canvas node id"]');
}

async function settle() {
	await tick();
	await tick();
}

describe("CaptureTargetSetting canvas node id required validation (audit)", () => {
	it("marks the canvas node id field invalid when the target is a .canvas path and the id is empty", async () => {
		const { container } = render(CaptureTargetSetting, {
			props: {
				choice: captureChoice({
					captureTo: "Boards/Tasks.canvas",
					captureToCanvasNodeId: "",
				}),
				app: new App(),
				plugin,
			},
		});

		await settle();

		const input = nodeIdInput(container);
		expect(input).not.toBeNull();
		// Empty + required => invalid, surfacing the misconfiguration in the builder
		// instead of only at run time.
		expect(input?.getAttribute("aria-invalid")).toBe("true");
	});

	it("does not flag the canvas node id field once an id is provided", async () => {
		const { container } = render(CaptureTargetSetting, {
			props: {
				choice: captureChoice({
					captureTo: "Boards/Tasks.canvas",
					captureToCanvasNodeId: "abcdef123456",
				}),
				app: new App(),
				plugin,
			},
		});

		await settle();

		const input = nodeIdInput(container);
		expect(input).not.toBeNull();
		expect(input?.getAttribute("aria-invalid")).toBe("false");
	});

	it("does not render the canvas node id field for a non-canvas target", async () => {
		const { container } = render(CaptureTargetSetting, {
			props: {
				choice: captureChoice({ captureTo: "Inbox.md" }),
				app: new App(),
				plugin,
			},
		});

		await settle();

		expect(nodeIdInput(container)).toBeNull();
	});
});

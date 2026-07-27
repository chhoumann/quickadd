import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

import { App } from "obsidian";
import { render } from "@testing-library/svelte";
import { tick } from "svelte";
import type QuickAdd from "../../../main";
import type ICaptureChoice from "../../../types/choices/ICaptureChoice";
import CaptureTargetSetting from "./CaptureTargetSetting.svelte";

/**
 * Pins the gate that keeps #1578's illegal-character diagnostic off the capture
 * target field.
 *
 * `FileNameDisplayFormatter` previews FILE NAMES, and a colon in a name is
 * fatal - so it reports one for `property:status=done` too, which is capture
 * TARGET syntax and not a path at all. Teaching that formatter capture semantics
 * would be the wrong layer (the same class previews a Template choice's file
 * name, where a literal `property:x=y` IS a path and the colon IS the problem),
 * so the surface is what knows the difference: this component renders no
 * preview row while the field holds recognised picker syntax.
 *
 * Without a test the gate is one `{#if}` away from silently disappearing and
 * putting a wrong red error under every property/tag capture target.
 */
const plugin = {
	getTemplateFiles: () => [],
	settings: {
		choices: [],
		// The run resolves a capture target's format tokens BEFORE parsing it, so
		// picker syntax can arrive from a snippet rather than being typed.
		globalVariables: { inbox: "property:type=draft" },
	},
} as unknown as QuickAdd;

function captureChoice(captureTo: string): ICaptureChoice {
	return {
		id: "c1",
		name: "My Capture",
		type: "Capture",
		command: false,
		captureTo,
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
	} as ICaptureChoice;
}

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

async function renderTarget(captureTo: string) {
	const { container } = render(CaptureTargetSetting, {
		props: { choice: captureChoice(captureTo), app: new App(), plugin },
	});
	// The preview resolves asynchronously; the row mounts empty and is filled.
	await vi.advanceTimersByTimeAsync(0);
	await tick();
	await tick();
	return container;
}

describe("#1578 the capture target's picker syntax gets no file-name preview", () => {
	it.each([
		["a property target", "property:status=done"],
		["a tag filter target", "tag:#inbox"],
		["a folder filter target", "folder:Work"],
		["a bare tag target", "#inbox"],
		[
			"picker syntax a token expands to",
			"{{GLOBAL_VAR:inbox}}",
		],
	])("renders no preview row for %s", async (_label, captureTo) => {
		const container = await renderTarget(captureTo);
		expect(container.querySelector(".qa-preview-row")).toBeNull();
	});

	it("still previews an ordinary path target", async () => {
		const container = await renderTarget("Inbox.md");
		expect(container.querySelector(".qa-preview-row")?.textContent).toContain(
			"Inbox.md",
		);
	});

	it("shows the row when picker-looking text came out of a FAILED pass", async () => {
		// `{{GLOBAL_VAR:inbox}}{{TEMPLATE:missing.md}}` resolves to picker syntax
		// followed by a not-found placeholder, and the run aborts on the missing
		// template. Hiding the row on the resolved text alone would take the one
		// message that explains that with it.
		const container = await renderTarget(
			"{{GLOBAL_VAR:inbox}}{{TEMPLATE:missing.md}}",
		);
		await vi.advanceTimersByTimeAsync(600);
		await tick();
		expect(container.querySelector(".qa-preview-issue")?.textContent).toContain(
			"Template not found",
		);
	});

	it("still reports an impossible PATH target - the positive control", async () => {
		// Without this the suite could not tell "the gate works" from "this
		// component never shows a diagnostic": the row's problems are held back
		// until the field has been still for DIAGNOSTICS_IDLE_MS.
		const container = await renderTarget("Bad: name.md");
		await vi.advanceTimersByTimeAsync(600);
		await tick();
		expect(container.querySelector(".qa-preview-issue")?.textContent).toContain(
			'cannot contain ":"',
		);
	});
});

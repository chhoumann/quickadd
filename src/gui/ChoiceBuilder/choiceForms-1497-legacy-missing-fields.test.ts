import { describe, expect, it, vi } from "vitest";

// FormatPreviewField -> formatter graph pulls obsidian-dataview's CJS require.
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

import { App } from "obsidian";
import { fireEvent, render } from "@testing-library/svelte";
import type QuickAdd from "../../main";
import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import type ITemplateChoice from "../../types/choices/ITemplateChoice";
import CaptureChoiceForm from "./CaptureChoiceForm.svelte";
import TemplateChoiceForm from "./TemplateChoiceForm.svelte";
import Toggle from "../components/Toggle.svelte";
import { createCaptureChoiceFormProps } from "./captureChoiceFormProps.svelte";
import { createTemplateChoiceFormProps } from "./templateChoiceFormProps.svelte";
import { TemplateChoiceBuilder } from "./templateChoiceBuilder";

// Regression tests for #1497: choices saved before an optional boolean field
// existed persist WITHOUT that field. Svelte 5 hard-throws (props_invalid_value)
// when such an `undefined` is bound to a $bindable prop that has a fallback,
// which aborted the whole choice-edit modal mount and left it blank.

const plugin = {
	getTemplateFiles: () => [],
	settings: { choices: [] },
} as unknown as QuickAdd;

/**
 * A Capture choice as persisted by QuickAdd before `considerSubsections`
 * (2023) existed: insertAfter enabled, field absent. Mirrors the reporter's
 * data.json excerpt.
 */
function legacyCaptureChoice(): ICaptureChoice {
	return {
		id: "c1",
		name: "Legacy Capture",
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
			enabled: true,
			after: "## Work",
			insertAtEnd: true,
			createIfNotFound: true,
			createIfNotFoundLocation: "bottom",
		} as ICaptureChoice["insertAfter"],
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

/**
 * A Template choice as persisted before `chooseFromSubfolders` (2023) existed,
 * in the exact shape that crashed: fixed destination folder ("specified" mode),
 * so the subfolders toggle actually renders.
 */
function legacyTemplateChoice(): ITemplateChoice {
	return {
		id: "t1",
		name: "Legacy Template",
		type: "Template",
		command: false,
		templatePath: "Templates/Note.md",
		folder: {
			enabled: true,
			folders: ["Areas/Work"],
			chooseWhenCreatingNote: false,
			createInSameFolderAsActiveFile: false,
		} as ITemplateChoice["folder"],
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

describe("choice edit forms tolerate legacy choices missing newer fields (#1497)", () => {
	it("CaptureChoiceForm mounts when insertAfter.considerSubsections is missing", () => {
		const props = createCaptureChoiceFormProps({
			choice: legacyCaptureChoice(),
			app: new App(),
			plugin,
		});
		const { container } = render(CaptureChoiceForm, {
			props: { choice: props.choice, app: props.app, plugin: props.plugin },
		});
		// The modal body actually rendered (it was completely blank before).
		expect(container.querySelectorAll(".setting-item").length).toBeGreaterThan(0);
		// The section-local defaults backfilled the missing fields on the proxy,
		// so the next save persists a fully-shaped insertAfter.
		expect(props.choice.insertAfter.considerSubsections).toBe(false);
	});

	it("CaptureChoiceForm mounts when insertAfter.insertAtEnd (2021) is also missing", () => {
		const choice = legacyCaptureChoice();
		delete (choice.insertAfter as Partial<ICaptureChoice["insertAfter"]>)
			.insertAtEnd;
		const props = createCaptureChoiceFormProps({
			choice,
			app: new App(),
			plugin,
		});
		const { container } = render(CaptureChoiceForm, {
			props: { choice: props.choice, app: props.app, plugin: props.plugin },
		});
		expect(container.querySelectorAll(".setting-item").length).toBeGreaterThan(0);
		expect(props.choice.insertAfter.insertAtEnd).toBe(false);
	});

	it("TemplateChoiceForm mounts when folder.chooseFromSubfolders is missing", async () => {
		const props = createTemplateChoiceFormProps({
			choice: legacyTemplateChoice(),
			app: new App(),
			plugin,
		});
		const { container } = render(TemplateChoiceForm, {
			props: { choice: props.choice, app: props.app, plugin: props.plugin },
		});
		expect(container.querySelectorAll(".setting-item").length).toBeGreaterThan(0);

		// The subfolders toggle itself rendered (it is the row that crashed).
		const subfoldersItem = Array.from(
			container.querySelectorAll(".setting-item"),
		).find(
			(el) =>
				el.querySelector(".setting-item-name")?.textContent?.trim() ===
				"Include subfolders",
		);
		expect(subfoldersItem).toBeDefined();
		const toggle =
			subfoldersItem?.querySelector<HTMLElement>(".checkbox-container");
		if (!toggle) throw new Error("Subfolders toggle not rendered");
		expect(toggle.classList.contains("is-enabled")).toBe(false);

		// Flipping it writes a real boolean back onto the choice.
		await fireEvent.click(toggle);
		expect(props.choice.folder.chooseFromSubfolders).toBe(true);
	});

	it("TemplateChoiceBuilder backfills chooseFromSubfolders so close persists a full shape", async () => {
		// The real edit path: builder normalizeChoice runs before the form mounts,
		// and the choice resolved at close carries the backfilled field even when
		// the user never touches the subfolders toggle.
		const builder = new TemplateChoiceBuilder(
			new App(),
			legacyTemplateChoice(),
			plugin,
		);
		builder.close();
		const resolved = (await builder.waitForClose) as ITemplateChoice;
		expect(resolved.folder.chooseFromSubfolders).toBe(false);
	});

	it("TemplateChoiceBuilder backfills a bare hand-edited choice (no folder/fileNameFormat at all)", async () => {
		// A minimal, hand-edited/imported Template choice: only identity fields.
		// Before the per-field backfills, normalizeChoice threw on
		// `folder.chooseFromSubfolders` and the modal mounted blank.
		const bare = {
			id: "t2",
			name: "Bare Template",
			type: "Template",
			command: false,
		} as unknown as ITemplateChoice;
		const builder = new TemplateChoiceBuilder(new App(), bare, plugin);
		builder.close();
		const resolved = (await builder.waitForClose) as ITemplateChoice;
		expect(resolved.templatePath).toBe("");
		expect(resolved.fileNameFormat).toEqual({ enabled: false, format: "" });
		expect(resolved.folder).toEqual({
			enabled: false,
			folders: [],
			chooseWhenCreatingNote: false,
			createInSameFolderAsActiveFile: false,
			chooseFromSubfolders: false,
		});
	});

	it("TemplateChoiceBuilder backfills PARTIAL nested configs field by field", async () => {
		// `folder: { enabled: true }` (no folders array) and
		// `fileNameFormat: { enabled: true }` (no format) are the partial shapes
		// the whole-object ??= backfill missed: the form dereferences
		// `folder.folders.length` and binds `fileNameFormat.format`.
		const partial = {
			id: "t3",
			name: "Partial Template",
			type: "Template",
			command: false,
			folder: { enabled: true },
			fileNameFormat: { enabled: true },
		} as unknown as ITemplateChoice;
		const builder = new TemplateChoiceBuilder(new App(), partial, plugin);
		builder.close();
		const resolved = (await builder.waitForClose) as ITemplateChoice;
		expect(resolved.folder.enabled).toBe(true);
		expect(resolved.folder.folders).toEqual([]);
		expect(resolved.folder.chooseFromSubfolders).toBe(false);
		expect(resolved.fileNameFormat).toEqual({ enabled: true, format: "" });
	});

	it("Toggle accepts an undefined binding and writes a boolean on flip", async () => {
		const model = { flag: undefined as boolean | undefined };
		const { container } = render(Toggle, {
			props: {
				get checked() {
					return model.flag;
				},
				set checked(v: boolean | undefined) {
					model.flag = v;
				},
			},
		});
		const el = container.querySelector<HTMLElement>(".checkbox-container");
		if (!el) throw new Error("Toggle did not render");
		expect(el.classList.contains("is-enabled")).toBe(false);
		expect(el.getAttribute("aria-checked")).toBe("false");
		await fireEvent.click(el);
		expect(model.flag).toBe(true);
	});
});

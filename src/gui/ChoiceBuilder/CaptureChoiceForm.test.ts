import { settingItem, settingNames, choiceIconInput } from "../../../tests/helpers/settings/fields";
import { describe, expect, it, vi } from "vitest";

import { App, Menu } from "obsidian";
import { fireEvent, render } from "@testing-library/svelte";
import { flushSync, tick } from "svelte";
import type QuickAdd from "../../main";
import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import CaptureChoiceForm from "./CaptureChoiceForm.svelte";
import { createCaptureChoiceFormProps } from "./captureChoiceFormProps.svelte";
import { CaptureChoice } from "../../types/choices/CaptureChoice";

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


function selectUnderSetting(
	container: HTMLElement,
	name: string,
): HTMLSelectElement {
	const item = Array.from(container.querySelectorAll(".setting-item")).find(
		(el) => el.querySelector(".setting-item-name")?.textContent === name,
	);
	return item?.querySelector("select") as HTMLSelectElement;
}



function mountForm(choice: ICaptureChoice = captureChoice()) {
	const props = createCaptureChoiceFormProps({
		choice,
		app: new App(),
		plugin,
	});
	const result = render(CaptureChoiceForm, {
		props: { choice: props.choice, app: props.app, plugin: props.plugin },
	});
	return { ...result, props };
}

async function settleValidation() {
	await tick();
	await tick();
	// The preview row resolves through an async formatter, so a macrotask flush is
	// required on top of the microtask ticks before asserting on preview rows.
	await new Promise((resolve) => setTimeout(resolve, 0));
	await tick();
}

function describedHint(
	container: HTMLElement,
	input: HTMLInputElement,
): HTMLElement {
	const hintId = input.getAttribute("aria-describedby");
	return container.querySelector(`#${hintId}`) as HTMLElement;
}

function previewRows(container: HTMLElement): HTMLElement[] {
	return Array.from(container.querySelectorAll(".qa-preview-row"));
}

describe("CaptureChoiceForm", () => {
	it("persists property settings and hides dormant body controls until switching back", async () => {
		const { container, props, getByLabelText } = mountForm();
		props.choice.insertAfter.enabled = true;
		props.choice.task = true;
		flushSync();
		expect(selectUnderSetting(container, "Write position").value).toBe("after");
		await fireEvent.change(selectUnderSetting(container, "Write position"), { target: { value: "property" } });
		flushSync();
		expect(selectUnderSetting(container, "Write position").value).toBe("property");
		expect(settingNames(container)).not.toContain("Insert after");
		expect(settingNames(container)).not.toContain("Task");
		expect(settingNames(container)).toContain("Create property if missing");
		await fireEvent.input(getByLabelText("Property"), { target: { value: "{{VALUE:property}}" } });
		await fireEvent.change(selectUnderSetting(container, "Action"), { target: { value: "addToList" } });
		flushSync();
		expect(props.choice.propertyCapture).toEqual({ property: { kind: "named", format: "{{VALUE:property}}" }, action: "addToList", createIfMissing: true });
		await fireEvent.change(selectUnderSetting(container, "Property"), { target: { value: "prompt" } });
		flushSync();
		expect(props.choice.propertyCapture?.property).toEqual({ kind: "prompt" });
		await fireEvent.change(selectUnderSetting(container, "Property"), { target: { value: "named" } });
		flushSync();
		expect(getByLabelText("Property")).toHaveValue("{{VALUE:property}}");
		expect(props.choice.propertyCapture?.property).toEqual({ kind: "named", format: "{{VALUE:property}}" });
		await fireEvent.input(getByLabelText("Property"), { target: { value: "status" } });
		await fireEvent.change(selectUnderSetting(container, "Property"), { target: { value: "prompt" } });
		await fireEvent.change(selectUnderSetting(container, "Property"), { target: { value: "named" } });
		flushSync();
		expect(getByLabelText("Property")).toHaveValue("status");
		await fireEvent.change(selectUnderSetting(container, "Write position"), { target: { value: "bottom" } });
		flushSync();
		expect(props.choice.propertyCapture).toBeUndefined();
		expect(settingNames(container)).toContain("Task");
	});

	// #1748: for a list destination each line of the Capture format is one item.
	// There is no control for it, so the form copy has to say it where the author
	// is already looking: the Action description and the format textarea.
	it("tells the author that lines are list items once the capture writes to a property", async () => {
		const { container, props } = mountForm();
		props.choice.format.enabled = true;
		flushSync();
		const actionDesc = () => settingItem(container, "Action").querySelector(".setting-item-description")?.textContent ?? "";
		const textarea = () => settingItem(container, "Capture format").closest(".qa-field")?.querySelector("textarea") as HTMLTextAreaElement;
		expect(textarea().placeholder).toBe("{{VALUE}}");

		await fireEvent.change(selectUnderSetting(container, "Write position"), { target: { value: "property" } });
		flushSync();
		expect(actionDesc()).toContain("For a list, each line is one item");
		expect(actionDesc()).toContain("{{PROPERTY}}");
		expect(actionDesc()).toContain("rejects several lines");
		expect(textarea().placeholder).toBe("{{VALUE}}");

		await fireEvent.change(selectUnderSetting(container, "Action"), { target: { value: "addToList" } });
		flushSync();
		expect(actionDesc()).toContain("Each line is one item");
		expect(actionDesc()).toContain("{{PROPERTY}}");
		expect(textarea().placeholder).toBe("One item per line");

		await fireEvent.change(selectUnderSetting(container, "Write position"), { target: { value: "bottom" } });
		flushSync();
		expect(textarea().placeholder).toBe("{{VALUE}}");
	});

	it("reveals insert-after / insert-before fields by write position, mutually exclusive, without remounting", async () => {
		const { container } = mountForm();
		const headerBefore = container.querySelector(".setting-item-heading");
		expect(headerBefore).not.toBeNull();
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
		expect(container.querySelector(".setting-item-heading")).toBe(
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

	it("stays reactive for a freshly created class-instance choice (add-new flow)", () => {
		// createChoice() returns `new CaptureChoice()` — a class instance. Svelte's
		// proxy() leaves class instances un-proxied, so the form props factory must
		// plain-clone the choice or conditional rows won't react. This test fails if
		// the structuredClone in createCaptureChoiceFormProps is removed.
		const props = createCaptureChoiceFormProps({
			choice: new CaptureChoice("New Capture"),
			app: new App(),
			plugin,
		});
		const { container } = render(CaptureChoiceForm, {
			props: { choice: props.choice, app: props.app, plugin: props.plugin },
		});
		expect(settingNames(container)).toContain("Create file if it doesn't exist");

		props.choice.captureToActiveFile = true;
		flushSync();
		expect(settingNames(container)).not.toContain(
			"Create file if it doesn't exist",
		);
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

	it("edits the choice icon override and previews the default", async () => {
		const { container, props } = mountForm();
		const input = choiceIconInput(container);

		expect(input.placeholder).toBe("pencil");
		expect(
			container.querySelector(".qa-choice-icon-setting-preview svg"),
		).toHaveAttribute("data-icon", "pencil");

		await fireEvent.input(input, { target: { value: "inbox" } });
		flushSync();

		expect(props.choice.icon).toBe("inbox");
		expect(
			container.querySelector(".qa-choice-icon-setting-preview svg"),
		).toHaveAttribute("data-icon", "inbox");
	});

	it("keeps the optional icon override last, above the inputs and the steps", async () => {
		const { container } = mountForm();
		await vi.waitFor(() => expect(settingNames(container)).toContain("Inputs"));

		const names = settingNames(container);
		expect(names.slice(names.indexOf("Inputs") - 1, names.indexOf("Inputs") + 1)).toEqual(["Icon", "Inputs"]);
		expect(names.at(-1)).toBe("Steps");
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

	// #1544: the capture target used to be described by three rows — a control-less
	// "Capture to", the "Capture to active file" toggle, a control-less "File path /
	// format" — and the input that actually holds it advertised itself as a *file
	// name* format. One decision, one label, one description, one input.
	// #2014: the whole-file Templater pass is deprecated. Only a choice that
	// already has it on still sees the row, so it can turn it off.
	it("shows the deprecated whole-file Templater option only while it is on", async () => {
		const { container, props } = mountForm();
		const rowName = "Run Templater on entire destination file after capture (deprecated)";
		expect(settingNames(container)).not.toContain(rowName);

		props.choice.templater = { afterCapture: "wholeFile" };
		flushSync();
		const toggle = settingItem(container, rowName).querySelector(".checkbox-container") as HTMLElement;
		expect(toggle.classList.contains("is-enabled")).toBe(true);

		await fireEvent.click(toggle);
		flushSync();
		expect(props.choice.templater.afterCapture).toBe("none");
		expect(settingNames(container)).not.toContain(rowName);
	});

	// #2023: one click targets the daily note through {{DAILY}}.
	it("fills in the daily note from the Daily note button", async () => {
		const { container, props } = mountForm();
		props.choice.createFileIfItDoesntExist = { enabled: false, createWithTemplate: true, template: "T.md" };
		flushSync();
		const button = () => [...settingItem(container, "Capture to").querySelectorAll("button")]
			.find((el) => el.textContent === "Daily note");

		await fireEvent.click(button()!);
		flushSync();

		expect(props.choice.captureTo).toBe("{{DAILY}}");
		expect(props.choice.createFileIfItDoesntExist).toEqual({ enabled: true, createWithTemplate: false, template: "T.md" });
		expect(button()).toBeUndefined();
	});

	it("describes the capture target with a single labelled field", () => {
		const { container, getByLabelText } = mountForm();
		const names = settingNames(container);

		expect(names).not.toContain("File path / format");
		expect(names.filter((name) => name === "Capture to")).toHaveLength(1);

		const input = getByLabelText("Capture to") as HTMLInputElement;
		expect(input.placeholder).toBe("Daily/{{DATE}}.md");

		// The label is a real <label for>, and the field lives in the same group.
		const label = container.querySelector(
			"label.setting-item-name",
		) as HTMLLabelElement;
		expect(label.htmlFor).toBe(input.id);
		expect(input.closest(".qa-field")).toBe(label.closest(".qa-field"));
	});

	it("treats an empty capture format as capturing {{VALUE}} on its own", async () => {
		const { container, props } = mountForm();
		const textarea = settingItem(container, "Capture format")
			.closest(".qa-field")
			?.querySelector("textarea") as HTMLTextAreaElement;
		expect(textarea.value).toBe("");
		expect(props.choice.format.enabled).toBe(false);

		textarea.value = "- {{VALUE}}";
		await fireEvent.input(textarea);
		expect(props.choice.format).toEqual({ enabled: true, format: "- {{VALUE}}" });

		textarea.value = "";
		await fireEvent.input(textarea);
		expect(props.choice.format.enabled).toBe(false);
	});

	// #2004 review: a format that starts with whitespace (an indented item) was
	// erased while it had no other text yet.
	it("keeps leading whitespace typed into an empty capture format", async () => {
		const { container, props } = mountForm();
		const textarea = settingItem(container, "Capture format")
			.closest(".qa-field")
			?.querySelector("textarea") as HTMLTextAreaElement;

		textarea.value = "\t";
		await fireEvent.input(textarea);
		flushSync();
		expect(textarea.value).toBe("\t");
		expect(props.choice.format).toEqual({ enabled: false, format: "\t" });

		textarea.value = "\t- {{VALUE}}";
		await fireEvent.input(textarea);
		flushSync();
		expect(textarea.value).toBe("\t- {{VALUE}}");
		expect(props.choice.format).toEqual({ enabled: true, format: "\t- {{VALUE}}" });
	});

	it("shows an old choice's disabled format as empty", () => {
		const choice = new CaptureChoice("Old");
		choice.format = { enabled: false, format: "- {{VALUE}}" };
		const { container } = mountForm(choice);
		const textarea = settingItem(container, "Capture format")
			.closest(".qa-field")
			?.querySelector("textarea") as HTMLTextAreaElement;
		expect(textarea.value).toBe("");
	});

	// #1875: Tab in the format box indents, but tabbing through the form still
	// passes it by without editing it.
	it("indents the capture format on Tab once the field is in use", async () => {
		const { container, props } = mountForm();
		const textarea = settingItem(container, "Capture format")
			.closest(".qa-field")
			?.querySelector("textarea") as HTMLTextAreaElement;
		textarea.value = "- {{VALUE}}\n";
		await fireEvent.input(textarea);
		textarea.focus();
		textarea.setSelectionRange(textarea.value.length, textarea.value.length);

		expect(await fireEvent.keyDown(textarea, { key: "Tab" })).toBe(true);
		expect(props.choice.format.format).toBe("- {{VALUE}}\n");

		await fireEvent.keyDown(textarea, { key: "End" });
		expect(await fireEvent.keyDown(textarea, { key: "Tab" })).toBe(false);
		expect(props.choice.format.format).toBe("- {{VALUE}}\n\t");
	});

	// #1543: the preview used to render above the field it previews, and rendered
	// as a bare "Preview:" with nothing after it whenever the field was empty.
	it("renders the preview after the field it previews, and only once the field has a value", async () => {
		const { container, getByLabelText } = mountForm();
		const input = getByLabelText("Capture to") as HTMLInputElement;

		await settleValidation();
		const preview = previewRows(container)[0];
		expect(preview).toBeDefined();
		expect(
			input.compareDocumentPosition(preview) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();

		input.value = "";
		await fireEvent.input(input);
		await settleValidation();
		expect(previewRows(container)).toHaveLength(0);

		input.value = "Inbox.md";
		await fireEvent.input(input);
		await settleValidation();
		expect(previewRows(container)).toHaveLength(1);
		expect(previewRows(container)[0].textContent).toContain("Inbox.md");
	});

	it("shows recognized feedback and hides the path preview for picker filter targets", async () => {
		const { container, getByLabelText } = mountForm();
		const input = getByLabelText("Capture to") as HTMLInputElement;
		// Only the capture-target preview renders: the capture format is empty, and
		// an empty field shows no preview row at all (#1543).
		expect(previewRows(container)).toHaveLength(1);

		input.value = "folder:Goals|folder:Projects|tag:active";
		await fireEvent.input(input);
		await settleValidation();

		const hint = describedHint(container, input);
		expect(previewRows(container)).toHaveLength(0);
		expect(hint.textContent).toContain("Recognized filtered picker");
		expect(hint.textContent).toContain("folders Goals or Projects");
		expect(hint.textContent).toContain("tag active");
		expect(hint.classList.contains("qa-field-hint--success")).toBe(true);
		expect(input.classList.contains("is-valid")).toBe(true);
		expect(input.getAttribute("aria-invalid")).toBe("false");
	});

	it("rejects multi-select capture target filters before runtime", async () => {
		const { container, getByLabelText } = mountForm();
		const input = getByLabelText("Capture to") as HTMLInputElement;
		expect(previewRows(container)).toHaveLength(1);

		input.value = "tag:work|multi";
		await fireEvent.input(input);
		await settleValidation();

		const hint = describedHint(container, input);
		expect(previewRows(container)).toHaveLength(0);
		expect(hint.textContent).toBe(
			"Capture target filters select one destination file. Use {{FILE:...|multi}} in the capture format for multi-value metadata.",
		);
		expect(input.classList.contains("is-invalid")).toBe(true);
		expect(input.getAttribute("aria-invalid")).toBe("true");
	});

	it("does not show the canvas node picker for filter syntax that ends in .canvas", async () => {
		const { container, getByLabelText, props } = mountForm();
		const input = getByLabelText("Capture to") as HTMLInputElement;
		props.choice.captureToCanvasNodeId = "stale-node-id";

		input.value = "folder:Boards.canvas";
		await fireEvent.input(input);
		await settleValidation();

		expect(settingNames(container)).not.toContain("Target canvas node");
		expect(props.choice.captureToCanvasNodeId).toBe("");
		expect(describedHint(container, input).textContent).toContain(
			"Recognized filtered picker",
		);
	});

	describe("Steps", () => {
		const stepLines = (container: HTMLElement) =>
			Array.from(container.querySelectorAll(".qaStepsList li"), (item) => item.textContent);

		it("lists what the capture does, following the form", async () => {
			const { container } = mountForm();
			expect(stepLines(container)).toEqual(["Adds a line at the top of Inbox"]);

			await fireEvent.click(settingItem(container, "Open").querySelector(".checkbox-container") as HTMLElement);
			flushSync();
			expect(stepLines(container)).toEqual(["Adds a line at the top of Inbox", "Opens it"]);
		});

		it("offers to add a step only when the builder can take the choice on", async () => {
			expect(mountForm().container.querySelector('[aria-label="Add a step"]')).toBeNull();

			const onAddStep = vi.fn();
			const props = createCaptureChoiceFormProps({ choice: captureChoice(), app: new App(), plugin });
			const { getByRole } = render(CaptureChoiceForm, {
				props: { choice: props.choice, app: props.app, plugin: props.plugin, onAddStep },
			});
			await fireEvent.click(getByRole("button", { name: "Add a step" }));

			const menu = (Menu as unknown as { lastShown: { items: { title: string; icon: string; clickHandler: () => void }[] } }).lastShown;
			expect(menu.items.map(({ title, icon }) => [title, icon])).toEqual([
				["Run a script", "code"],
				["Open a note", "file"],
				["Wait", "clock"],
			]);
			menu.items[0].clickHandler();
			expect(onAddStep).toHaveBeenCalledWith(expect.objectContaining({ type: "runScript", path: "" }));
		});
	});
});

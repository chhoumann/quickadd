import { describe, expect, it, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { App, Component } from "obsidian";
import { renderChoiceName } from "./gui/choiceList/renderChoiceName";
import { renderDevelopmentInfo } from "./quickAddSettingsDevelopmentInfo";
import { formatDateAliasLines } from "./utils/dateAliases";
import { QuickAddSettingsTab } from "./quickAddSettingsTab";
import { settingsStore } from "./settingsStore";
import { DEFAULT_SETTINGS, type QuickAddSettings } from "./settings";
import { deepClone } from "./utils/deepClone";
import { InputPromptDraftStore } from "./utils/InputPromptDraftStore";
import type QuickAdd from "./main";

// Importing the settings tab transitively pulls in ChoiceView -> the Dataview
// integration, whose compiled CJS does a bare `require('obsidian')` that the
// vitest alias can't intercept. Mock it as the choice-list tests do.
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

function expectNoPayloadDom(el: HTMLElement): void {
	expect(el.querySelector("img, script, svg")).toBeNull();
	expect((globalThis as typeof globalThis & { __qaXss?: number }).__qaXss)
		.toBeUndefined();
}

describe("renderDevelopmentInfo", () => {
	beforeEach(() => {
		delete (globalThis as typeof globalThis & { __qaXss?: number }).__qaXss;
	});

	it("renders malicious git metadata as text while preserving labels", () => {
		const payload = "<img src=x onerror=globalThis.__qaXss=1>";
		const container = document.createElement("div");

		renderDevelopmentInfo(container, {
			branch: `feature/${payload}`,
			commit: `abc123${payload}`,
			dirty: true,
		});

		expect(container.textContent).toContain("Branch:");
		expect(container.textContent).toContain(`feature/${payload}`);
		expect(container.textContent).toContain("Commit:");
		expect(container.textContent).toContain(`abc123${payload}`);
		expect(container.textContent).toContain("Uncommitted changes:");
		expect(container.textContent).toContain("Yes (uncommitted changes)");
		expect(container.querySelector(".qa-dev-dirty-status")).not.toBeNull();
		expectNoPayloadDom(container);
	});

	it("uses clean status class for clean dev builds", () => {
		const container = document.createElement("div");

		renderDevelopmentInfo(container, {
			branch: null,
			commit: null,
			dirty: false,
		});

		expect(container.textContent).toContain("Uncommitted changes: No");
		expect(container.querySelector(".qa-dev-clean-status")).not.toBeNull();
	});
});

describe("settings user-authored DOM XSS safety", () => {
	beforeEach(() => {
		delete (globalThis as typeof globalThis & { __qaXss?: number }).__qaXss;
	});

	it("renders malicious choice and multi names through sanitized markdown", async () => {
		const payload = "<img src=x onerror=globalThis.__qaXss=1>";
		const container = document.createElement("span");

		renderChoiceName(`**Visible** ${payload}`, container, new Component(), new App());
		await Promise.resolve();

		expect(container.textContent).toContain("Visible");
		expect(container.textContent).toContain(payload);
		expect(container.querySelector("strong")?.textContent).toBe("Visible");
		expectNoPayloadDom(container);

		const multiContainer = document.createElement("span");
		renderChoiceName(`Multi ${payload}`, multiContainer, new Component(), new App());
		await Promise.resolve();

		expect(multiContainer.textContent).toContain(`Multi ${payload}`);
		expectNoPayloadDom(multiContainer);
	});

	it("keeps malicious date alias text in textarea values, not parsed DOM", () => {
		const payload = "<svg onload=globalThis.__qaXss=1>date</svg>";
		const container = document.createElement("div");
		const textarea = document.createElement("textarea");
		textarea.value = formatDateAliasLines({
			[payload]: `next ${payload}`,
		});
		container.appendChild(textarea);

		expect(textarea?.value).toContain(`${payload} = next ${payload}`);
		expect(container.textContent).not.toContain(payload);
		expectNoPayloadDom(container);
	});

	it("source settings surfaces use escaped bindings for globals and package conflicts", () => {
		const srcRoot = join(__dirname);
		const surfaces = [
			"gui/GlobalVariables/GlobalVariablesView.svelte",
			"gui/PackageManager/ImportPackageModal.svelte",
			"gui/PackageManager/ExportPackageModal.svelte",
			"gui/PackageManager/FilePreviewRow.svelte",
			"gui/PackageManager/CapabilityBanner.svelte",
			"gui/PackageManager/CapabilityTag.svelte",
			"gui/choiceList/ChoiceListItem.svelte",
			"gui/choiceList/MultiChoiceListItem.svelte",
		];

		for (const relativePath of surfaces) {
			const source = readFileSync(join(srcRoot, relativePath), "utf8");
			expect(source, relativePath).not.toContain("{@html");
		}

		const globalVariablesSource = readFileSync(
			join(srcRoot, "gui/GlobalVariables/GlobalVariablesView.svelte"),
			"utf8",
		);
		expect(globalVariablesSource).toContain("bind:value={it.name}");
		expect(globalVariablesSource).toContain("bind:value={it.value}");

		const packageImportSource = readFileSync(
			join(srcRoot, "gui/PackageManager/ImportPackageModal.svelte"),
			"utf8",
		);
		expect(packageImportSource).toContain("{conflict.name}");

		// File paths render through escaped bindings in FilePreviewRow now.
		const fileRowSource = readFileSync(
			join(srcRoot, "gui/PackageManager/FilePreviewRow.svelte"),
			"utf8",
		);
		expect(fileRowSource).toContain("{destinationPath}");
		expectNoPayloadDom(document.body);
	});
});

describe("QuickAddSettingsTab declarative bridge", () => {
	function makeTab(): QuickAddSettingsTab {
		const app = new App();
		const plugin = { app } as unknown as QuickAdd;
		return new QuickAddSettingsTab(app, plugin);
	}

	beforeEach(() => {
		settingsStore.replaceState(deepClone(DEFAULT_SETTINGS));
	});

	it("setControlValue writes through the settingsStore, not plugin.settings", () => {
		const tab = makeTab();
		const setState = vi.spyOn(settingsStore, "setState");

		tab.setControlValue("useSelectionAsCaptureValue", false);

		// The write goes through the store path — the bridge's whole contract...
		expect(setState).toHaveBeenCalledWith({
			useSelectionAsCaptureValue: false,
		});
		expect(settingsStore.getState().useSelectionAsCaptureValue).toBe(false);
		// ...and the bridge must not touch plugin.settings directly — persisting
		// plugin.settings is the main.ts store subscriber's job. Read it AFTER
		// the call so a stray write would actually be caught.
		expect(
			(tab.plugin as unknown as { settings?: QuickAddSettings }).settings,
		).toBeUndefined();
		setState.mockRestore();
	});

	it("getControlValue reads the current store value", () => {
		const tab = makeTab();

		settingsStore.setState({ showCaptureNotification: false });
		expect(tab.getControlValue("showCaptureNotification")).toBe(false);

		settingsStore.setState({ showCaptureNotification: true });
		expect(tab.getControlValue("showCaptureNotification")).toBe(true);
	});

	it("the launcher-row dropdown round-trips its enum value through the store", () => {
		const tab = makeTab();

		// Default surfaced from DEFAULT_SETTINGS.
		expect(tab.getControlValue("templateFolderLauncherRow")).toBe("bottom");

		for (const position of ["top", "off", "bottom"] as const) {
			tab.setControlValue("templateFolderLauncherRow", position);
			expect(settingsStore.getState().templateFolderLauncherRow).toBe(position);
			expect(tab.getControlValue("templateFolderLauncherRow")).toBe(position);
		}
	});

	it("maps the inputPrompt toggle to and from its enum value", () => {
		const tab = makeTab();

		tab.setControlValue("inputPrompt", true);
		expect(settingsStore.getState().inputPrompt).toBe("multi-line");
		expect(tab.getControlValue("inputPrompt")).toBe(true);

		tab.setControlValue("inputPrompt", false);
		expect(settingsStore.getState().inputPrompt).toBe("single-line");
		expect(tab.getControlValue("inputPrompt")).toBe(false);
	});

	it("clears draft storage when persist drafts is disabled", () => {
		const tab = makeTab();
		const clearAll = vi.spyOn(
			InputPromptDraftStore.getInstance(),
			"clearAll",
		);

		tab.setControlValue("persistInputPromptDrafts", true);
		expect(settingsStore.getState().persistInputPromptDrafts).toBe(true);
		expect(clearAll).not.toHaveBeenCalled();

		tab.setControlValue("persistInputPromptDrafts", false);
		expect(settingsStore.getState().persistInputPromptDrafts).toBe(false);
		expect(clearAll).toHaveBeenCalledTimes(1);

		clearAll.mockRestore();
	});

	it("exposes each section as a group whose control keys are real settings keys", () => {
		const tab = makeTab();
		const groups = tab.getSettingDefinitions() as unknown as Array<{
			type: string;
			heading?: string;
			items?: Array<{ name?: unknown; control?: { key?: string } }>;
		}>;

		// Non-dev build (vitest defines __IS_DEV_BUILD__ = false): 8 groups.
		expect(groups).toHaveLength(8);

		const validKeys = new Set(Object.keys(DEFAULT_SETTINGS));
		const controlKeys: string[] = [];

		for (const group of groups) {
			expect(group.type).toBe("group");
			expect(typeof group.heading).toBe("string");
			expect(Array.isArray(group.items)).toBe(true);

			for (const item of group.items ?? []) {
				// Every declarative definition must carry a name (search indexing).
				expect(typeof item.name).toBe("string");
				const key = item.control?.key;
				if (key) {
					controlKeys.push(key);
					expect(validKeys.has(key)).toBe(true);
				}
			}
		}

		expect(controlKeys).toEqual(
			expect.arrayContaining([
				"searchNestedChoices",
				"inputPrompt",
				"persistInputPromptDrafts",
				"useSelectionAsCaptureValue",
				"onePageInputEnabled",
				"enableTemplatePropertyTypes",
				"announceUpdates",
				"showCaptureNotification",
				"showInputCancellationNotification",
				"disableOnlineFeatures",
				"enableRibbonIcon",
			]),
		);
	});

	it("keeps nested choice search in the choice picker section", () => {
		const tab = makeTab();
		const [choicesGroup, choicePickerGroup] = tab.getSettingDefinitions() as unknown as Array<{
			heading?: string;
			items?: Array<{ name?: unknown }>;
		}>;

		expect(choicesGroup.items?.map((item) => item.name)).toEqual([
			"Choices",
			"Packages",
		]);
		expect(choicePickerGroup.heading).toBe("Choice Picker");
		expect(choicePickerGroup.items?.map((item) => item.name)).toEqual([
			"Search nested choices",
			"“New note from template” in the launcher",
		]);
	});
});

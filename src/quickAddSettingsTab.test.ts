import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Component } from "obsidian";
import { renderChoiceName } from "./gui/choiceList/renderChoiceName";
import { renderDevelopmentInfo } from "./quickAddSettingsDevelopmentInfo";
import { formatDateAliasLines } from "./utils/dateAliases";

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

		renderChoiceName(`**Visible** ${payload}`, container, new Component());
		await Promise.resolve();

		expect(container.textContent).toContain("Visible");
		expect(container.textContent).toContain(payload);
		expect(container.querySelector("strong")?.textContent).toBe("Visible");
		expectNoPayloadDom(container);

		const multiContainer = document.createElement("span");
		renderChoiceName(`Multi ${payload}`, multiContainer, new Component());
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
		expect(packageImportSource).toContain("{conflict.originalPath}");
		expectNoPayloadDom(document.body);
	});
});

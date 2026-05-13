import { App, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import {
	createTemplaterIntegration,
	TEMPLATER_PLUGIN_ID,
} from "./TemplaterIntegration";

function createMarkdownFile(path = "target.md"): TFile {
	const file = new TFile();
	file.path = path;
	file.extension = "md";
	return file;
}

describe("TemplaterIntegration", () => {
	it("reports missing plugin and no-ops optional operations", async () => {
		const app = new App();
		const file = createMarkdownFile();
		const integration = createTemplaterIntegration(app as any);

		const report = integration.getCapabilityReport();
		expect(report.installed).toBe(false);
		expect(report.missingCapabilities).toContain("parseTemplate");
		expect(integration.hasCapability("parseTemplate")).toBe(false);
		expect(integration.isTriggerOnCreateEnabled()).toBe(false);
		expect(await integration.parseTemplate("hello", file)).toBe("hello");
		expect(
			await integration.withFileCreationSuppressed("target.md", async () => 42),
		).toBe(42);

		await expect(integration.overwriteFileOnce(file)).resolves.toBeUndefined();
		await expect(
			integration.waitForTriggerOnCreateToComplete(file),
		).resolves.toBeUndefined();
		await expect(
			integration.jumpToNextCursorIfPossible(file),
		).resolves.toBeUndefined();
	});

	it("reports missing capabilities without crashing legacy-safe operations", async () => {
		const app = new App();
		const file = createMarkdownFile();
		const read = vi.fn(async () => "<% tp.file.title %>");
		(app as any).vault.read = read;
		(app as any).plugins.plugins[TEMPLATER_PLUGIN_ID] = {
			settings: {
				trigger_on_file_creation: true,
				auto_jump_to_cursor: true,
			},
			templater: {},
			editor_handler: {},
		};

		const integration = createTemplaterIntegration(app as any);
		const report = integration.getCapabilityReport();

		expect(report.installed).toBe(true);
		expect(report.capabilities.triggerOnFileCreation).toBe(true);
		expect(report.capabilities.parseTemplate).toBe(false);
		expect(report.capabilities.overwriteFileCommands).toBe(false);
		expect(report.capabilities.pendingTemplates).toBe(false);
		expect(report.capabilities.cursorJump).toBe(false);
		expect(report.missingCapabilities).toEqual(
			expect.arrayContaining([
				"parseTemplate",
				"overwriteFileCommands",
				"pendingTemplates",
				"cursorJump",
			]),
		);
		expect(await integration.parseTemplate("hello", file)).toBe("hello");

		await integration.overwriteFileOnce(file);
		expect(read).not.toHaveBeenCalled();
	});
});

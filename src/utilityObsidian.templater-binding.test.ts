import { describe, expect, it, vi } from "vitest";
import { App, TFile } from "obsidian";
import { IntegrationRegistry } from "./integrations/IntegrationRegistry";
import { registerIntegrationRegistry } from "./integrations/IntegrationRegistry";
import type { TemplaterIntegration } from "./integrations/TemplaterIntegration";
import {
	getTemplater,
	getTemplaterPlugin,
	isTemplaterTriggerOnCreateEnabled,
	jumpToNextTemplaterCursorIfPossible,
	overwriteTemplaterOnce,
	templaterParseTemplate,
	waitForTemplaterTriggerOnCreateToComplete,
	withTemplaterFileCreationSuppressed,
} from "./utilityObsidian";

describe("templaterParseTemplate", () => {
	it("calls parse_template with the correct `this` context", async () => {
		const app = new App();
		const file = new TFile();
		file.path = "QA.md";
		file.extension = "md";

		const templater = {
			functions_generator: { ok: true },
			parse_template: async function (
				this: any,
				_opts: unknown,
				content: string,
			): Promise<string> {
				expect(this?.functions_generator?.ok).toBe(true);
				return `rendered:${content}`;
			},
		};

		(app as any).plugins.plugins["templater-obsidian"] = { templater };

		const result = await templaterParseTemplate(app as any, "hello", file as any);
		expect(result).toBe("rendered:hello");
	});
});

describe("legacy Templater wrappers", () => {
	it("delegate through the registered integration adapter", async () => {
		const app = new App();
		const file = new TFile();
		file.path = "QA.md";
		file.extension = "md";

		const rawPlugin = { ok: true };
		const plugin = { settings: { trigger_on_file_creation: true } };
		const fakeIntegration: TemplaterIntegration = {
			id: "templater-obsidian" as const,
			getRawPlugin: vi.fn(() => rawPlugin),
			getPlugin: vi.fn(() => plugin),
			getCapabilityReport: vi.fn(() => ({
				pluginId: "templater-obsidian" as const,
				installed: true,
				capabilities: {
					triggerOnFileCreation: true,
					pendingTemplates: false,
					overwriteFileCommands: true,
					parseTemplate: true,
					createRunningConfig: false,
					cursorAutoJump: false,
					cursorJump: true,
					teardown: false,
				},
				missingCapabilities: [],
			})),
			hasCapability: vi.fn(() => true),
			isTriggerOnCreateEnabled: vi.fn(() => true),
			waitForTriggerOnCreateToComplete: vi.fn(async () => undefined),
			withFileCreationSuppressed: vi.fn(async (_path, fn) => await fn()),
			overwriteFileOnce: vi.fn(async () => undefined),
			parseTemplate: vi.fn(async (content) => `wrapped:${content}`),
			jumpToNextCursorIfPossible: vi.fn(async () => undefined),
		};
		registerIntegrationRegistry(
			app as any,
			new IntegrationRegistry({ templater: fakeIntegration }),
		);

		expect(getTemplater(app as any)).toBe(rawPlugin);
		expect(getTemplaterPlugin(app as any)).toBe(plugin);
		expect(isTemplaterTriggerOnCreateEnabled(app as any)).toBe(true);
		expect(await templaterParseTemplate(app as any, "hello", file as any)).toBe(
			"wrapped:hello",
		);
		expect(
			await withTemplaterFileCreationSuppressed(
				app as any,
				"QA.md",
				async () => "suppressed",
			),
		).toBe("suppressed");
		await overwriteTemplaterOnce(app as any, file as any, {
			skipIfNoTags: false,
		});
		await waitForTemplaterTriggerOnCreateToComplete(app as any, file as any);
		await jumpToNextTemplaterCursorIfPossible(app as any, file as any);

		expect(fakeIntegration.parseTemplate).toHaveBeenCalledWith("hello", file);
		expect(fakeIntegration.withFileCreationSuppressed).toHaveBeenCalled();
		expect(fakeIntegration.overwriteFileOnce).toHaveBeenCalledWith(file, {
			skipIfNoTags: false,
		});
		expect(
			fakeIntegration.waitForTriggerOnCreateToComplete,
		).toHaveBeenCalledWith(file, {});
		expect(fakeIntegration.jumpToNextCursorIfPossible).toHaveBeenCalledWith(file);
	});
});

describe("jumpToNextTemplaterCursorIfPossible", () => {
	it("calls jump_to_next_cursor_location with the correct `this` context", async () => {
		const app = new App();
		const file = new TFile();
		file.path = "QA.md";
		file.extension = "md";

		(app as any).workspace.getActiveFile = () => file;

		const editorHandler = {
			plugin: { ok: true },
			jump_to_next_cursor_location: async function (
				this: any,
				_targetFile: unknown,
				_autoJump: unknown,
			): Promise<void> {
				expect(this?.plugin?.ok).toBe(true);
			},
		};

		(app as any).plugins.plugins["templater-obsidian"] = {
			settings: { auto_jump_to_cursor: true },
			editor_handler: editorHandler,
		};

		await jumpToNextTemplaterCursorIfPossible(app as any, file as any);
	});
});

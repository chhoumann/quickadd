import { describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { FormatOrchestrator } from "./FormatOrchestrator";
import { createChoiceExecutionContext } from "./context";
import { IntegrationRegistry } from "../../integrations/IntegrationRegistry";
import type { TemplaterIntegration } from "../../integrations/TemplaterIntegration";

function createFile(path = "Notes/Test.md", extension = "md"): TFile {
	return {
		path,
		extension,
	} as TFile;
}

function createTemplater(
	capabilities: Partial<Record<string, boolean>> = {},
): TemplaterIntegration {
	return {
		id: "templater-obsidian",
		getRawPlugin: vi.fn(() => null),
		getPlugin: vi.fn(() => null),
		getCapabilityReport: vi.fn(() => ({
			pluginId: "templater-obsidian",
			installed: true,
			capabilities: {} as any,
			missingCapabilities: [],
		})),
		hasCapability: vi.fn(
			(capability: string) => capabilities[capability] === true,
		),
		isTriggerOnCreateEnabled: vi.fn(() => false),
		waitForTriggerOnCreateToComplete: vi.fn(),
		withFileCreationSuppressed: vi.fn(async (_filePath, fn) => await fn()),
		overwriteFileOnce: vi.fn(),
		parseTemplate: vi.fn(async (content: string) => content),
		jumpToNextCursorIfPossible: vi.fn(),
	} as unknown as TemplaterIntegration;
}

function createOrchestrator(templater: TemplaterIntegration) {
	const context = createChoiceExecutionContext({
		integrations: new IntegrationRegistry({ templater }),
	});
	return {
		context,
		orchestrator: new FormatOrchestrator({} as App, context),
	};
}

describe("FormatOrchestrator Templater diagnostics", () => {
	it("does not diagnose missing parseTemplate for plain content", async () => {
		const templater = createTemplater({ parseTemplate: false });
		const { context, orchestrator } = createOrchestrator(templater);

		await orchestrator.parseTemplaterTemplate("Plain content", createFile());

		expect(context.diagnostics).toHaveLength(0);
		expect(templater.parseTemplate).toHaveBeenCalledWith(
			"Plain content",
			expect.objectContaining({ path: "Notes/Test.md" }),
		);
	});

	it("diagnoses missing parseTemplate when markdown content has Templater tags", async () => {
		const templater = createTemplater({ parseTemplate: false });
		const { context, orchestrator } = createOrchestrator(templater);

		await orchestrator.parseTemplaterTemplate("<% tp.date.now() %>", createFile());

		expect(context.diagnostics).toEqual([
			expect.objectContaining({
				code: "templater-capability-missing",
				details: expect.objectContaining({ capability: "parseTemplate" }),
			}),
		]);
	});

	it("does not diagnose missing overwriteFileCommands when caller disables diagnostics", async () => {
		const templater = createTemplater({ overwriteFileCommands: false });
		const { context, orchestrator } = createOrchestrator(templater);

		await orchestrator.overwriteTemplaterOnce(createFile(), {
			diagnoseMissingCapability: false,
		});

		expect(context.diagnostics).toHaveLength(0);
		expect(templater.overwriteFileOnce).toHaveBeenCalledWith(
			expect.objectContaining({ path: "Notes/Test.md" }),
			{},
		);
	});

	it("does not diagnose missing triggerOnFileCreation for best-effort waits", async () => {
		const templater = createTemplater({ triggerOnFileCreation: false });
		const { context, orchestrator } = createOrchestrator(templater);

		await orchestrator.waitForTemplaterTriggerOnCreateToComplete(createFile());

		expect(context.diagnostics).toHaveLength(0);
		expect(templater.waitForTriggerOnCreateToComplete).toHaveBeenCalledWith(
			expect.objectContaining({ path: "Notes/Test.md" }),
		);
	});

	it("does not diagnose missing cursorJump for best-effort cursor jumps", async () => {
		const templater = createTemplater({ cursorJump: false });
		const { context, orchestrator } = createOrchestrator(templater);

		await orchestrator.jumpToNextTemplaterCursorIfPossible(createFile());

		expect(context.diagnostics).toHaveLength(0);
		expect(templater.jumpToNextCursorIfPossible).toHaveBeenCalledWith(
			expect.objectContaining({ path: "Notes/Test.md" }),
		);
	});

	it("diagnoses missing overwriteFileCommands by default for markdown files", async () => {
		const templater = createTemplater({ overwriteFileCommands: false });
		const { context, orchestrator } = createOrchestrator(templater);

		await orchestrator.overwriteTemplaterOnce(createFile());

		expect(context.diagnostics).toEqual([
			expect.objectContaining({
				code: "templater-capability-missing",
				details: expect.objectContaining({
					capability: "overwriteFileCommands",
				}),
			}),
		]);
	});
});

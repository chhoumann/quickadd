import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliData, CliFlags } from "obsidian";
import { TFile } from "obsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type QuickAdd from "../main";
import { registerQuickAddCliHandlers } from "./registerQuickAddCliHandlers";
import type IChoice from "../types/choices/IChoice";

const {
	ChoiceExecutorMock,
	collectChoiceRequirementsMock,
	getUnresolvedRequirementsMock,
} = vi.hoisted(() => ({
	ChoiceExecutorMock: vi.fn(),
	collectChoiceRequirementsMock: vi.fn(),
	getUnresolvedRequirementsMock: vi.fn(),
}));

vi.mock("../choiceExecutor", () => ({
	ChoiceExecutor: ChoiceExecutorMock,
}));

vi.mock("../preflight/collectChoiceRequirements", () => ({
	collectChoiceRequirements: collectChoiceRequirementsMock,
	getUnresolvedRequirements: getUnresolvedRequirementsMock,
}));

interface RegisteredCliHandler {
	command: string;
	description: string;
	flags: CliFlags | null;
	handler: (params: CliData) => string | Promise<string>;
}

function createPlugin(choices: IChoice[]) {
	const handlers: RegisteredCliHandler[] = [];
	const byName = new Map<string, IChoice>();
	for (const choice of choices) byName.set(choice.name, choice);

	const plugin = {
		app: {},
		settings: { choices },
		getChoiceByName: vi.fn((name: string) => {
			const choice = byName.get(name);
			if (!choice) throw new Error(`Choice ${name} not found`);
			return choice;
		}),
		getChoiceById: vi.fn(),
		registerCliHandler: vi.fn(
			(
				command: string,
				description: string,
				flags: CliFlags | null,
				handler: (params: CliData) => string | Promise<string>,
			) => {
				handlers.push({ command, description, flags, handler });
			},
		),
	} as unknown as QuickAdd & {
		registerCliHandler: (
			command: string,
			description: string,
			flags: CliFlags | null,
			handler: (params: CliData) => string | Promise<string>,
		) => void;
	};

	return { plugin, handlers };
}

describe("registerQuickAddCliHandlers (cli-uri audit: cli-run-choice honesty)", () => {
	let executors: IChoiceExecutor[];

	const templateChoice: IChoice = {
		id: "template-id",
		name: "Template Choice",
		type: "Template",
		command: true,
	} as IChoice;

	beforeEach(() => {
		executors = [];
		ChoiceExecutorMock.mockReset();
		collectChoiceRequirementsMock.mockReset();
		getUnresolvedRequirementsMock.mockReset();

		ChoiceExecutorMock.mockImplementation(function ChoiceExecutorMock() {
			const executor: IChoiceExecutor = {
				execute: vi.fn().mockResolvedValue(undefined),
				executeWithOutcome: vi.fn().mockResolvedValue({
					status: "success",
					file: { path: "Created Note.md" },
				}),
				variables: new Map<string, unknown>(),
				consumeAbortSignal: vi.fn().mockReturnValue(null),
			};
			executors.push(executor);
			return executor;
		});

		collectChoiceRequirementsMock.mockResolvedValue([]);
		getUnresolvedRequirementsMock.mockReturnValue([]);
	});

	function getRunHandler(handlers: RegisteredCliHandler[]) {
		const run = handlers.find((handler) => handler.command === "quickadd:run");
		expect(run).toBeDefined();
		return run!;
	}

	// The legacy void-execute() path can resolve even when the Template/Capture
	// engine swallowed a runtime failure (no file created). The success envelope
	// must mark itself unverified so a script keying off `ok` is not misled.
	it("flags the legacy quickadd:run success envelope as verified:false", async () => {
		const { plugin, handlers } = createPlugin([templateChoice]);
		registerQuickAddCliHandlers(plugin);
		const run = getRunHandler(handlers);

		const payload = JSON.parse(
			String(await run.handler({ choice: templateChoice.name })),
		);

		expect(payload.ok).toBe(true);
		// Would be undefined before the fix; the field must distinguish the
		// unverified legacy success from a confirmed-create.
		expect(payload.verified).toBe(false);
		// Still the legacy void path (not routed through executeWithOutcome).
		expect(executors[0].execute).toHaveBeenCalledWith(templateChoice);
	});

	// run-template uses the honest outcome path, so its success is verified.
	it("flags the verified run-template success envelope as verified:true", async () => {
		const { plugin, handlers } = createPlugin([]);
		(plugin as unknown as { app: unknown }).app = {
			vault: {
				getAbstractFileByPath: vi.fn((path: string) => {
					if (path !== "Templates/Daily.md") return null;
					const file = new TFile();
					file.path = path;
					return file;
				}),
			},
		};
		registerQuickAddCliHandlers(plugin);
		const runTemplate = handlers.find(
			(handler) => handler.command === "quickadd:run-template",
		);
		expect(runTemplate).toBeDefined();

		const payload = JSON.parse(
			String(
				await runTemplate!.handler({
					path: "Templates/Daily.md",
					"value-value": "Note",
				}),
			),
		);

		expect(payload.ok).toBe(true);
		expect(payload.verified).toBe(true);
		expect(executors[0].executeWithOutcome).toHaveBeenCalledTimes(1);
	});

	// The caveat must be discoverable from the command description itself.
	it("documents the ok:true caveat in the quickadd:run command descriptions", () => {
		const { plugin, handlers } = createPlugin([templateChoice]);
		registerQuickAddCliHandlers(plugin);

		for (const command of ["quickadd", "quickadd:run"]) {
			const handler = handlers.find((h) => h.command === command);
			expect(handler).toBeDefined();
			expect(handler!.description).toMatch(/verified/i);
		}
	});
});

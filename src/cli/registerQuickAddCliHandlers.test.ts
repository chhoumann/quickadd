import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliData, CliFlags } from "obsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type QuickAdd from "../main";
import { registerQuickAddCliHandlers } from "./registerQuickAddCliHandlers";
import type IChoice from "../types/choices/IChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";

const {
	ChoiceExecutorMock,
	collectChoiceFlowPreflightMock,
} = vi.hoisted(() => ({
	ChoiceExecutorMock: vi.fn(),
	collectChoiceFlowPreflightMock: vi.fn(),
}));

vi.mock("../choiceExecutor", () => ({
	ChoiceExecutor: ChoiceExecutorMock,
}));

vi.mock("../preflight/collectChoiceFlowPreflight", () => ({
	collectChoiceFlowPreflight: collectChoiceFlowPreflightMock,
}));

interface RegisteredCliHandler {
	command: string;
	description: string;
	flags: CliFlags | null;
	handler: (params: CliData) => string | Promise<string>;
}

function flattenChoices(
	choices: IChoice[],
): { byName: Map<string, IChoice>; byId: Map<string, IChoice>; } {
	const byName = new Map<string, IChoice>();
	const byId = new Map<string, IChoice>();

	const walk = (list: IChoice[]) => {
		for (const choice of list) {
			byName.set(choice.name, choice);
			byId.set(choice.id, choice);
			if (choice.type === "Multi") {
				walk((choice as IMultiChoice).choices);
			}
		}
	};

	walk(choices);
	return { byName, byId };
}

function createPlugin(choices: IChoice[]) {
	const handlers: RegisteredCliHandler[] = [];
	const { byName, byId } = flattenChoices(choices);

	const plugin = {
		app: {},
		settings: {
			choices,
		},
		getChoiceByName: vi.fn((name: string) => {
			const choice = byName.get(name);
			if (!choice) throw new Error(`Choice ${name} not found`);
			return choice;
		}),
		getChoiceById: vi.fn((id: string) => {
			const choice = byId.get(id);
			if (!choice) throw new Error(`Choice ${id} not found`);
			return choice;
		}),
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

describe("registerQuickAddCliHandlers", () => {
	let executors: IChoiceExecutor[];

	const templateChoice: IChoice = {
		id: "template-id",
		name: "Template Choice",
		type: "Template",
		command: true,
	};

	const nestedCaptureChoice: IChoice = {
		id: "capture-id",
		name: "Capture Choice",
		type: "Capture",
		command: false,
	};

	const macroChoice: IChoice = {
		id: "macro-id",
		name: "Macro Choice",
		type: "Macro",
		command: true,
	};

	const multiChoice: IMultiChoice = {
		id: "multi-id",
		name: "Group",
		type: "Multi",
		command: false,
		collapsed: false,
		choices: [nestedCaptureChoice],
		placeholder: "Select",
	};

	beforeEach(() => {
		executors = [];
		ChoiceExecutorMock.mockReset();
		collectChoiceFlowPreflightMock.mockReset();

		ChoiceExecutorMock.mockImplementation(() => {
			const executor: IChoiceExecutor = {
				execute: vi.fn().mockResolvedValue({
					status: "success",
					artifacts: [],
					diagnostics: [],
				}),
				variables: new Map<string, unknown>(),
				consumeAbortSignal: vi.fn().mockReturnValue(null),
			};
			executors.push(executor);
			return executor;
		});

		collectChoiceFlowPreflightMock.mockResolvedValue({
			requirements: [],
			unresolvedRequirements: [],
			diagnostics: [],
			choices: [],
		});
	});

	it("registers run/list/check handlers when CLI API is available", () => {
		const { plugin, handlers } = createPlugin([
			templateChoice,
			macroChoice,
			multiChoice,
		]);

		const result = registerQuickAddCliHandlers(plugin);

		expect(result).toBe(true);
		expect(handlers.map((handler) => handler.command)).toEqual([
			"quickadd",
			"quickadd:run",
			"quickadd:list",
			"quickadd:check",
		]);
	});

	it("returns false when CLI API is unavailable", () => {
		const plugin = {
			app: {},
			settings: { choices: [] },
		} as unknown as QuickAdd;

		expect(registerQuickAddCliHandlers(plugin)).toBe(false);
	});

	it("executes a choice via quickadd:run with parsed variables", async () => {
		const { plugin, handlers } = createPlugin([
			templateChoice,
			macroChoice,
			multiChoice,
		]);
		registerQuickAddCliHandlers(plugin);
		const run = handlers.find((handler) => handler.command === "quickadd:run");
		expect(run).toBeDefined();

		const output = await Promise.resolve(
			run!.handler({
				choice: templateChoice.name,
				"value-project": "QA",
				team: "Core",
			}),
		);
		const payload = JSON.parse(String(output));

		expect(payload.ok).toBe(true);
		expect(executors).toHaveLength(1);
		expect(executors[0].execute).toHaveBeenCalledWith(templateChoice);
		expect(executors[0].variables.get("project")).toBe("QA");
		expect(executors[0].variables.get("team")).toBe("Core");
	});

	it("returns missing inputs for non-interactive runs", async () => {
		const { plugin, handlers } = createPlugin([
			templateChoice,
			macroChoice,
			multiChoice,
		]);
		registerQuickAddCliHandlers(plugin);
		const run = handlers.find((handler) => handler.command === "quickadd:run");
		expect(run).toBeDefined();

		const missingRequirement = {
			id: "title",
			label: "Title",
			type: "text",
		};
		collectChoiceFlowPreflightMock.mockResolvedValue({
			requirements: [missingRequirement],
			unresolvedRequirements: [missingRequirement],
			diagnostics: [],
			choices: [
				{
					id: macroChoice.id,
					name: macroChoice.name,
					type: macroChoice.type,
					path: macroChoice.name,
					depth: 0,
				},
				{
					id: nestedCaptureChoice.id,
					name: nestedCaptureChoice.name,
					type: nestedCaptureChoice.type,
					path: `${macroChoice.name} / ${nestedCaptureChoice.name}`,
					depth: 1,
				},
			],
		});

		const output = await Promise.resolve(
			run!.handler({
				choice: macroChoice.name,
			}),
		);
		const payload = JSON.parse(String(output));

		expect(payload.ok).toBe(false);
		expect(payload.requiredInputCount).toBe(1);
		expect(payload.missingInputCount).toBe(1);
		expect(payload.missingFlags).toContain("value-title=<value>");
		expect(payload.flow.choiceCount).toBe(2);
		expect(payload.flow.choices[1]).toMatchObject({
			id: nestedCaptureChoice.id,
			depth: 1,
		});
		expect(collectChoiceFlowPreflightMock).toHaveBeenCalledWith(
			plugin.app,
			plugin,
			executors[0],
			macroChoice,
		);
		expect(executors[0].execute).not.toHaveBeenCalled();
	});

	it("returns aborted when executor result status is aborted", async () => {
		const executor: IChoiceExecutor = {
			execute: vi.fn().mockResolvedValue({
				status: "aborted",
				error: new Error("Stopped by child"),
				artifacts: [],
				diagnostics: [],
			}),
			variables: new Map<string, unknown>(),
			consumeAbortSignal: vi.fn().mockReturnValue(null),
		};
		ChoiceExecutorMock.mockReturnValueOnce(executor);
		const { plugin, handlers } = createPlugin([
			templateChoice,
			macroChoice,
			multiChoice,
		]);
		registerQuickAddCliHandlers(plugin);
		const run = handlers.find((handler) => handler.command === "quickadd:run");
		expect(run).toBeDefined();

		const output = await Promise.resolve(
			run!.handler({ choice: templateChoice.name }),
		);
		const payload = JSON.parse(String(output));

		expect(payload.ok).toBe(false);
		expect(payload.aborted).toBe(true);
		expect(payload.error).toBe("Stopped by child");
	});

	it("returns failed when executor result status is failed", async () => {
		const executor: IChoiceExecutor = {
			execute: vi.fn().mockResolvedValue({
				status: "failed",
				error: new Error("Boom"),
				artifacts: [],
				diagnostics: [],
			}),
			variables: new Map<string, unknown>(),
			consumeAbortSignal: vi.fn().mockReturnValue(null),
		};
		ChoiceExecutorMock.mockReturnValueOnce(executor);
		const { plugin, handlers } = createPlugin([
			templateChoice,
			macroChoice,
			multiChoice,
		]);
		registerQuickAddCliHandlers(plugin);
		const run = handlers.find((handler) => handler.command === "quickadd:run");
		expect(run).toBeDefined();

		const output = await Promise.resolve(
			run!.handler({ choice: templateChoice.name }),
		);
		const payload = JSON.parse(String(output));

		expect(payload.ok).toBe(false);
		expect(payload.aborted).toBeUndefined();
		expect(payload.error).toBe("Boom");
	});

	it("lists flattened choices and supports command filter", async () => {
		const { plugin, handlers } = createPlugin([
			templateChoice,
			macroChoice,
			multiChoice,
		]);
		registerQuickAddCliHandlers(plugin);
		const list = handlers.find((handler) => handler.command === "quickadd:list");
		expect(list).toBeDefined();

		const output = await Promise.resolve(
			list!.handler({
				commands: "true",
			}),
		);
		const payload = JSON.parse(String(output));

		expect(payload.ok).toBe(true);
		expect(payload.count).toBe(2);
		expect(payload.choices.map((choice: { id: string; }) => choice.id)).toEqual([
			templateChoice.id,
			macroChoice.id,
		]);
	});

	it("checks unresolved requirements without executing the choice", async () => {
		const { plugin, handlers } = createPlugin([
			templateChoice,
			macroChoice,
			multiChoice,
		]);
		registerQuickAddCliHandlers(plugin);
		const check = handlers.find((handler) => handler.command === "quickadd:check");
		expect(check).toBeDefined();

		const requirement = {
			id: "project",
			label: "Project",
			type: "text",
		};
		collectChoiceFlowPreflightMock.mockResolvedValue({
			requirements: [requirement],
			unresolvedRequirements: [requirement],
			diagnostics: [
				{
					severity: "error",
					code: "missing-required-inputs",
					message: "1 required input(s) are missing for this flow.",
					source: "runtime",
					details: { missingIds: ["project"] },
				},
			],
			choices: [
				{
					id: templateChoice.id,
					name: templateChoice.name,
					type: templateChoice.type,
					path: templateChoice.name,
					depth: 0,
				},
			],
		});

		const output = await Promise.resolve(
			check!.handler({
				choice: templateChoice.name,
			}),
		);
		const payload = JSON.parse(String(output));

		expect(payload.ok).toBe(false);
		expect(payload.requiredInputCount).toBe(1);
		expect(payload.missingInputCount).toBe(1);
		expect(payload.diagnosticCount).toBe(1);
		expect(payload.diagnostics[0]).toMatchObject({
			severity: "error",
			code: "missing-required-inputs",
		});
		expect(payload.flow.choiceCount).toBe(1);
		expect(executors[0].execute).not.toHaveBeenCalled();
	});
});

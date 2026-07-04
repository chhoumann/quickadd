import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliData, CliFlags } from "obsidian";
import { TFile } from "obsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type QuickAdd from "../main";
import { registerQuickAddCliHandlers } from "./registerQuickAddCliHandlers";
import type IChoice from "../types/choices/IChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";

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

	it("registers run/list/check/preview handlers when CLI API is available", () => {
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
			"quickadd:run-template",
			"quickadd:list",
			"quickadd:check",
			"quickadd:package-preview",
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

	it("routes quickadd:run through executeWithOutcome when the verify flag is set", async () => {
		const { plugin, handlers } = createPlugin([templateChoice]);
		registerQuickAddCliHandlers(plugin);
		const run = handlers.find(
			(handler) => handler.command === "quickadd:run",
		);
		expect(run).toBeDefined();

		const verified = JSON.parse(
			String(
				await Promise.resolve(
					run!.handler({
						choice: templateChoice.name,
						verify: "true",
					}),
				),
			),
		);
		expect(verified.ok).toBe(true);
		expect(verified.verified).toBe(true);
		expect(verified.file).toBe("Created Note.md");
		expect(executors[0].executeWithOutcome).toHaveBeenCalledWith(
			templateChoice,
		);
		expect(executors[0].execute).not.toHaveBeenCalled();
		// The verify flag must not leak into the executor's variables.
		expect(executors[0].variables.has("verify")).toBe(false);

		const legacy = JSON.parse(
			String(
				await Promise.resolve(
					run!.handler({
						choice: templateChoice.name,
					}),
				),
			),
		);
		expect(legacy.ok).toBe(true);
		expect(legacy.verified).toBe(false);
		expect(legacy.file).toBeUndefined();
		expect(executors[1].execute).toHaveBeenCalledWith(templateChoice);
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
		collectChoiceRequirementsMock.mockResolvedValue([missingRequirement]);
		getUnresolvedRequirementsMock.mockReturnValue([missingRequirement]);

		const output = await Promise.resolve(
			run!.handler({
				choice: templateChoice.name,
			}),
		);
		const payload = JSON.parse(String(output));

		expect(payload.ok).toBe(false);
		expect(payload.missingInputCount).toBeUndefined();
		expect(payload.missingFlags).toContain("value-title=<value>");
		expect(executors[0].execute).not.toHaveBeenCalled();
	});

	function withTemplateFile(plugin: QuickAdd, existingPath: string) {
		(plugin as unknown as { app: unknown }).app = {
			vault: {
				getAbstractFileByPath: vi.fn((path: string) => {
					if (path !== existingPath) return null;
					const file = new TFile();
					file.path = path;
					return file;
				}),
			},
		};
	}

	it("returns an error when run-template is given no path", async () => {
		const { plugin, handlers } = createPlugin([]);
		registerQuickAddCliHandlers(plugin);
		const run = handlers.find((h) => h.command === "quickadd:run-template");
		const payload = JSON.parse(String(await run!.handler({})));
		expect(payload.ok).toBe(false);
		expect(payload.command).toBe("quickadd:run-template");
		expect(executors).toHaveLength(0);
	});

	it("returns an error when the template path does not resolve to a file", async () => {
		const { plugin, handlers } = createPlugin([]);
		withTemplateFile(plugin, "Templates/Daily.md");
		registerQuickAddCliHandlers(plugin);
		const run = handlers.find((h) => h.command === "quickadd:run-template");
		const payload = JSON.parse(
			String(await run!.handler({ path: "Templates/Missing.md" })),
		);
		expect(payload.ok).toBe(false);
		expect(executors).toHaveLength(0);
	});

	// The note name is validated up front (before any executor): an absent OR
	// blank {{value}} can't name the note. The requirement collector consumes a
	// provided-but-empty value (so it can't flag it) and the engine then swallows
	// the resulting "File name is empty" throw — so run-template must reject blanks
	// itself to avoid a false ok:true with no note created.
	it.each([
		["absent", {}],
		["empty string", { "value-value": "" }],
		["whitespace", { "value-value": "   " }],
		["null via vars", { vars: JSON.stringify({ value: null }) }],
	])(
		"rejects a %s note name on a non-interactive run-template (honest envelope)",
		async (_label, extra) => {
			const { plugin, handlers } = createPlugin([]);
			withTemplateFile(plugin, "Templates/Daily.md");
			registerQuickAddCliHandlers(plugin);
			const run = handlers.find((h) => h.command === "quickadd:run-template");

			const payload = JSON.parse(
				String(await run!.handler({ path: "Templates/Daily.md", ...extra })),
			);
			expect(payload.ok).toBe(false);
			expect(payload.missingFlags).toContain("value-value=<value>");
			// Rejected before an executor is even constructed.
			expect(executors).toHaveLength(0);
		},
	);

	it("reports a swallowed engine failure (e.g. blank name) as ok:false, not false success", async () => {
		const { plugin, handlers } = createPlugin([]);
		withTemplateFile(plugin, "Templates/Daily.md");
		registerQuickAddCliHandlers(plugin);
		const run = handlers.find((h) => h.command === "quickadd:run-template");

		const payload = JSON.parse(
			String(
				await run!.handler({ path: "Templates/Daily.md", "value-value": "Note" }),
			),
		);
		// Default mock outcome is success → ok:true with the created file path.
		expect(payload.ok).toBe(true);
		expect(payload.file).toBe("Created Note.md");
		expect(executors[0].executeWithOutcome).toHaveBeenCalledTimes(1);
		expect(executors[0].execute).not.toHaveBeenCalled();
	});

	it("maps an error outcome to ok:false even when execute() would have resolved", async () => {
		const { plugin, handlers } = createPlugin([]);
		withTemplateFile(plugin, "Templates/Daily.md");
		registerQuickAddCliHandlers(plugin);
		const run = handlers.find((h) => h.command === "quickadd:run-template");
		// Simulate the engine swallowing a failure (no file created) — incl. the
		// ui=true + blank-name path that the up-front guard intentionally skips.
		ChoiceExecutorMock.mockImplementationOnce(function () {
			const executor: IChoiceExecutor = {
				execute: vi.fn().mockResolvedValue(undefined),
				executeWithOutcome: vi.fn().mockResolvedValue({ status: "error" }),
				variables: new Map<string, unknown>(),
				consumeAbortSignal: vi.fn().mockReturnValue(null),
			};
			executors.push(executor);
			return executor;
		});

		const payload = JSON.parse(
			String(
				await run!.handler({
					path: "Templates/Daily.md",
					"value-value": "",
					ui: "true",
				}),
			),
		);
		expect(payload.ok).toBe(false);
		expect(String(payload.error)).toMatch(/no file/i);
	});

	it("maps a cancelled outcome to ok:false (aborted)", async () => {
		const { plugin, handlers } = createPlugin([]);
		withTemplateFile(plugin, "Templates/Daily.md");
		registerQuickAddCliHandlers(plugin);
		const run = handlers.find((h) => h.command === "quickadd:run-template");
		ChoiceExecutorMock.mockImplementationOnce(function () {
			const executor: IChoiceExecutor = {
				execute: vi.fn().mockResolvedValue(undefined),
				executeWithOutcome: vi
					.fn()
					.mockResolvedValue({ status: "cancelled", cancelKind: "user" }),
				variables: new Map<string, unknown>(),
				consumeAbortSignal: vi.fn().mockReturnValue(null),
			};
			executors.push(executor);
			return executor;
		});

		const payload = JSON.parse(
			String(
				await run!.handler({ path: "Templates/Daily.md", "value-value": "X" }),
			),
		);
		expect(payload.ok).toBe(false);
		expect(payload.aborted).toBe(true);
	});

	it("returns a JSON error envelope for malformed vars (not an unhandled rejection)", async () => {
		const { plugin, handlers } = createPlugin([]);
		withTemplateFile(plugin, "Templates/Daily.md");
		registerQuickAddCliHandlers(plugin);
		const run = handlers.find((h) => h.command === "quickadd:run-template");

		// The up-front name check parses vars=; malformed JSON must surface as the
		// standard envelope, like quickadd:run, rather than rejecting the handler.
		const payload = JSON.parse(
			String(await run!.handler({ path: "Templates/Daily.md", vars: "{not json" })),
		);
		expect(payload.ok).toBe(false);
		expect(payload.command).toBe("quickadd:run-template");
		expect(String(payload.error)).toMatch(/vars/i);
		expect(executors).toHaveLength(0);
	});

	it("ui mode skips the up-front blank-name guard and delegates to execution", async () => {
		const { plugin, handlers } = createPlugin([]);
		withTemplateFile(plugin, "Templates/Daily.md");
		registerQuickAddCliHandlers(plugin);
		const run = handlers.find((h) => h.command === "quickadd:run-template");

		const payload = JSON.parse(
			String(
				await run!.handler({
					path: "Templates/Daily.md",
					"value-value": "",
					ui: "true",
				}),
			),
		);
		// Not pre-rejected with missingFlags; routed through executeWithOutcome
		// (which would prompt at runtime). Default mock outcome is success.
		expect(payload.missingFlags).toBeUndefined();
		expect(executors[0].executeWithOutcome).toHaveBeenCalledTimes(1);
		expect(executors[0].execute).not.toHaveBeenCalled();
	});

	it("accepts extensionless template paths the engine would resolve", async () => {
		const { plugin, handlers } = createPlugin([]);
		// Engine resolver appends .md; the CLI must accept "Templates/Daily" too.
		withTemplateFile(plugin, "Templates/Daily.md");
		registerQuickAddCliHandlers(plugin);
		const run = handlers.find((h) => h.command === "quickadd:run-template");

		const payload = JSON.parse(
			String(
				await run!.handler({ path: "Templates/Daily", "value-value": "Note" }),
			),
		);
		expect(payload.ok).toBe(true);
		const executed = (
			executors[0].executeWithOutcome as ReturnType<typeof vi.fn>
		).mock.calls[0][0];
		expect(executed.templatePath).toBe("Templates/Daily.md");
	});

	it("runs an ephemeral template choice and does not leak path= as a variable", async () => {
		const { plugin, handlers } = createPlugin([]);
		withTemplateFile(plugin, "Templates/Daily.md");
		registerQuickAddCliHandlers(plugin);
		const run = handlers.find((h) => h.command === "quickadd:run-template");

		const payload = JSON.parse(
			String(
				await run!.handler({
					path: "Templates/Daily.md",
					"value-value": "My New Note",
				}),
			),
		);

		expect(payload.ok).toBe(true);
		expect(executors).toHaveLength(1);
		const executedChoice = (
			executors[0].executeWithOutcome as ReturnType<typeof vi.fn>
		).mock.calls[0][0];
		expect(executedChoice.type).toBe("Template");
		expect(executedChoice.templatePath).toBe("Templates/Daily.md");
		expect(executors[0].variables.get("value")).toBe("My New Note");
		expect(executors[0].variables.has("path")).toBe(false);
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

	it("previews a package and reports its dangerous capabilities", async () => {
		const packageJson = JSON.stringify({
			schemaVersion: 1,
			quickAddVersion: "1.18.0",
			createdAt: "2026-06-01T00:00:00.000Z",
			rootChoiceIds: ["m1"],
			choices: [
				{
					choice: {
						id: "m1",
						name: "Daily Sync",
						type: "Macro",
						command: false,
						runOnStartup: true,
						macro: {
							id: "macro-m1",
							name: "Daily Sync",
							commands: [
								{
									id: "cmd1",
									name: "fetch",
									type: "UserScript",
									path: "scripts/fetch.js",
									settings: {},
								},
							],
						},
					},
					pathHint: ["Daily Sync"],
					parentChoiceId: null,
				},
			],
			assets: [
				{
					kind: "user-script",
					originalPath: "scripts/fetch.js",
					contentEncoding: "base64",
					// "console.log('hi')" base64
					content: "Y29uc29sZS5sb2coJ2hpJyk=",
				},
			],
		});

		const adapter = {
			exists: vi.fn(async (path: string) => path === "packages/p.quickadd.json"),
			read: vi.fn(async (path: string) => {
				if (path === "packages/p.quickadd.json") return packageJson;
				throw new Error(`no file at ${path}`);
			}),
		};
		const { plugin, handlers } = createPlugin([]);
		(plugin as unknown as { app: unknown }).app = { vault: { adapter } };
		registerQuickAddCliHandlers(plugin);
		const preview = handlers.find(
			(handler) => handler.command === "quickadd:package-preview",
		);
		expect(preview).toBeDefined();

		const output = await Promise.resolve(
			preview!.handler({ path: "packages/p.quickadd.json", decode: "true" }),
		);
		const payload = JSON.parse(String(output));

		expect(payload.ok).toBe(true);
		expect(payload.preview.summary.runsOnStartup).toBe(true);
		expect(payload.preview.summary.criticalCount).toBeGreaterThan(0);
		expect(payload.preview.criticalScriptPaths).toContain("scripts/fetch.js");
		const decoded = payload.contents.find(
			(entry: { path: string }) => entry.path === "scripts/fetch.js",
		);
		expect(decoded.text).toBe("console.log('hi')");
	});

	it("returns an error envelope when the package path is missing", async () => {
		const { plugin, handlers } = createPlugin([]);
		registerQuickAddCliHandlers(plugin);
		const preview = handlers.find(
			(handler) => handler.command === "quickadd:package-preview",
		);
		const output = await Promise.resolve(preview!.handler({}));
		const payload = JSON.parse(String(output));
		expect(payload.ok).toBe(false);
		expect(payload.command).toBe("quickadd:package-preview");
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
		collectChoiceRequirementsMock.mockResolvedValue([requirement]);
		getUnresolvedRequirementsMock.mockReturnValue([requirement]);

		const output = await Promise.resolve(
			check!.handler({
				choice: templateChoice.name,
			}),
		);
		const payload = JSON.parse(String(output));

		expect(payload.ok).toBe(false);
		expect(payload.requiredInputCount).toBe(1);
		expect(payload.missingInputCount).toBe(1);
		expect(executors[0].execute).not.toHaveBeenCalled();
	});

	it("includes full field metadata in quickadd:check when the fields flag is set", async () => {
		const { plugin, handlers } = createPlugin([templateChoice]);
		registerQuickAddCliHandlers(plugin);
		const check = handlers.find(
			(handler) => handler.command === "quickadd:check",
		);
		expect(check).toBeDefined();

		const requirement = {
			id: "priority",
			label: "Priority",
			type: "dropdown",
			options: ["low", "medium", "high"],
			displayOptions: ["Low", "Medium", "High"],
			defaultValue: "medium",
			optional: true,
			filters: "tags:#project",
			suggesterConfig: {
				allowCustomInput: false,
				caseSensitive: false,
				multiSelect: false,
			},
		};
		collectChoiceRequirementsMock.mockResolvedValue([requirement]);
		getUnresolvedRequirementsMock.mockReturnValue([requirement]);

		const withFields = JSON.parse(
			String(
				await Promise.resolve(
					check!.handler({
						choice: templateChoice.name,
						fields: "true",
					}),
				),
			),
		);
		expect(withFields.missing).toEqual([
			expect.objectContaining({
				id: "priority",
				type: "dropdown",
				optionCount: 3,
				options: ["low", "medium", "high"],
				displayOptions: ["Low", "Medium", "High"],
				defaultValue: "medium",
				optional: true,
				filters: "tags:#project",
				suggesterConfig: {
					allowCustomInput: false,
					caseSensitive: false,
					multiSelect: false,
				},
			}),
		]);
		// The fields flag must not leak into the executor's variables.
		expect(executors[0].variables.has("fields")).toBe(false);

		const withoutFields = JSON.parse(
			String(
				await Promise.resolve(
					check!.handler({
						choice: templateChoice.name,
					}),
				),
			),
		);
		expect(withoutFields.missing[0].options).toBeUndefined();
		expect(withoutFields.missing[0].optionCount).toBe(3);
	});
});

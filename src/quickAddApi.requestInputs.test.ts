import { createChoiceExecutor } from "../tests/helpers/createChoiceExecutor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type QuickAdd from "./main";
import { QuickAddApi } from "./quickAddApi";
import type { IChoiceExecutor } from "./IChoiceExecutor";
import type { FieldRequirement } from "./preflight/fieldRequirements";

vi.mock("./quickAddSettingsTab", () => ({
	DEFAULT_SETTINGS: {},
	QuickAddSettingsTab: class {},
}));

vi.mock("./formatters/completeFormatter", () => ({
	CompleteFormatter: class CompleteFormatterMock {},
}));

let modalReturnValue: Record<string, string> = {};
let modalRequirements: FieldRequirement[] = [];
let formAnswers: { picks?: Record<string, string[]>; chosen?: Record<string, string> } = {};

/** What the form stores for the entry shown as `label`: its option's wire value, or the typed text. */
function wireValue(requirements: FieldRequirement[], id: string, label: string): string {
	const requirement = requirements.find((req) => req.id === id);
	const index = (requirement?.displayOptions ?? requirement?.options ?? []).indexOf(label);
	return index >= 0 && requirement?.options ? requirement.options[index] : label;
}

vi.mock("./preflight/OnePageInputModal", () => {
	return {
		OnePageInputModal: class OnePageInputModalMock {
			public waitForClose: Promise<Record<string, string>>;
			public multiSelections = new Map<string, string[]>();

			constructor(_app: App, requirements: FieldRequirement[], _initial?: Map<string, unknown>) {
				modalRequirements = requirements;
				const values = { ...modalReturnValue };
				for (const [id, labels] of Object.entries(formAnswers.picks ?? {})) {
					const picks = labels.map((label) => wireValue(requirements, id, label));
					this.multiSelections.set(id, picks);
					values[id] = picks.join(requirements.find((req) => req.id === id)?.suggesterConfig?.separator ?? ", ");
				}
				for (const [id, label] of Object.entries(formAnswers.chosen ?? {})) {
					values[id] = wireValue(requirements, id, label);
				}
				this.waitForClose = Promise.resolve(values);
			}
		},
	};
});

describe("QuickAddApi.requestInputs", () => {
	let variables: Map<string, unknown>;
	let choiceExecutor: IChoiceExecutor;
	let plugin: QuickAdd;

	beforeEach(() => {
		(window as Window & { moment?: unknown; }).moment = (iso: string) => ({
			isValid: () => Boolean(iso),
			format: (fmt: string) => (fmt === "YYYY-MM-DD" ? "2025-12-10" : `formatted-${fmt}`),
		});

		variables = new Map<string, unknown>();
		choiceExecutor = {
			...createChoiceExecutor(),
			execute: vi.fn(),
			variables,
		} as unknown as IChoiceExecutor;
		plugin = {} as QuickAdd;
	});

	afterEach(() => {
		delete (window as Window & { moment?: unknown; }).moment;
		modalReturnValue = {};
		modalRequirements = [];
		formAnswers = {};
		vi.clearAllMocks();
	});

	it("formats date values according to dateFormat and preserves @date in variables", async () => {
		modalReturnValue = {
			"my-date": "@date:2025-12-10T15:41:11.393Z",
		};

		const api = QuickAddApi.GetApi({} as App, plugin, choiceExecutor);
		const result = await api.requestInputs([
			{ id: "my-date", type: "date", dateFormat: "YYYY-MM-DD" },
		]);

		expect(result["my-date"]).toBe("2025-12-10");
		expect(choiceExecutor.variables.get("my-date")).toBe("@date:2025-12-10T15:41:11.393Z");
	});

	it("returns raw value when no dateFormat is provided", async () => {
		modalReturnValue = {
			"raw-date": "@date:2025-12-10T15:41:11.393Z",
		};

		const api = QuickAddApi.GetApi({} as App, plugin, choiceExecutor);
		const result = await api.requestInputs([
			{ id: "raw-date", type: "date" },
		]);

		expect(result["raw-date"]).toBe("@date:2025-12-10T15:41:11.393Z");
		expect(choiceExecutor.variables.get("raw-date")).toBe("@date:2025-12-10T15:41:11.393Z");
	});

	it("joins multi-select picks with \", \" as before when no array is asked for", async () => {
		formAnswers = { picks: { tags: ["#work", "#urgent"] } };

		const api = QuickAddApi.GetApi({} as App, plugin, choiceExecutor);
		const result = await api.requestInputs([
			{ id: "tags", type: "suggester", options: ["#work", "#urgent"], suggesterConfig: { multiSelect: true } },
			{ id: "note", type: "text" },
		]);

		expect(result).toEqual({ tags: "#work, #urgent", note: "" });
		expect(choiceExecutor.variables.get("tags")).toBe("#work, #urgent");
		expect(modalRequirements[0].options).toEqual(["#work", "#urgent"]);
	});

	it("returns comma-bearing picks as separate array items with returnArray (#2292)", async () => {
		formAnswers = { picks: { tags: ["A string, with stuff after a comma", "Another string"] } };

		const api = QuickAddApi.GetApi({} as App, plugin, choiceExecutor);
		const result = await api.requestInputs([{
			id: "tags",
			type: "suggester",
			options: ["A string, with stuff after a comma", "Another string"],
			suggesterConfig: { multiSelect: true, returnArray: true },
		}]);

		expect(result.tags).toEqual(["A string, with stuff after a comma", "Another string"]);
		expect(choiceExecutor.variables.get("tags")).toEqual(["A string, with stuff after a comma", "Another string"]);
	});

	it("keeps typed comma-bearing entries whole", async () => {
		formAnswers = { picks: { tags: ["A string, with stuff after a comma", "Another string"] } };

		const api = QuickAddApi.GetApi({} as App, plugin, choiceExecutor);
		const result = await api.requestInputs([
			{ id: "tags", type: "suggester", suggesterConfig: { multiSelect: true, returnArray: true } },
		]);

		expect(result.tags).toEqual(["A string, with stuff after a comma", "Another string"]);
	});

	it("joins picks with the field's separator", async () => {
		formAnswers = { picks: { tags: ["A string, with stuff after a comma", "Another string"] } };

		const api = QuickAddApi.GetApi({} as App, plugin, choiceExecutor);
		const result = await api.requestInputs([{
			id: "tags",
			type: "suggester",
			options: ["A string, with stuff after a comma", "Another string"],
			suggesterConfig: { multiSelect: true, separator: " | " },
		}]);

		expect(result.tags).toBe("A string, with stuff after a comma | Another string");
		expect(choiceExecutor.variables.get("tags")).toBe("A string, with stuff after a comma | Another string");
	});

	it("shows displayOptions labels and returns the option values", async () => {
		formAnswers = { chosen: { priority: "Low" }, picks: { flags: ["Urgent, today"] } };

		const api = QuickAddApi.GetApi({} as App, plugin, choiceExecutor);
		const result = await api.requestInputs([
			{ id: "priority", type: "dropdown", options: ["hi", "lo"], displayOptions: ["High", "Low"] },
			{
				id: "flags",
				type: "suggester",
				options: ["urgent", "later"],
				displayOptions: (value) => (value === "urgent" ? "Urgent, today" : "Later"),
				suggesterConfig: { multiSelect: true, returnArray: true },
			},
		]);

		expect(modalRequirements[0].displayOptions).toEqual(["High", "Low"]);
		expect(modalRequirements[1].displayOptions).toEqual(["Urgent, today", "Later"]);
		expect(result).toEqual({ priority: "lo", flags: ["urgent"] });
	});

	it("returns the picked objects themselves, as an array by default for a multi-select", async () => {
		const ada = { basename: "Ada" };
		const grace = { basename: "Grace" };
		formAnswers = { chosen: { lead: "Grace" }, picks: { people: ["Grace", "Ada", "Somebody, new"] } };

		const api = QuickAddApi.GetApi({} as App, plugin, choiceExecutor);
		const result = await api.requestInputs([
			{ id: "lead", type: "suggester", options: [ada, grace], displayOptions: (person) => person.basename },
			{
				id: "people",
				type: "suggester",
				options: [ada, grace],
				displayOptions: (person) => person.basename,
				suggesterConfig: { multiSelect: true },
			},
		]);

		expect(result.lead).toBe(grace);
		const people = result.people as unknown[];
		expect(people).toHaveLength(3);
		expect(people[0]).toBe(grace);
		expect(people[1]).toBe(ada);
		expect(people[2]).toBe("Somebody, new");
		expect(choiceExecutor.variables.get("lead")).toBe(grace);
		expect(choiceExecutor.variables.get("people")).toEqual(people);
	});

	it("joins object picks by their labels when a separator is named", async () => {
		formAnswers = { picks: { people: ["Grace", "Ada"] } };

		const api = QuickAddApi.GetApi({} as App, plugin, choiceExecutor);
		const result = await api.requestInputs([{
			id: "people",
			type: "suggester",
			options: [{ basename: "Ada" }, { basename: "Grace" }],
			displayOptions: (person) => person.basename,
			suggesterConfig: { multiSelect: true, separator: "; " },
		}]);

		expect(result.people).toBe("Grace; Ada");
	});

	it("starts a multi-select with its array default picked", async () => {
		const ada = { basename: "Ada" };
		const api = QuickAddApi.GetApi({} as App, plugin, choiceExecutor);
		await api.requestInputs([{
			id: "people",
			type: "suggester",
			options: [ada, { basename: "Grace" }],
			displayOptions: (person) => person.basename,
			defaultValue: [ada, "Somebody, new"],
			suggesterConfig: { multiSelect: true },
		}]);

		const [requirement] = modalRequirements;
		expect(requirement.defaultValues).toEqual([wireValue(modalRequirements, "people", "Ada"), "Somebody, new"]);
	});

	it("keeps variables set before the form in the shape the field returns", async () => {
		const ada = { basename: "Ada" };
		const grace = { basename: "Grace" };
		choiceExecutor.variables.set("tags", ["a, b", "c"]);
		choiceExecutor.variables.set("joined", ["a", "b"]);
		choiceExecutor.variables.set("lead", ada);
		choiceExecutor.variables.set("people", [grace, ada]);

		const api = QuickAddApi.GetApi({} as App, plugin, choiceExecutor);
		const result = await api.requestInputs([
			{ id: "tags", type: "suggester", suggesterConfig: { multiSelect: true, returnArray: true } },
			{ id: "joined", type: "suggester", suggesterConfig: { multiSelect: true } },
			{ id: "lead", type: "suggester", options: [ada] },
			{
				id: "people",
				type: "suggester",
				options: [ada, grace],
				displayOptions: (person) => person.basename,
				suggesterConfig: { multiSelect: true, separator: " | " },
			},
		]);

		expect(result).toEqual({ tags: ["a, b", "c"], joined: "a, b", lead: ada, people: "Grace | Ada" });
		expect(result.lead).toBe(ada);
		expect(modalRequirements).toEqual([]);
	});

	it("decodes a remote client's answers back to the original options", async () => {
		const ada = { basename: "Ada" };
		const grace = { basename: "Grace" };
		const providerRequestInputs = vi.fn(async (fields: FieldRequirement[]) => ({
			lead: wireValue(fields, "lead", "Ada"),
			people: [wireValue(fields, "people", "Grace"), "Somebody, new"],
		}));
		(choiceExecutor as IChoiceExecutor).promptProvider = {
			requestInputs: providerRequestInputs,
		} as unknown as IChoiceExecutor["promptProvider"];

		const api = QuickAddApi.GetApi({} as App, plugin, choiceExecutor);
		const result = await api.requestInputs([
			{ id: "lead", type: "suggester", options: [ada, grace], displayOptions: (person) => person.basename },
			{
				id: "people",
				type: "suggester",
				options: [ada, grace],
				displayOptions: (person) => person.basename,
				suggesterConfig: { multiSelect: true },
			},
		]);

		expect(result.lead).toBe(ada);
		expect((result.people as unknown[])[0]).toBe(grace);
		expect((result.people as unknown[])[1]).toBe("Somebody, new");
	});

	it("routes to a remote prompt provider instead of the modal when one is set", async () => {
		// The modal would return {} (empty) here; the provider returns rating=8, so
		// seeing 8 proves the provider path ran, not the modal.
		modalReturnValue = {};
		const providerRequestInputs = vi.fn(
			async (_fields: Array<Record<string, unknown>>) => ({ rating: "8" }),
		);
		(choiceExecutor as IChoiceExecutor).promptProvider = {
			requestInputs: providerRequestInputs,
		} as unknown as IChoiceExecutor["promptProvider"];

		const api = QuickAddApi.GetApi({} as App, plugin, choiceExecutor);
		const result = await api.requestInputs([
			{ id: "rating", type: "suggester", options: ["10", "9", "8"] },
		]);

		expect(providerRequestInputs).toHaveBeenCalledTimes(1);
		expect(providerRequestInputs.mock.calls[0][0][0]).toMatchObject({
			id: "rating",
			type: "suggester",
			options: ["10", "9", "8"],
		});
		expect(result.rating).toBe("8");
		expect(choiceExecutor.variables.get("rating")).toBe("8");
	});

	it("forwards a sanitized title and description to the prompt provider", async () => {
		const providerRequestInputs = vi.fn(async () => ({ x: "asked" }));
		(choiceExecutor as IChoiceExecutor).promptProvider = {
			requestInputs: providerRequestInputs,
		} as unknown as IChoiceExecutor["promptProvider"];

		const api = QuickAddApi.GetApi({} as App, plugin, choiceExecutor);
		await api.requestInputs([{ id: "x", type: "text" }], {
			title: "  Weekly review ",
			description: " Answer what applies.\nSkip the rest. ",
		});

		expect(providerRequestInputs.mock.calls[0]).toEqual([
			[expect.objectContaining({ id: "x" })],
			{ title: "Weekly review", description: "Answer what applies.\nSkip the rest." },
		]);
	});

	it.each([
		["omitted", undefined],
		["blank", { title: " ", description: "" }],
	])("forwards no header to the provider when options are %s", async (_, options) => {
		const providerRequestInputs = vi.fn(async () => ({ x: "asked" }));
		(choiceExecutor as IChoiceExecutor).promptProvider = {
			requestInputs: providerRequestInputs,
		} as unknown as IChoiceExecutor["promptProvider"];

		const api = QuickAddApi.GetApi({} as App, plugin, choiceExecutor);
		await api.requestInputs([{ id: "x", type: "text" }], options);

		expect(providerRequestInputs).toHaveBeenCalledWith(
			[expect.objectContaining({ id: "x" })],
			undefined,
		);
	});

	it("does not re-ask (nor call the provider) for inputs already in variables", async () => {
		const providerRequestInputs = vi.fn(async () => ({ x: "asked" }));
		(choiceExecutor as IChoiceExecutor).promptProvider = {
			requestInputs: providerRequestInputs,
		} as unknown as IChoiceExecutor["promptProvider"];
		choiceExecutor.variables.set("x", "preset");

		const api = QuickAddApi.GetApi({} as App, plugin, choiceExecutor);
		const result = await api.requestInputs([{ id: "x", type: "text" }]);

		expect(providerRequestInputs).not.toHaveBeenCalled();
		expect(result.x).toBe("preset");
	});
});

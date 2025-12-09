import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type QuickAdd from "./main";
import { QuickAddApi } from "./quickAddApi";
import type { IChoiceExecutor } from "./IChoiceExecutor";

vi.mock("./quickAddSettingsTab", () => ({
	DEFAULT_SETTINGS: {},
	QuickAddSettingsTab: class {},
}));

vi.mock("./formatters/completeFormatter", () => ({
	CompleteFormatter: class CompleteFormatterMock {},
}));

vi.mock("obsidian-dataview", () => ({
	getAPI: vi.fn(),
}));

let modalReturnValue: Record<string, string> = {};

vi.mock("./preflight/OnePageInputModal", () => {
	return {
		OnePageInputModal: class OnePageInputModalMock {
			public waitForClose: Promise<Record<string, string>>;

			constructor(_app: App, _requirements: unknown, _initial?: Map<string, unknown>) {
				this.waitForClose = Promise.resolve(modalReturnValue);
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
			execute: vi.fn(),
			variables,
		} as unknown as IChoiceExecutor;
		plugin = {} as QuickAdd;
	});

	afterEach(() => {
		delete (window as Window & { moment?: unknown; }).moment;
		modalReturnValue = {};
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
});

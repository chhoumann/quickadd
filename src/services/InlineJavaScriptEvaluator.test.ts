import { describe, expect, it, vi } from "vitest";
import { MacroAbortError } from "../errors/MacroAbortError";
import { InlineJavaScriptEvaluator } from "../engine/InlineJavaScriptEvaluator";
import type { IChoiceExecutor } from "../IChoiceExecutor";

vi.mock("../quickAddApi", () => ({
	QuickAddApi: {
		GetApi: vi.fn(() => ({ mocked: true })),
	},
}));

function makeEvaluator(variables = new Map<string, unknown>()) {
	const app = { marker: "app" } as any;
	const plugin = { marker: "plugin" } as any;
	const choiceExecutor = {
		variables,
		signalAbort: vi.fn(),
	} as unknown as IChoiceExecutor;

	return {
		app,
		plugin,
		choiceExecutor,
		variables,
		evaluator: new InlineJavaScriptEvaluator(
			app,
			plugin,
			choiceExecutor,
			variables,
		),
	};
}

describe("InlineJavaScriptEvaluator legacy argument compatibility", () => {
	it("binds this to params and passes an engine-compatible first argument", async () => {
		const { evaluator, app, plugin, choiceExecutor, variables } =
			makeEvaluator();

		await expect(
			evaluator.runAndGetOutput(`
				return {
					thisIsParams: this === arguments[0].params,
					paramsHasAbort: typeof arguments[0].params.abort === "function",
					appIsShared: arguments[0].app.marker,
					pluginIsShared: arguments[0].plugin.marker,
					executorHasAbort: typeof arguments[0].choiceExecutor.signalAbort === "function",
					variablesMapIsShared: arguments[0].variables instanceof Map,
				};
			`),
		).resolves.toEqual({
			thisIsParams: true,
			paramsHasAbort: true,
			appIsShared: app.marker,
			pluginIsShared: plugin.marker,
			executorHasAbort: typeof choiceExecutor.signalAbort === "function",
			variablesMapIsShared: variables instanceof Map,
		});
	});

	it("lets legacy arguments[0].params access and mutate shared variables", async () => {
		const { evaluator, variables } = makeEvaluator(
			new Map<string, unknown>([["existing", "value"]]),
		);

		await expect(
			evaluator.runAndGetOutput(`
				arguments[0].params.variables.added = this.variables.existing + "-added";
				return arguments[0].params.variables.added;
			`),
		).resolves.toBe("value-added");
		expect(variables.get("added")).toBe("value-added");
	});

	it("keeps variables shared across multiple inline blocks", async () => {
		const { evaluator, variables } = makeEvaluator(
			new Map<string, unknown>([["temporary", "delete-me"]]),
		);

		await evaluator.runAndGetOutput(`
			arguments[0].params.variables.counter = 1;
			delete this.variables.temporary;
			return "";
		`);
		await expect(
			evaluator.runAndGetOutput(`
				this.variables.counter += 1;
				return arguments[0].params.variables.counter;
			`),
		).resolves.toBe(2);
		expect(variables.get("counter")).toBe(2);
		expect(variables.has("temporary")).toBe(false);
	});

	it("preserves abort and unexpected error behavior", async () => {
		const { evaluator } = makeEvaluator();

		await expect(
			evaluator.runAndGetOutput("arguments[0].params.abort('stop');"),
		).rejects.toEqual(new MacroAbortError("stop"));
		await expect(
			evaluator.runAndGetOutput("throw new Error('boom');"),
		).rejects.toThrow("boom");
	});
});

import { describe, expect, it, vi, beforeEach } from "vitest";
import { evaluateCondition } from "./helpers/conditionalEvaluator";
import type {
	VariableCondition,
	ScriptCondition,
} from "../types/macros/Conditional/types";
import { log } from "../logger/logManager";

const noopScriptEvaluator = vi.fn(async () => false);

describe("evaluateCondition", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("evaluates string equality", async () => {
		const condition: VariableCondition = {
			mode: "variable",
			variableName: "status",
			operator: "equals",
			valueType: "string",
			expectedValue: "ready",
		};

		const result = await evaluateCondition(condition, {
			variables: { status: "ready" },
			evaluateScriptCondition: noopScriptEvaluator,
		});

		expect(result).toBe(true);
	});

	it("treats a variable nothing has set as empty: only is falsy holds, with no warning", async () => {
		const warnSpy = vi.spyOn(log, "logWarning").mockImplementation(() => {});
		const operators = [
			"equals", "notEquals", "lessThan", "lessThanOrEqual", "greaterThan",
			"greaterThanOrEqual", "contains", "notContains", "isTruthy", "isFalsy",
		] as const;
		const results: string[] = [];
		for (const valueType of ["string", "number", "boolean"] as const) {
			for (const operator of operators) {
				const holds = await evaluateCondition(
					{ mode: "variable", variableName: "status", operator, valueType, expectedValue: "5" },
					{ variables: {}, evaluateScriptCondition: noopScriptEvaluator },
				);
				if (holds) results.push(`${valueType} ${operator}`);
			}
		}

		expect(results).toEqual(["string isFalsy", "number isFalsy", "boolean isFalsy"]);
		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it("supports numeric comparisons", async () => {
		const condition: VariableCondition = {
			mode: "variable",
			variableName: "count",
			operator: "lessThan",
			valueType: "number",
			expectedValue: "10",
		};

		const result = await evaluateCondition(condition, {
			variables: { count: "5" },
			evaluateScriptCondition: noopScriptEvaluator,
		});

		expect(result).toBe(true);
	});

	it("checks array containment", async () => {
		const condition: VariableCondition = {
			mode: "variable",
			variableName: "items",
			operator: "contains",
			valueType: "string",
			expectedValue: "beta",
		};

		const result = await evaluateCondition(condition, {
			variables: { items: ["alpha", "beta", "gamma"] },
			evaluateScriptCondition: noopScriptEvaluator,
		});

		expect(result).toBe(true);
	});

	it("evaluates truthiness", async () => {
		const condition: VariableCondition = {
			mode: "variable",
			variableName: "flag",
			operator: "isTruthy",
			valueType: "boolean",
		};

		const truthyResult = await evaluateCondition(condition, {
			variables: { flag: 1 },
			evaluateScriptCondition: noopScriptEvaluator,
		});

		expect(truthyResult).toBe(true);

		condition.operator = "isFalsy";
		const falsyResult = await evaluateCondition(condition, {
			variables: { flag: null },
			evaluateScriptCondition: noopScriptEvaluator,
		});

		expect(falsyResult).toBe(true);
	});

	it("preserves object containment through safe formatting", async () => {
		const condition: VariableCondition = {
			mode: "variable",
			variableName: "payload",
			operator: "contains",
			valueType: "string",
			expectedValue: '"needle":true',
		};

		const result = await evaluateCondition(condition, {
			variables: { payload: { needle: true } },
			evaluateScriptCondition: noopScriptEvaluator,
		});

		expect(result).toBe(true);
	});

	it("delegates script conditions", async () => {
		const condition: ScriptCondition = {
			mode: "script",
			scriptPath: "Scripts/check.js",
			exportName: "default",
		};

		const evaluateScriptCondition = vi.fn().mockResolvedValue(true as const);

		const result = await evaluateCondition(condition, {
			variables: {},
			evaluateScriptCondition,
		});

		expect(evaluateScriptCondition).toHaveBeenCalledWith(condition);
		expect(result).toBe(true);
	});
});

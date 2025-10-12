import { log } from "../../logger/logManager";
import type {
	ConditionalCondition,
	ScriptCondition,
	VariableCondition,
} from "../../types/macros/Conditional/types";
import {
	normalizeExpectedValue,
	normalizeVariableValue,
	requiresExpectedValue,
} from "../../utils/conditionalHelpers";

export interface EvaluateConditionContext {
	variables: Record<string, unknown>;
	evaluateScriptCondition: (condition: ScriptCondition) => Promise<boolean>;
}

export async function evaluateCondition(
	condition: ConditionalCondition,
	context: EvaluateConditionContext
): Promise<boolean> {
	if (condition.mode === "script") {
		return await context.evaluateScriptCondition(condition);
	}

	return evaluateVariableCondition(condition, context.variables);
}

function evaluateVariableCondition(
	condition: VariableCondition,
	variables: Record<string, unknown>
): boolean {
	const variableName = condition.variableName?.trim();

	if (!variableName) {
		log.logWarning(
			"Conditional command skipped: No variable name configured."
		);
		return false;
	}

	if (!(variableName in variables)) {
		log.logWarning(
			`Conditional command skipped: Variable '${variableName}' is not defined.`
		);
		return false;
	}

	const rawValue = variables[variableName];

	switch (condition.operator) {
		case "isTruthy":
			return Boolean(rawValue);
		case "isFalsy":
			return !Boolean(rawValue);
	}

	if (requiresExpectedValue(condition.operator)) {
		const expected = normalizeExpectedValue(condition);

		if (expected === undefined) {
			log.logWarning(
				`Conditional command: Operator '${condition.operator}' requires a comparison value.`
			);
			return false;
		}

		if (condition.operator === "contains") {
			return evaluateContains(rawValue, expected, condition);
		}

		if (condition.operator === "notContains") {
			return !evaluateContains(rawValue, expected, condition);
		}

		return evaluateComparable(rawValue, expected, condition);
	}

	return false;
}

function evaluateContains(
	rawValue: unknown,
	expected: unknown,
	condition: VariableCondition
): boolean {
	if (rawValue === null || rawValue === undefined) return false;

	if (typeof expected === "string" && expected.length === 0) {
		log.logWarning(
			"Conditional command: 'contains' operator requires a non-empty comparison value."
		);
		return false;
	}

	if (Array.isArray(rawValue)) {
		return rawValue
			.map((item) => normalizeVariableValue(item, condition.valueType))
			.some((item) => item === expected);
	}

	if (typeof rawValue === "string") {
		return rawValue.includes(String(expected));
	}

	if (typeof rawValue === "number" && typeof expected === "number") {
		return rawValue === expected;
	}

	return String(rawValue).includes(String(expected));
}

function evaluateComparable(
	rawValue: unknown,
	expected: unknown,
	condition: VariableCondition
): boolean {
	const normalizedValue = normalizeVariableValue(
		rawValue,
		condition.valueType
	);

	switch (condition.operator) {
		case "equals":
			return normalizedValue === expected;
		case "notEquals":
			return normalizedValue !== expected;
		case "lessThan":
			return compareNumbers(normalizedValue, expected, (a, b) => a < b);
		case "lessThanOrEqual":
			return compareNumbers(normalizedValue, expected, (a, b) => a <= b);
		case "greaterThan":
			return compareNumbers(normalizedValue, expected, (a, b) => a > b);
		case "greaterThanOrEqual":
			return compareNumbers(normalizedValue, expected, (a, b) => a >= b);
		default:
			return false;
	}
}

function compareNumbers(
	actual: unknown,
	expected: unknown,
	comparator: (a: number, b: number) => boolean
): boolean {
	const actualNumber = Number(actual);
	const expectedNumber = Number(expected);

	if (Number.isNaN(actualNumber) || Number.isNaN(expectedNumber)) {
		log.logWarning(
			"Conditional command numeric comparison failed: non-numeric value encountered."
		);
		return false;
	}

	return comparator(actualNumber, expectedNumber);
}

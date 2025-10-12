import type {
	ConditionalCondition,
	ConditionalOperator,
	ConditionalValueType,
	ScriptCondition,
	VariableCondition,
} from "../types/macros/Conditional/types";

export const DEFAULT_CONDITIONAL_VALUE_TYPE: ConditionalValueType = "string";

const OPERATORS_REQUIRING_EXPECTED: ConditionalOperator[] = [
	"equals",
	"notEquals",
	"lessThan",
	"lessThanOrEqual",
	"greaterThan",
	"greaterThanOrEqual",
	"contains",
	"notContains",
];

const BOOLEAN_TRUE_VALUES = new Set(["true", "1", "yes", "on"]);
const BOOLEAN_FALSE_VALUES = new Set(["false", "0", "no", "off"]);

export function requiresExpectedValue(operator: ConditionalOperator): boolean {
	return OPERATORS_REQUIRING_EXPECTED.includes(operator);
}

export function getDefaultValueTypeForOperator(
	operator: ConditionalOperator
): ConditionalValueType {
	switch (operator) {
		case "lessThan":
		case "lessThanOrEqual":
		case "greaterThan":
		case "greaterThanOrEqual":
			return "number";
		case "equals":
		case "notEquals":
			return "string";
		case "contains":
		case "notContains":
			return "string";
		case "isTruthy":
		case "isFalsy":
		default:
			return "boolean";
	}
}

export function normalizeExpectedValue(
	condition: VariableCondition
): unknown {
	if (!requiresExpectedValue(condition.operator)) return undefined;
	if (
		condition.expectedValue === undefined ||
		condition.expectedValue === null
	) {
		return undefined;
	}

	const trimmed = condition.expectedValue.trim();

	switch (condition.valueType) {
		case "number": {
			const parsed = Number(trimmed);
			return Number.isNaN(parsed) ? NaN : parsed;
		}
		case "boolean": {
			const lowered = trimmed.toLowerCase();
			if (BOOLEAN_TRUE_VALUES.has(lowered)) return true;
			if (BOOLEAN_FALSE_VALUES.has(lowered)) return false;
			return Boolean(trimmed);
		}
		case "string":
		default:
			return trimmed;
	}
}

export function normalizeVariableValue(
	value: unknown,
	valueType: ConditionalValueType
): unknown {
	switch (valueType) {
		case "number":
			if (typeof value === "number") return value;
			if (typeof value === "boolean") return value ? 1 : 0;
			return Number(value);
		case "boolean":
			if (typeof value === "boolean") return value;
			if (typeof value === "string") {
				const lowered = value.trim().toLowerCase();
				if (BOOLEAN_TRUE_VALUES.has(lowered)) return true;
				if (BOOLEAN_FALSE_VALUES.has(lowered)) return false;
			}
			return Boolean(value);
		case "string":
		default:
			if (value === null || value === undefined) return "";
			return String(value);
	}
}

export function formatExpectedValueForDisplay(
	condition: VariableCondition
): string {
	if (!requiresExpectedValue(condition.operator)) return "";
	const raw = condition.expectedValue ?? "";
	if (raw.length === 0) return "(empty)";

	if (condition.valueType === "string") {
		return `"${raw}"`;
	}

	return raw;
}

export function describeVariableCondition(
	condition: VariableCondition
): string {
	const variableLabel = condition.variableName
		? `$${condition.variableName}`
		: "(missing variable)";

	const operatorLabel = getOperatorLabel(condition.operator);
	const expectedLabel = requiresExpectedValue(condition.operator)
		? ` ${formatExpectedValueForDisplay(condition)}`
		: "";

	return `${variableLabel} ${operatorLabel}${expectedLabel}`.trim();
}

export function describeScriptCondition(condition: ScriptCondition): string {
	const exportSuffix = condition.exportName
		? `::${condition.exportName}`
		: "";
	return `script ${condition.scriptPath}${exportSuffix}`;
}

export function getConditionSummary(
	condition: ConditionalCondition
): string {
	return condition.mode === "variable"
		? describeVariableCondition(condition)
		: describeScriptCondition(condition);
}

function getOperatorLabel(operator: ConditionalOperator): string {
	switch (operator) {
		case "equals":
			return "equals";
		case "notEquals":
			return "does not equal";
		case "lessThan":
			return "is less than";
		case "lessThanOrEqual":
			return "is less than or equal to";
		case "greaterThan":
			return "is greater than";
		case "greaterThanOrEqual":
			return "is greater than or equal to";
		case "contains":
			return "contains";
		case "notContains":
			return "does not contain";
		case "isTruthy":
			return "is truthy";
		case "isFalsy":
			return "is falsy";
		default:
			return operator;
	}
}

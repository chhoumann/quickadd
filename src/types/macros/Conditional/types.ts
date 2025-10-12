export type ConditionMode = "variable" | "script";

export type ConditionalOperator =
	| "equals"
	| "notEquals"
	| "lessThan"
	| "lessThanOrEqual"
	| "greaterThan"
	| "greaterThanOrEqual"
	| "contains"
	| "notContains"
	| "isTruthy"
	| "isFalsy";

export type ConditionalValueType = "string" | "number" | "boolean";

export interface VariableCondition {
	mode: "variable";
	variableName: string;
	operator: ConditionalOperator;
	valueType: ConditionalValueType;
	expectedValue?: string;
}

export interface ScriptCondition {
	mode: "script";
	scriptPath: string;
	exportName?: string;
}

export type ConditionalCondition = VariableCondition | ScriptCondition;

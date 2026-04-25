export type RuntimeDiagnosticSeverity = "info" | "warning" | "error";

export type RuntimeDiagnosticSource =
	| "runtime"
	| "integration"
	| "choice"
	| "command"
	| "formatter";

export interface ChoiceExecutionDiagnostic {
	severity: RuntimeDiagnosticSeverity;
	code: string;
	message: string;
	source: RuntimeDiagnosticSource;
	stepId?: string;
	choiceId?: string;
	integrationId?: string;
	details?: Record<string, unknown>;
	cause?: unknown;
}

export function createDiagnostic(
	diagnostic: ChoiceExecutionDiagnostic,
): ChoiceExecutionDiagnostic {
	return diagnostic;
}

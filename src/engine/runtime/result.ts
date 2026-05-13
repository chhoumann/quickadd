import type { ChoiceExecutionArtifact } from "./artifact";
import type { ChoiceExecutionDiagnostic } from "./diagnostic";

export type ChoiceExecutionStatus = "success" | "skipped" | "aborted" | "failed";
export type CommandExecutionStatus = ChoiceExecutionStatus;

export interface ChoiceExecutionResult {
	status: ChoiceExecutionStatus;
	choiceId?: string;
	stepId?: string;
	value?: unknown;
	artifacts: ChoiceExecutionArtifact[];
	diagnostics: ChoiceExecutionDiagnostic[];
	error?: unknown;
}

export interface CommandExecutionResult {
	status: CommandExecutionStatus;
	commandId?: string;
	stepId: string;
	value?: unknown;
	artifacts: ChoiceExecutionArtifact[];
	diagnostics: ChoiceExecutionDiagnostic[];
	error?: unknown;
}

export function createChoiceExecutionResult(
	result: Omit<ChoiceExecutionResult, "artifacts" | "diagnostics"> & {
		artifacts?: ChoiceExecutionArtifact[];
		diagnostics?: ChoiceExecutionDiagnostic[];
	},
): ChoiceExecutionResult {
	return {
		...result,
		artifacts: result.artifacts ?? [],
		diagnostics: result.diagnostics ?? [],
	};
}

export function createCommandExecutionResult(
	result: Omit<CommandExecutionResult, "artifacts" | "diagnostics"> & {
		artifacts?: ChoiceExecutionArtifact[];
		diagnostics?: ChoiceExecutionDiagnostic[];
	},
): CommandExecutionResult {
	return {
		...result,
		artifacts: result.artifacts ?? [],
		diagnostics: result.diagnostics ?? [],
	};
}

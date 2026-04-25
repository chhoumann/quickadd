import type { WorkspaceLeaf } from "obsidian";
import type { IntegrationRegistry } from "../../integrations/IntegrationRegistry";
import type { ChoiceExecutionArtifact } from "./artifact";
import type { ChoiceExecutionDiagnostic } from "./diagnostic";

export type ExecutionStepId = string;

export interface ChoiceExecutionContext {
	id: string;
	rootChoiceId?: string;
	originLeaf?: WorkspaceLeaf | null;
	variables: Map<string, unknown>;
	integrations: IntegrationRegistry;
	diagnostics: ChoiceExecutionDiagnostic[];
	artifacts: ChoiceExecutionArtifact[];
	createStepId(label?: string): ExecutionStepId;
	addDiagnostic(diagnostic: ChoiceExecutionDiagnostic): void;
	addArtifact(artifact: ChoiceExecutionArtifact): void;
}

export interface ChoiceExecutionContextOptions {
	id?: string;
	rootChoiceId?: string;
	originLeaf?: WorkspaceLeaf | null;
	variables?: Map<string, unknown>;
	integrations: IntegrationRegistry;
	diagnostics?: ChoiceExecutionDiagnostic[];
	artifacts?: ChoiceExecutionArtifact[];
}

export function createChoiceExecutionContext(
	options: ChoiceExecutionContextOptions,
): ChoiceExecutionContext {
	let nextStep = 0;
	const diagnostics = options.diagnostics ?? [];
	const artifacts = options.artifacts ?? [];
	const id = options.id ?? createRuntimeId("ctx");

	return {
		id,
		rootChoiceId: options.rootChoiceId,
		originLeaf: options.originLeaf,
		variables: options.variables ?? new Map<string, unknown>(),
		integrations: options.integrations,
		diagnostics,
		artifacts,
		createStepId(label = "step") {
			nextStep += 1;
			return `${id}:${label}:${nextStep}`;
		},
		addDiagnostic(diagnostic) {
			diagnostics.push(diagnostic);
		},
		addArtifact(artifact) {
			artifacts.push(artifact);
		},
	};
}

function createRuntimeId(prefix: string): string {
	const cryptoLike = globalThis.crypto as
		| { randomUUID?: () => string }
		| undefined;
	return cryptoLike?.randomUUID?.() ?? `${prefix}-${Date.now()}`;
}

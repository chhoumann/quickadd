export type ChoiceExecutionArtifactKind =
	| "file"
	| "content"
	| "variable"
	| "integration"
	| "custom";

export interface ChoiceExecutionArtifact {
	id: string;
	kind: ChoiceExecutionArtifactKind;
	label?: string;
	path?: string;
	value?: unknown;
	metadata?: Record<string, unknown>;
	createdAt: number;
}

export function createArtifact(
	artifact: Omit<ChoiceExecutionArtifact, "createdAt"> & {
		createdAt?: number;
	},
): ChoiceExecutionArtifact {
	return {
		...artifact,
		createdAt: artifact.createdAt ?? Date.now(),
	};
}

import { QA_INTERNAL_CAPTURE_TARGET_FILE_PATH } from "src/constants";
import { resolveExistingVariableKey } from "src/utils/valueSyntax";

export type CaptureTargetKey = string & {
	readonly __captureTargetKey: unique symbol;
};

const SCOPED_PREFIX = `${QA_INTERNAL_CAPTURE_TARGET_FILE_PATH}.`;

export function captureTargetKeyFor(choiceId: string): CaptureTargetKey {
	return `${SCOPED_PREFIX}${choiceId}` as CaptureTargetKey;
}

export function isScopedCaptureTargetKey(id: string): boolean {
	return id.startsWith(SCOPED_PREFIX) && id.length > SCOPED_PREFIX.length;
}

export function isCaptureTargetKey(id: string): id is CaptureTargetKey {
	return id === QA_INTERNAL_CAPTURE_TARGET_FILE_PATH || isScopedCaptureTargetKey(id);
}

function nonNullVariableKey(
	variables: Map<string, unknown>,
	id: string,
): string | null {
	const key = resolveExistingVariableKey(variables, id);
	if (!key) return null;
	return variables.get(key) == null ? null : key;
}

function countScopedCaptureTargetKeys(
	variables: Map<string, unknown>,
): number {
	let count = 0;
	for (const key of variables.keys()) {
		if (isScopedCaptureTargetKey(key)) count++;
	}
	return count;
}

export function readPreselectedCaptureTarget(
	variables: Map<string, unknown> | undefined,
	choiceId: string,
): string | undefined {
	if (!variables) return undefined;

	const scoped = variables.get(captureTargetKeyFor(choiceId));
	if (typeof scoped === "string" && scoped.length > 0) return scoped;

	// Unscoped is a one-target alias. Two folder captures sharing one variables
	// map must not both write to it.
	if (countScopedCaptureTargetKeys(variables) > 1) return undefined;

	const unscoped = variables.get(QA_INTERNAL_CAPTURE_TARGET_FILE_PATH);
	if (typeof unscoped === "string" && unscoped.length > 0) return unscoped;

	return undefined;
}

export function resolveCaptureTargetVariableKey(
	variables: Map<string, unknown>,
	requirementId: string,
): string | null {
	if (!isCaptureTargetKey(requirementId)) return null;
	return nonNullVariableKey(variables, requirementId);
}

export function unscopedAliasSatisfiesSoleCaptureTarget(
	variables: Map<string, unknown>,
	requirementId: string,
	scopedCaptureTargetCount: number,
): boolean {
	if (scopedCaptureTargetCount !== 1) return false;
	if (!isScopedCaptureTargetKey(requirementId)) return false;
	return nonNullVariableKey(variables, QA_INTERNAL_CAPTURE_TARGET_FILE_PATH) !== null;
}

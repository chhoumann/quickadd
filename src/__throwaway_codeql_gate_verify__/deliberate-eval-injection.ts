/**
 * THROWWAWAY — CodeQL gate verification only. DO NOT MERGE.
 *
 * Deliberate medium+ CodeQL finding (code injection via eval on
 * attacker-controlled input) to confirm Protect master blocks merges
 * when Code scanning results / CodeQL reports medium or higher.
 */
export function deliberateCodeqlGateVerifyEval(userControlledInput: string): unknown {
	// CodeQL: js/eval-injection (or equivalent code-injection rule)
	return eval(userControlledInput);
}

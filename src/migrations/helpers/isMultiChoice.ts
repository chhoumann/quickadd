import type { MultiChoice } from "src/types/choices/MultiChoice";

export function isMultiChoice(choice: unknown): choice is MultiChoice {
	if (
		choice === null ||
		typeof choice !== "object" ||
		!("type" in choice) ||
		!("choices" in choice)
	) {
		return false;
	}

	// Array.isArray, not `!== undefined`: this predicate gates WRITE walkers that
	// reassign `choice.choices = recursive(choice.choices)`, and `{}` passes a
	// `!== undefined` check only to blow up on the for-of one line later. Failing
	// the predicate makes those migrations SKIP the malformed folder, which is
	// what preserves it (#1566).
	return choice.type === "Multi" && Array.isArray(choice.choices);
}

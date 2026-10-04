import { vi } from "vitest";
import type { IChoiceExecutor } from "src/IChoiceExecutor";
import { createPreparedChoiceInputState } from "src/preflight/preparedChoiceInputs";

export function createChoiceExecutor(): IChoiceExecutor {
	return {
		execute: vi.fn(),
		guardReentry: (_choice, run) => run(),
		prepareMacroInputs: vi.fn(),
		preparedInputs: createPreparedChoiceInputState(),
		variables: new Map(),
	};
}

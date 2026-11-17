import { vi } from "vitest";
import type { IChoiceExecutor } from "src/IChoiceExecutor";
import type { ChoiceChain } from "src/engine/choiceChain";
import type IChoice from "src/types/choices/IChoice";
import { createPreparedChoiceInputState } from "src/preflight/preparedChoiceInputs";

export function createChoiceExecutor(): IChoiceExecutor {
	return {
		runChoice: <T>(choice: IChoice, work: (chain: ChoiceChain) => Promise<T>) => work([choice]),
		execute: vi.fn(),
		prepareMacroInputs: vi.fn(),
		preparedInputs: createPreparedChoiceInputState(),
		variables: new Map(),
	};
}

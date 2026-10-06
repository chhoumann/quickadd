import { describe, expect, it, vi } from "vitest";
import { createChoiceExecutor } from "../../tests/helpers/createChoiceExecutor";
import { ChoiceAbortError } from "../errors/ChoiceAbortError";
import { UserCancelError } from "../errors/UserCancelError";
import { claimRefusal, refuse } from "../errors/RefusalError";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type IChoice from "../types/choices/IChoice";
import { executeChoice } from "./executeChoice";

const macro: IChoice = { id: "m", name: "Macro", type: "Macro", command: false };

function executor(execute: () => Promise<void>, signalled: Error | null = null): IChoiceExecutor {
	return {
		...createChoiceExecutor(),
		execute: vi.fn(execute),
		consumeAbortSignal: vi.fn().mockReturnValue(signalled),
	};
}

/**
 * `quickadd:run … ui` without `verify`. Pressing Escape in the one-page form throws
 * its cancellation out of execute() instead of signalling it, and the CLI answered
 * `{"ok":false,"error":"One-page input cancelled by user"}`: a failure, not an abort.
 */
describe("CLI executeChoice without verify", () => {
	it("reports a thrown user cancellation as aborted", async () => {
		const run = executor(() => Promise.reject(new UserCancelError("One-page input cancelled by user")));

		await expect(executeChoice(run, macro, false)).resolves.toEqual({
			ok: false,
			aborted: true,
			error: "One-page input cancelled by user",
		});
	});

	it("reports a thrown involuntary abort as aborted, like the verify path does", async () => {
		const run = executor(() => Promise.reject(new ChoiceAbortError('"Daily" needs a date.')));

		await expect(executeChoice(run, macro, false)).resolves.toEqual({
			ok: false,
			aborted: true,
			error: '"Daily" needs a date.',
		});
	});

	it("reports a signalled cancellation as aborted", async () => {
		const run = executor(() => Promise.resolve(), new UserCancelError("Input cancelled by user"));

		await expect(executeChoice(run, macro, false)).resolves.toEqual({
			ok: false,
			aborted: true,
			error: "Input cancelled by user",
		});
	});

	it("reports a sequence's refusal as a failure with the sentence, not an abort", async () => {
		const refusal = refuse("no note is open", "there is nothing to add to");
		claimRefusal(refusal, "Quick capture");
		const run = executor(() => Promise.resolve(), refusal);

		await expect(executeChoice(run, macro, false)).resolves.toEqual({
			ok: false,
			error: "Quick capture: no note is open, so there is nothing to add to.",
		});
	});

	it("lets a real failure through so the CLI reports it as an error", async () => {
		const failure = new Error("Template file not found");
		const run = executor(() => Promise.reject(failure));

		await expect(executeChoice(run, macro, false)).rejects.toBe(failure);
	});
});

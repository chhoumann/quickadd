import { describe, expect, it, vi } from "vitest";
import { ChoiceOutcomeRecorder, failureReason } from "./choiceOutcomeRecorder";

const executor = () => ({ recordExecutionResult: vi.fn() });

describe("ChoiceOutcomeRecorder (#1603)", () => {
	it("carries the reason on a failure so a headless caller learns the cause", () => {
		const target = executor();

		new ChoiceOutcomeRecorder(target).failure(
			'Template file not found at path "templates/x.md".',
		);

		expect(target.recordExecutionResult).toHaveBeenCalledWith({
			status: "error",
			reason: 'Template file not found at path "templates/x.md".',
		});
	});

	// Both engines record success at their COMMIT point precisely so a later
	// append-link or open-file failure cannot make an automation caller retry and
	// duplicate the side effect. Terminality has to belong to the recorder: Capture
	// commits from two methods, and the canvas path keeps going into steps whose
	// throws unwind into run()'s catch.
	it("is a no-op once the run has committed", () => {
		const target = executor();
		const recorder = new ChoiceOutcomeRecorder(target);

		recorder.success({ path: "Note.md" } as never);
		recorder.failure("Cannot append link because no active Markdown view is available.");

		expect(target.recordExecutionResult).toHaveBeenCalledTimes(1);
		expect(target.recordExecutionResult).toHaveBeenCalledWith({
			status: "success",
			file: { path: "Note.md" },
		});
	});

	it("tolerates an executor that does not record outcomes at all", () => {
		expect(() => new ChoiceOutcomeRecorder({}).failure("boom")).not.toThrow();
	});
});

describe("failureReason", () => {
	it("uses the Error's own message, with no context prefix", () => {
		expect(failureReason(new Error("Template file not found"))).toBe(
			"Template file not found",
		);
	});

	it("stringifies a non-Error throw", () => {
		expect(failureReason("a script threw a string")).toBe(
			"a script threw a string",
		);
	});

	// An Error with an empty message would otherwise hand the client "" and read as
	// "no reason given", which is the state this whole change removes.
	it("never yields an empty reason", () => {
		expect(failureReason(new Error(""))).toBe("Choice execution failed.");
		expect(failureReason(undefined)).toBe("undefined");
	});
});

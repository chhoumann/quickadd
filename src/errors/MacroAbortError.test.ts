import { describe, it, expect } from "vitest";
import { MacroAbortError } from "./MacroAbortError";

describe("Macro Abort Functionality", () => {
	describe("MacroAbortError", () => {
		it("should create error with custom message", () => {
			const error = new MacroAbortError("Custom abort message");
			expect(error.message).toBe("Custom abort message");
		});

		it("should use default message when no message provided", () => {
			const error = new MacroAbortError();
			expect(error.message).toBe("Macro execution aborted");
		});

		it("should have correct name property", () => {
			const error = new MacroAbortError("test");
			expect(error.name).toBe("MacroAbortError");
		});

		it("should be instance of Error", () => {
			const error = new MacroAbortError("test");
			expect(error).toBeInstanceOf(Error);
		});

		it("should have a stack trace", () => {
			const error = new MacroAbortError("test");
			expect(error.stack).toBeDefined();
			expect(typeof error.stack).toBe("string");
		});

		it("should be throwable and catchable", () => {
			expect(() => {
				throw new MacroAbortError("test");
			}).toThrow(MacroAbortError);
		});

		it("should be catchable as generic Error", () => {
			try {
				throw new MacroAbortError("test");
			} catch (error) {
				expect(error).toBeInstanceOf(Error);
				expect(error).toBeInstanceOf(MacroAbortError);
			}
		});
	});

	describe("Abort behavior simulation", () => {
		it("should demonstrate params.abort() pattern", () => {
			// Simulate the abort function as it would be in params
			const abort = (message?: string) => {
				throw new MacroAbortError(message);
			};

			expect(() => abort("Validation failed")).toThrow(MacroAbortError);
			expect(() => abort("Validation failed")).toThrow("Validation failed");
		});

		it("should simulate script validation with abort", () => {
			const validateAndRun = (isValid: boolean) => {
				const abort = (message?: string) => {
					throw new MacroAbortError(message);
				};

				if (!isValid) {
					abort("Validation failed: Invalid input");
				}

				return "execution completed";
			};

			// Valid case should complete
			expect(validateAndRun(true)).toBe("execution completed");

			// Invalid case should abort
			expect(() => validateAndRun(false)).toThrow(MacroAbortError);
			expect(() => validateAndRun(false)).toThrow("Validation failed: Invalid input");
		});

		it("should demonstrate abort with error handling", () => {
			const abort = (message?: string) => {
				throw new MacroAbortError(message);
			};

			let executionResult = "not executed";

			try {
				abort("User cancelled");
				executionResult = "completed"; // Should not reach here
			} catch (error) {
				if (error instanceof MacroAbortError) {
					executionResult = "aborted cleanly";
				}
			}

			expect(executionResult).toBe("aborted cleanly");
		});
	});
});

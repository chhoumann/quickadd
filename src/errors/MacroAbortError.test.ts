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
});

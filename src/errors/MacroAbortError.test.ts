import { describe, expect, it } from "vitest";
import { MacroAbortError } from "./MacroAbortError";
import { UserCancelError } from "./UserCancelError";

// User scripts detect an abort with `error?.name === "MacroAbortError"`, as the
// QuickAdd API and user-script docs show, so the name is public contract.
describe("MacroAbortError", () => {
	it.each([
		["MacroAbortError", new MacroAbortError("stop")],
		["UserCancelError", new UserCancelError("cancelled")],
	])("%s carries the name user scripts match on", (_label, error) => {
		expect(error.name).toBe("MacroAbortError");
	});

	it("falls back to a default message", () => {
		expect(new MacroAbortError().message).toBe("Macro execution aborted");
	});
});

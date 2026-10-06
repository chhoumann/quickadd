import { beforeEach, describe, expect, it, vi } from "vitest";
import { Notice } from "obsidian";
import { log } from "../logger/logManager";
import { reportError, reportRefusal } from "../utils/errorUtils";
import { MacroAbortError } from "./MacroAbortError";
import { claimRefusal, refuse } from "./RefusalError";

const notices = Notice as unknown as { instances: Array<{ message: string }> };

describe("refusals", () => {
	beforeEach(() => {
		notices.instances.length = 0;
	});

	it("reads what is missing, what did not happen, and the one thing to do", () => {
		expect(refuse("the template T.md does not exist", "no note was created", "Pick a template on the choice's page.").message)
			.toBe("The template T.md does not exist, so no note was created. Pick a template on the choice's page.");
		expect(refuse("no note is open", "there is nothing to add to").message)
			.toBe("No note is open, so there is nothing to add to.");
	});

	it("keeps a proper noun's capital after the choice's name", () => {
		const refusal = refuse("Periodic Notes has monthly notes off", "{{MONTHLY}} has no note to point at");
		expect(claimRefusal(refusal, "Log")).toBe("Log: Periodic Notes has monthly notes off, so {{MONTHLY}} has no note to point at.");
	});

	it("stops a run like an abort", () => {
		expect(refuse("a", "b")).toBeInstanceOf(MacroAbortError);
	});

	it("names the first choice that claims it, so a sequence names its step", () => {
		const refusal = refuse("no note is open", "there is nothing to add to");
		expect(claimRefusal(refusal, "Quick capture")).toBe("Quick capture: no note is open, so there is nothing to add to.");
		expect(claimRefusal(refusal, "Morning routine")).toBe("Quick capture: no note is open, so there is nothing to add to.");
		expect(refusal.message).toBe("Quick capture: no note is open, so there is nothing to add to.");
	});

	it("shows one plain notice, logs it as a message, and keeps a later error report quiet", () => {
		const logError = vi.spyOn(log, "logError").mockImplementation(() => {});
		const logMessage = vi.spyOn(log, "logMessage").mockImplementation(() => {});
		const refusal = refuse("no note is open", "there is nothing to add to");

		reportRefusal(refusal, "Quick capture");
		reportRefusal(refusal, "Morning routine");
		reportError(refusal, "Could not run \"Morning routine\"");

		expect(notices.instances.map((notice) => notice.message)).toEqual(["Quick capture: no note is open, so there is nothing to add to."]);
		expect(logMessage).toHaveBeenCalledWith("Quick capture: no note is open, so there is nothing to add to.");
		expect(logError).not.toHaveBeenCalled();
		logError.mockRestore();
		logMessage.mockRestore();
	});
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { writeTextToClipboard } from "./fileLinks";
import { log } from "../logger/logManager";

describe("writeTextToClipboard does not stack a duplicate notice (audit)", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("does not surface its own warning Notice on rejection (caller owns the message)", async () => {
		const logWarning = vi
			.spyOn(log, "logWarning")
			.mockImplementation(() => {});
		const writeText = vi.fn().mockRejectedValue(new Error("denied"));
		vi.stubGlobal("navigator", { clipboard: { writeText } });

		await expect(writeTextToClipboard("[[Created]]")).resolves.toBe(false);

		expect(logWarning).not.toHaveBeenCalled();
	});

	it("does not surface its own warning Notice when the clipboard API is unavailable", async () => {
		const logWarning = vi
			.spyOn(log, "logWarning")
			.mockImplementation(() => {});
		vi.stubGlobal("navigator", {});

		await expect(writeTextToClipboard("[[Created]]")).resolves.toBe(false);

		expect(logWarning).not.toHaveBeenCalled();
	});
});

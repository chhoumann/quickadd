import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted so the vi.mock factory (which vitest lifts to the top of the file) can
// close over the spy without touching an uninitialised module-level binding.
const { promptSpy } = vi.hoisted(() => ({
	promptSpy: vi.fn<
		(
			app: unknown,
			header: string,
			placeholder?: string,
			value?: string,
		) => Promise<string>
	>(),
}));

vi.mock("./GenericInputPrompt/GenericInputPrompt", () => ({
	default: { Prompt: promptSpy },
}));

import type { App } from "obsidian";
import { promptRenameChoice } from "./choiceRename";
import { promptCancelled } from "../errors/UserCancelError";
import { log } from "src/logger/logManager";

const app = {} as App;

describe("promptRenameChoice", () => {
	beforeEach(() => {
		promptSpy.mockReset();
		promptSpy.mockResolvedValue("Renamed");
	});

	// Issue #1539: folders are Multi choices internally, but the UI calls them
	// folders everywhere else — so the rename prompt must too.
	it("asks for a folder name when renaming a Multi", async () => {
		await promptRenameChoice(app, "New folder", "Multi");

		expect(promptSpy.mock.calls[0][1]).toBe("Folder name");
	});

	it.each(["Template", "Capture", "Macro"] as const)(
		"asks for a choice name when renaming a %s",
		async (type) => {
			await promptRenameChoice(app, "New choice", type);

			expect(promptSpy.mock.calls[0][1]).toBe("Choice name");
		},
	);

	it("falls back to the choice wording when no type is given", async () => {
		await promptRenameChoice(app, "New choice");

		expect(promptSpy.mock.calls[0][1]).toBe("Choice name");
	});

	it("returns the trimmed new name", async () => {
		promptSpy.mockResolvedValue("  Reading list  ");

		await expect(promptRenameChoice(app, "New folder", "Multi")).resolves.toBe(
			"Reading list",
		);
	});

	it("returns null when the name is unchanged", async () => {
		promptSpy.mockResolvedValue("New folder");

		await expect(promptRenameChoice(app, "New folder", "Multi")).resolves.toBe(
			null,
		);
	});

	// Since #1577 a dismissal IS an Error, so the previous `instanceof Error` gate
	// would report every cancelled rename as a failure - a 15s error notice plus an
	// error-log entry for pressing Escape. Nothing caught that, so pin both halves.
	describe("dismissal versus failure", () => {
		it("returns null and logs nothing when the user dismisses the prompt", async () => {
			const logError = vi.spyOn(log, "logError").mockImplementation(() => {});
			promptSpy.mockRejectedValue(promptCancelled());

			await expect(promptRenameChoice(app, "Old", "Macro")).resolves.toBeNull();
			expect(logError).not.toHaveBeenCalled();
			logError.mockRestore();
		});

		it("returns null but DOES log when the prompt genuinely fails", async () => {
			const logError = vi.spyOn(log, "logError").mockImplementation(() => {});
			promptSpy.mockRejectedValue(new Error("boom"));

			await expect(promptRenameChoice(app, "Old", "Macro")).resolves.toBeNull();
			expect(logError).toHaveBeenCalledTimes(1);
			expect(String(logError.mock.calls[0]?.[0])).toContain("boom");
			logError.mockRestore();
		});
	});
});

import type { App } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../formatters/completeFormatter", () => ({
	CompleteFormatter: class CompleteFormatterMock {},
}));

vi.mock("obsidian-dataview", () => ({
	getAPI: vi.fn(),
}));

vi.mock("../main", () => ({
	default: class QuickAddMock {},
}));

import { MacroChoiceEngine } from "./MacroChoiceEngine";
import { EditorCommandType } from "../types/macros/EditorCommands/EditorCommandType";
import { MoveCursorToFileStartCommand } from "../types/macros/EditorCommands/MoveCursorToFileStartCommand";
import { MoveCursorToFileEndCommand } from "../types/macros/EditorCommands/MoveCursorToFileEndCommand";
import { MoveCursorToLineStartCommand } from "../types/macros/EditorCommands/MoveCursorToLineStartCommand";
import { MoveCursorToLineEndCommand } from "../types/macros/EditorCommands/MoveCursorToLineEndCommand";

const callExecuteEditorCommand = async (editorCommandType: EditorCommandType) => {
	const executeEditorCommand = (
		MacroChoiceEngine.prototype as unknown as {
			executeEditorCommand: (
				command: { editorCommandType: EditorCommandType },
			) => Promise<void>;
		}
	).executeEditorCommand;
	const app = {} as App;

	await executeEditorCommand.call({ app }, { editorCommandType });
	return app;
};

describe("MacroChoiceEngine editor command dispatch", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("dispatches MoveCursorToFileStart", async () => {
		const fileStartSpy = vi
			.spyOn(MoveCursorToFileStartCommand, "run")
			.mockImplementation(() => undefined);
		const fileEndSpy = vi
			.spyOn(MoveCursorToFileEndCommand, "run")
			.mockImplementation(() => undefined);
		const lineStartSpy = vi
			.spyOn(MoveCursorToLineStartCommand, "run")
			.mockImplementation(() => undefined);
		const lineEndSpy = vi
			.spyOn(MoveCursorToLineEndCommand, "run")
			.mockImplementation(() => undefined);

		const app = await callExecuteEditorCommand(
			EditorCommandType.MoveCursorToFileStart
		);

		expect(fileStartSpy).toHaveBeenCalledWith(app);
		expect(fileEndSpy).not.toHaveBeenCalled();
		expect(lineStartSpy).not.toHaveBeenCalled();
		expect(lineEndSpy).not.toHaveBeenCalled();
	});

	it("dispatches MoveCursorToFileEnd", async () => {
		const fileStartSpy = vi
			.spyOn(MoveCursorToFileStartCommand, "run")
			.mockImplementation(() => undefined);
		const fileEndSpy = vi
			.spyOn(MoveCursorToFileEndCommand, "run")
			.mockImplementation(() => undefined);
		const lineStartSpy = vi
			.spyOn(MoveCursorToLineStartCommand, "run")
			.mockImplementation(() => undefined);
		const lineEndSpy = vi
			.spyOn(MoveCursorToLineEndCommand, "run")
			.mockImplementation(() => undefined);

		const app = await callExecuteEditorCommand(
			EditorCommandType.MoveCursorToFileEnd
		);

		expect(fileStartSpy).not.toHaveBeenCalled();
		expect(fileEndSpy).toHaveBeenCalledWith(app);
		expect(lineStartSpy).not.toHaveBeenCalled();
		expect(lineEndSpy).not.toHaveBeenCalled();
	});

	it("dispatches MoveCursorToLineStart", async () => {
		const fileStartSpy = vi
			.spyOn(MoveCursorToFileStartCommand, "run")
			.mockImplementation(() => undefined);
		const fileEndSpy = vi
			.spyOn(MoveCursorToFileEndCommand, "run")
			.mockImplementation(() => undefined);
		const lineStartSpy = vi
			.spyOn(MoveCursorToLineStartCommand, "run")
			.mockImplementation(() => undefined);
		const lineEndSpy = vi
			.spyOn(MoveCursorToLineEndCommand, "run")
			.mockImplementation(() => undefined);

		const app = await callExecuteEditorCommand(
			EditorCommandType.MoveCursorToLineStart
		);

		expect(fileStartSpy).not.toHaveBeenCalled();
		expect(fileEndSpy).not.toHaveBeenCalled();
		expect(lineStartSpy).toHaveBeenCalledWith(app);
		expect(lineEndSpy).not.toHaveBeenCalled();
	});

	it("dispatches MoveCursorToLineEnd", async () => {
		const fileStartSpy = vi
			.spyOn(MoveCursorToFileStartCommand, "run")
			.mockImplementation(() => undefined);
		const fileEndSpy = vi
			.spyOn(MoveCursorToFileEndCommand, "run")
			.mockImplementation(() => undefined);
		const lineStartSpy = vi
			.spyOn(MoveCursorToLineStartCommand, "run")
			.mockImplementation(() => undefined);
		const lineEndSpy = vi
			.spyOn(MoveCursorToLineEndCommand, "run")
			.mockImplementation(() => undefined);

		const app = await callExecuteEditorCommand(
			EditorCommandType.MoveCursorToLineEnd
		);

		expect(fileStartSpy).not.toHaveBeenCalled();
		expect(fileEndSpy).not.toHaveBeenCalled();
		expect(lineStartSpy).not.toHaveBeenCalled();
		expect(lineEndSpy).toHaveBeenCalledWith(app);
	});
});

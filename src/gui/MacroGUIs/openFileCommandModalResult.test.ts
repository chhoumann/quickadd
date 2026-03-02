import { describe, expect, it, vi } from "vitest";
import type { DraftSession } from "../../state/createDraftSession";
import type { IOpenFileCommand } from "../../types/macros/QuickCommands/IOpenFileCommand";
import {
	resolveOpenFileCommandModalResult,
} from "./openFileCommandModalResult";

function buildSession(
	command: IOpenFileCommand,
): DraftSession<IOpenFileCommand> & {
	commit: ReturnType<typeof vi.fn>;
	discard: ReturnType<typeof vi.fn>;
} {
	const commit = vi.fn(() => command);
	const discard = vi.fn();

	return {
		draft: command,
		commit,
		discard,
		isDirty: () => false,
	};
}

describe("resolveOpenFileCommandModalResult", () => {
	it("commits and returns draft on save", () => {
		const command = {
			id: "c1",
			name: "Open file: test.md",
			type: "OpenFile",
			filePath: "test.md",
		} as unknown as IOpenFileCommand;
		const session = buildSession(command);

		const result = resolveOpenFileCommandModalResult("save", session);

		expect(result).toBe(command);
		expect(session.commit).toHaveBeenCalledTimes(1);
		expect(session.discard).not.toHaveBeenCalled();
	});

	it("discards and returns null on cancel", () => {
		const session = buildSession({} as IOpenFileCommand);

		const result = resolveOpenFileCommandModalResult("cancel", session);

		expect(result).toBeNull();
		expect(session.commit).not.toHaveBeenCalled();
		expect(session.discard).toHaveBeenCalledTimes(1);
	});

	it("discards and returns null on dismiss (x / escape)", () => {
		const session = buildSession({} as IOpenFileCommand);

		const result = resolveOpenFileCommandModalResult("dismiss", session);

		expect(result).toBeNull();
		expect(session.commit).not.toHaveBeenCalled();
		expect(session.discard).toHaveBeenCalledTimes(1);
	});
});
